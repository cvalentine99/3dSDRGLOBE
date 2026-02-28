/**
 * liveTranslator.ts — Server-side live translation via KiwiSDR WebSocket
 *
 * Connects directly to a KiwiSDR receiver's WebSocket audio stream,
 * captures PCM audio in chunks, converts to WAV, sends to Whisper API,
 * and emits translation events via a callback.
 *
 * This bypasses the browser entirely — no microphone permissions,
 * no cross-origin issues, no getDisplayMedia.
 *
 * Protocol (same as kiwiRecorder.ts):
 * 1. Connect to ws://host:port/kiwi/WSID/SND
 * 2. Authenticate: SET auth t=kiwi p=
 * 3. Set parameters: SET mod=am low_cut=-4000 high_cut=4000 freq=FREQ
 * 4. Disable compression: SET compression=0
 * 5. Receive binary audio frames (PCM 16-bit LE, 12kHz sample rate)
 * 6. Every CHUNK_DURATION_SEC, slice off the accumulated buffer and send to Whisper
 */

import WebSocket from "ws";
import { ENV } from "./_core/env";

// ── Constants ──────────────────────────────────────────────────────
const KIWI_SAMPLE_RATE = 12000;
const KIWI_BITS_PER_SAMPLE = 16;
const KIWI_CHANNELS = 1;
const CHUNK_DURATION_SEC = 15; // 15 seconds per translation chunk
const MAX_SESSION_DURATION_SEC = 600; // 10 minutes max per session

// ── Types ──────────────────────────────────────────────────────────

export interface TranslationEvent {
  type: "status" | "translation" | "error" | "done";
  data: string | TranslationChunk;
}

export interface TranslationChunk {
  chunkIndex: number;
  original?: { text: string; language: string } | null;
  translated?: { text: string; language: string } | null;
  detectedLanguage: string;
  duration: number;
  processingTimeMs: number;
  isEnglishSource: boolean;
}

export interface LiveTranslationSession {
  id: string;
  host: string;
  port: number;
  frequencyKhz: number;
  mode: string;
  isActive: boolean;
  startedAt: number;
  stop: () => void;
}

// ── Active sessions (1 at a time) ──────────────────────────────────
let activeSession: LiveTranslationSession | null = null;

export function getActiveSession(): LiveTranslationSession | null {
  if (activeSession && !activeSession.isActive) {
    activeSession = null;
  }
  // Auto-expire stale sessions
  if (activeSession && Date.now() - activeSession.startedAt > MAX_SESSION_DURATION_SEC * 1000) {
    activeSession.stop();
    activeSession = null;
  }
  return activeSession;
}

export function isTranslationActive(): boolean {
  return getActiveSession() !== null;
}

// ── WAV Header ─────────────────────────────────────────────────────
function createWavHeader(dataLength: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = KIWI_SAMPLE_RATE * KIWI_CHANNELS * (KIWI_BITS_PER_SAMPLE / 8);
  const blockAlign = KIWI_CHANNELS * (KIWI_BITS_PER_SAMPLE / 8);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(KIWI_CHANNELS, 22);
  header.writeUInt32LE(KIWI_SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(KIWI_BITS_PER_SAMPLE, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

// ── Whisper API call ───────────────────────────────────────────────
async function callWhisper(
  wavBuffer: Buffer,
  task: "transcribe" | "translate",
  language?: string,
): Promise<{ text: string; language: string; duration: number }> {
  if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
    throw new Error("Translation service not configured");
  }

  const audioBlob = new Blob([new Uint8Array(wavBuffer)], { type: "audio/wav" });
  const formData = new FormData();
  formData.append("file", audioBlob, "chunk.wav");
  formData.append("model", "whisper-1");
  formData.append("response_format", "verbose_json");
  if (language) formData.append("language", language);

  const baseUrl = ENV.forgeApiUrl.endsWith("/") ? ENV.forgeApiUrl : `${ENV.forgeApiUrl}/`;
  const endpoint = task === "translate" ? "v1/audio/translations" : "v1/audio/transcriptions";
  const fullUrl = new URL(endpoint, baseUrl).toString();

  const response = await fetch(fullUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ENV.forgeApiKey}`,
      "Accept-Encoding": "identity",
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    if (response.status === 404 && task === "translate") {
      // Fallback to transcription if translation endpoint not available
      return callWhisper(wavBuffer, "transcribe", language);
    }
    throw new Error(`Whisper API error ${response.status}: ${errorText}`);
  }

  const result = await response.json() as any;
  return {
    text: result.text?.trim() || "",
    language: result.language || "unknown",
    duration: result.duration || 0,
  };
}

// ── Detect modulation ──────────────────────────────────────────────
function detectMode(freqKhz: number): string {
  if (freqKhz <= 500) return "am";
  if (freqKhz <= 1800) return "am";
  if (freqKhz <= 30000) return "am"; // Most broadcast is AM
  return "am";
}

// ── Main: Start live translation session ───────────────────────────
export function startLiveTranslation(
  params: {
    host: string;
    port: number;
    frequencyKhz: number;
    mode?: string;
    language?: string;
    dualMode?: boolean;
  },
  onEvent: (event: TranslationEvent) => void,
): LiveTranslationSession {
  // Stop any existing session
  if (activeSession?.isActive) {
    activeSession.stop();
  }

  const {
    host,
    port,
    frequencyKhz,
    mode = detectMode(frequencyKhz),
    language,
    dualMode = true,
  } = params;

  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let ws: WebSocket | null = null;
  let isActive = true;
  let chunkIndex = 0;
  let audioBuffer: Buffer[] = [];
  let totalAudioBytes = 0;
  let chunkTimer: NodeJS.Timeout | null = null;
  let sessionTimer: NodeJS.Timeout | null = null;
  let authenticated = false;

  const targetBytesPerChunk = KIWI_SAMPLE_RATE * (KIWI_BITS_PER_SAMPLE / 8) * CHUNK_DURATION_SEC;

  function stop() {
    isActive = false;
    if (chunkTimer) { clearInterval(chunkTimer); chunkTimer = null; }
    if (sessionTimer) { clearTimeout(sessionTimer); sessionTimer = null; }
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.close(); } catch { /* ignore */ }
    }
    ws = null;
    activeSession = null;
    onEvent({ type: "done", data: "Session ended" });
  }

  const session: LiveTranslationSession = {
    id: sessionId,
    host,
    port,
    frequencyKhz,
    mode,
    isActive: true,
    startedAt: Date.now(),
    stop,
  };

  activeSession = session;

  // Process accumulated audio buffer
  async function processChunk() {
    if (!isActive || audioBuffer.length === 0) return;

    const pcmData = Buffer.concat(audioBuffer);
    audioBuffer = [];
    totalAudioBytes = 0;

    if (pcmData.length < 1000) return; // Too small, skip

    const idx = chunkIndex++;
    const startTime = Date.now();

    onEvent({ type: "status", data: `Processing chunk ${idx + 1}...` });

    try {
      // Create WAV from PCM
      const wavHeader = createWavHeader(pcmData.length);
      const wavBuffer = Buffer.concat([wavHeader, pcmData]);

      if (dualMode) {
        // Run transcription and translation in parallel
        const [transcribeResult, translateResult] = await Promise.allSettled([
          callWhisper(wavBuffer, "transcribe", language),
          callWhisper(wavBuffer, "translate", language),
        ]);

        const original = transcribeResult.status === "fulfilled" ? transcribeResult.value : null;
        const translated = translateResult.status === "fulfilled" ? translateResult.value : null;

        if (!original && !translated) {
          onEvent({ type: "error", data: "Both transcription and translation failed" });
          return;
        }

        const detectedLang = original?.language || translated?.language || "unknown";

        const chunk: TranslationChunk = {
          chunkIndex: idx,
          original: original ? { text: original.text, language: original.language } : null,
          translated: translated ? { text: translated.text, language: translated.language } : null,
          detectedLanguage: detectedLang,
          duration: original?.duration || translated?.duration || CHUNK_DURATION_SEC,
          processingTimeMs: Date.now() - startTime,
          isEnglishSource: detectedLang === "en",
        };

        if (chunk.original?.text || chunk.translated?.text) {
          onEvent({ type: "translation", data: chunk });
        } else {
          onEvent({ type: "status", data: "(no speech detected)" });
        }
      } else {
        // Single mode: translate only
        const result = await callWhisper(wavBuffer, "translate", language);

        const chunk: TranslationChunk = {
          chunkIndex: idx,
          original: null,
          translated: { text: result.text, language: result.language },
          detectedLanguage: result.language,
          duration: result.duration,
          processingTimeMs: Date.now() - startTime,
          isEnglishSource: result.language === "en",
        };

        if (result.text) {
          onEvent({ type: "translation", data: chunk });
        } else {
          onEvent({ type: "status", data: "(no speech detected)" });
        }
      }
    } catch (err) {
      console.error(`[LiveTranslator] Chunk ${idx} error:`, err);
      onEvent({ type: "error", data: `Translation error: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  // Connect to KiwiSDR
  const wsId = Math.floor(Math.random() * 1000000).toString();
  const wsUrl = `ws://${host}:${port}/kiwi/${wsId}/SND`;

  onEvent({ type: "status", data: `Connecting to ${host}:${port}...` });
  console.log(`[LiveTranslator] Connecting to ${wsUrl} at ${frequencyKhz} kHz ${mode}`);

  ws = new WebSocket(wsUrl, {
    headers: { "User-Agent": "Mozilla/5.0 ValentineRF-LiveTranslator/1.0" },
    handshakeTimeout: 15000,
  });

  // Connection timeout
  const connTimeout = setTimeout(() => {
    if (ws && ws.readyState !== WebSocket.OPEN) {
      onEvent({ type: "error", data: `Connection timeout to ${host}:${port}` });
      stop();
    }
  }, 20000);

  ws.on("open", () => {
    clearTimeout(connTimeout);
    console.log(`[LiveTranslator] Connected to ${host}:${port}`);
    onEvent({ type: "status", data: `Connected. Tuning to ${frequencyKhz} kHz ${mode.toUpperCase()}...` });

    // Authenticate and configure
    ws!.send(`SET auth t=kiwi p=`);
    const lowCut = mode === "am" ? -4000 : 0;
    const highCut = mode === "am" ? 4000 : 3000;
    ws!.send(`SET mod=${mode} low_cut=${lowCut} high_cut=${highCut} freq=${frequencyKhz}`);
    ws!.send("SET compression=0");
    ws!.send("SET AR OK in=12000 out=12000");
    ws!.send("SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50");

    authenticated = true;
    onEvent({ type: "status", data: `Listening on ${frequencyKhz} kHz — first translation in ~${CHUNK_DURATION_SEC}s...` });

    // Process chunks on a timer
    chunkTimer = setInterval(() => {
      processChunk();
    }, CHUNK_DURATION_SEC * 1000);

    // Max session duration
    sessionTimer = setTimeout(() => {
      onEvent({ type: "status", data: "Session time limit reached (10 minutes). Stopping." });
      stop();
    }, MAX_SESSION_DURATION_SEC * 1000);
  });

  ws.on("message", (data: Buffer) => {
    if (!authenticated || !isActive) return;

    if (Buffer.isBuffer(data) && data.length > 3) {
      const tag = data.toString("ascii", 0, 3);
      if (tag === "SND") {
        // Audio data: skip 10-byte header
        const audioPayload = data.subarray(10);
        if (audioPayload.length > 0) {
          audioBuffer.push(Buffer.from(audioPayload));
          totalAudioBytes += audioPayload.length;
        }
      }
    } else if (typeof data === "string" || (Buffer.isBuffer(data) && data.length <= 256)) {
      const msg = data.toString();
      if (msg.includes("too_busy") || msg.includes("inactivity")) {
        onEvent({ type: "error", data: `KiwiSDR: ${msg}` });
        stop();
      }
    }
  });

  ws.on("close", () => {
    clearTimeout(connTimeout);
    if (isActive) {
      // Process any remaining audio
      processChunk().finally(() => stop());
    }
  });

  ws.on("error", (err) => {
    clearTimeout(connTimeout);
    console.error(`[LiveTranslator] WebSocket error:`, err.message);
    onEvent({ type: "error", data: `Connection error: ${err.message}` });
    stop();
  });

  return session;
}
