/**
 * kiwiRecorder.ts — KiwiSDR Audio Recording Service
 *
 * Records short audio clips from KiwiSDR receivers during TDoA jobs.
 * Uses the KiwiSDR WebSocket protocol to connect, tune, and capture
 * raw PCM audio, then encodes to WAV and uploads to S3.
 *
 * Protocol overview:
 * 1. Connect to ws://host:port/kiwi/WSID/SND
 * 2. Authenticate: SET auth t=kiwi p=
 * 3. Set parameters: SET mod=am low_cut=-4000 high_cut=4000 freq=FREQ
 * 4. Disable compression: SET compression=0
 * 5. Receive binary audio frames (PCM 16-bit LE, 12kHz sample rate)
 * 6. After duration, close connection and encode WAV
 */
import WebSocket from "ws";
import { storagePut } from "./storage";
import { getDb } from "./db";
import { tdoaRecordings } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const KIWI_SAMPLE_RATE = 12000; // KiwiSDR default audio sample rate
const KIWI_BITS_PER_SAMPLE = 16;
const KIWI_CHANNELS = 1; // Mono

export interface RecordingParams {
  /** KiwiSDR host (e.g. "kiwisdr.example.com") */
  host: string;
  /** KiwiSDR port (default 8073) */
  port: number;
  /** Host identifier string for display */
  hostId: string;
  /** Frequency in kHz */
  frequencyKhz: number;
  /** Modulation mode */
  mode?: "am" | "usb" | "lsb" | "cw";
  /** Recording duration in seconds (default 15) */
  durationSec?: number;
  /** TDoA job ID to link the recording to */
  jobId: number;
  /** Optional password for the KiwiSDR */
  password?: string;
}

export interface RecordingResult {
  id: number;
  hostId: string;
  fileUrl: string;
  fileKey: string;
  durationSec: number;
  fileSizeBytes: number;
  status: "ready" | "error";
  errorMessage?: string;
}

/**
 * Detect modulation mode from frequency.
 */
function detectMode(freqKhz: number): "am" | "usb" | "lsb" | "cw" {
  // Time signal stations and broadcast use AM
  if (freqKhz <= 500) return "cw";
  if (freqKhz <= 1800) return "am"; // MW broadcast
  if (freqKhz <= 30000) {
    // HF — most TDoA targets are AM broadcast or time signals
    const amFreqs = [
      2500, 3330, 5000, 7850, 10000, 15000, 20000, 25000, // WWV/WWVH
      3330, 7850, 14670, // CHU
      77.5, // DCF77
      198, // BBC R4 LW
      4996, 9996, 14996, // RWM
      68.5, // BPC
      40, 60, // JJY, MSF, WWVB
    ];
    if (amFreqs.some((f) => Math.abs(f - freqKhz) < 5)) return "am";
    // Default to USB for HF
    return "usb";
  }
  return "am";
}

/**
 * Create a WAV file header for PCM audio data.
 */
function createWavHeader(dataLength: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = KIWI_SAMPLE_RATE * KIWI_CHANNELS * (KIWI_BITS_PER_SAMPLE / 8);
  const blockAlign = KIWI_CHANNELS * (KIWI_BITS_PER_SAMPLE / 8);

  // RIFF header
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);

  // fmt sub-chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // Sub-chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(KIWI_CHANNELS, 22);
  header.writeUInt32LE(KIWI_SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(KIWI_BITS_PER_SAMPLE, 34);

  // data sub-chunk
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

/**
 * Record audio from a single KiwiSDR host.
 * Returns a promise that resolves when recording is complete and uploaded to S3.
 */
export async function recordKiwiAudio(params: RecordingParams): Promise<RecordingResult> {
  const {
    host,
    port,
    hostId,
    frequencyKhz,
    mode = detectMode(frequencyKhz),
    durationSec = 15,
    jobId,
    password = "",
  } = params;

  const db = (await getDb())!;

  // Create initial recording entry
  const [inserted] = await db.insert(tdoaRecordings).values({
    jobId,
    hostId,
    frequencyKhz: frequencyKhz.toFixed(2),
    mode,
    durationSec,
    fileKey: "pending",
    fileUrl: "pending",
    status: "recording",
    createdAt: Date.now(),
  });

  const recordingId = inserted.insertId;

  try {
    const audioData = await captureAudioFromKiwi({
      host,
      port,
      frequencyKhz,
      mode,
      durationSec,
      password,
    });

    // Update status to uploading
    await db
      .update(tdoaRecordings)
      .set({ status: "uploading" })
      .where(eq(tdoaRecordings.id, recordingId));

    // Create WAV file
    const wavHeader = createWavHeader(audioData.length);
    const wavBuffer = Buffer.concat([wavHeader, audioData]);

    // Generate unique file key
    const timestamp = Date.now();
    const sanitizedHost = hostId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileKey = `tdoa-recordings/job-${jobId}/${sanitizedHost}-${frequencyKhz}kHz-${timestamp}.wav`;

    // Upload to S3
    const { url } = await storagePut(fileKey, wavBuffer, "audio/wav");

    // Update recording entry
    await db
      .update(tdoaRecordings)
      .set({
        fileKey,
        fileUrl: url,
        fileSizeBytes: wavBuffer.length,
        status: "ready",
      })
      .where(eq(tdoaRecordings.id, recordingId));

    return {
      id: recordingId,
      hostId,
      fileUrl: url,
      fileKey,
      durationSec,
      fileSizeBytes: wavBuffer.length,
      status: "ready",
    };
  } catch (error: any) {
    const errorMsg = error?.message || "Unknown recording error";
    console.error(`[KiwiRecorder] Error recording from ${hostId}:`, errorMsg);

    await db
      .update(tdoaRecordings)
      .set({
        status: "error",
        errorMessage: errorMsg,
      })
      .where(eq(tdoaRecordings.id, recordingId));

    return {
      id: recordingId,
      hostId,
      fileUrl: "",
      fileKey: "",
      durationSec,
      fileSizeBytes: 0,
      status: "error",
      errorMessage: errorMsg,
    };
  }
}

/**
 * Low-level function to connect to a KiwiSDR via WebSocket
 * and capture raw PCM audio data.
 */
function captureAudioFromKiwi(params: {
  host: string;
  port: number;
  frequencyKhz: number;
  mode: string;
  durationSec: number;
  password: string;
}): Promise<Buffer> {
  const { host, port, frequencyKhz, mode, durationSec, password } = params;

  return new Promise((resolve, reject) => {
    const audioChunks: Buffer[] = [];
    let totalBytes = 0;
    const targetBytes = KIWI_SAMPLE_RATE * (KIWI_BITS_PER_SAMPLE / 8) * durationSec;
    let authenticated = false;
    let timeoutId: NodeJS.Timeout;
    let connectionTimeoutId: NodeJS.Timeout;

    // Generate a random WebSocket ID
    const wsId = Math.floor(Math.random() * 1000000).toString();
    const wsUrl = `ws://${host}:${port}/kiwi/${wsId}/SND`;

    console.log(`[KiwiRecorder] Connecting to ${wsUrl} for ${durationSec}s recording at ${frequencyKhz} kHz ${mode}`);

    const ws = new WebSocket(wsUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 ValentineRF-Recorder/1.0",
      },
      handshakeTimeout: 10000,
    });

    // Connection timeout
    connectionTimeoutId = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.terminate();
        reject(new Error(`Connection timeout to ${host}:${port}`));
      }
    }, 15000);

    ws.on("open", () => {
      clearTimeout(connectionTimeoutId);
      console.log(`[KiwiRecorder] Connected to ${host}:${port}`);

      // Authenticate
      ws.send(`SET auth t=kiwi p=${password}`);

      // Configure audio
      const lowCut = mode === "cw" ? -250 : mode === "am" ? -4000 : 0;
      const highCut = mode === "cw" ? 250 : mode === "am" ? 4000 : 3000;
      ws.send(`SET mod=${mode} low_cut=${lowCut} high_cut=${highCut} freq=${frequencyKhz}`);
      ws.send("SET compression=0");
      ws.send("SET AR OK in=12000 out=12000");
      ws.send("SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50");

      authenticated = true;

      // Set recording duration timeout
      timeoutId = setTimeout(() => {
        console.log(`[KiwiRecorder] Recording complete from ${host}:${port} (${totalBytes} bytes)`);
        ws.close();
      }, durationSec * 1000 + 2000); // Extra 2s buffer
    });

    ws.on("message", (data: Buffer) => {
      if (!authenticated) return;

      // KiwiSDR sends binary audio frames
      // The first 3 bytes are a header: [flags, seq_lo, seq_hi]
      // The rest is PCM 16-bit LE audio data
      if (Buffer.isBuffer(data) && data.length > 3) {
        // Check if this is an audio data message
        const tag = data.toString("ascii", 0, 3);
        if (tag === "SND") {
          // Audio data starts after the SND tag + header bytes
          // KiwiSDR SND message format: "SND" + flags(1) + seq(4) + smeter(2) + audio_data
          const audioPayload = data.subarray(10); // Skip header
          if (audioPayload.length > 0 && totalBytes < targetBytes) {
            const remaining = targetBytes - totalBytes;
            const chunk = audioPayload.subarray(0, Math.min(audioPayload.length, remaining));
            audioChunks.push(Buffer.from(chunk));
            totalBytes += chunk.length;

            if (totalBytes >= targetBytes) {
              clearTimeout(timeoutId);
              console.log(`[KiwiRecorder] Target bytes reached from ${host}:${port}`);
              ws.close();
            }
          }
        }
      } else if (typeof data === "string" || (Buffer.isBuffer(data) && data.length <= 256)) {
        // Text message — could be status or error
        const msg = data.toString();
        if (msg.includes("too_busy") || msg.includes("inactivity")) {
          clearTimeout(timeoutId);
          ws.close();
          reject(new Error(`KiwiSDR ${host}:${port}: ${msg}`));
        }
      }
    });

    ws.on("close", () => {
      clearTimeout(timeoutId);
      clearTimeout(connectionTimeoutId);

      if (totalBytes > 0) {
        resolve(Buffer.concat(audioChunks));
      } else {
        reject(new Error(`No audio data received from ${host}:${port}`));
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeoutId);
      clearTimeout(connectionTimeoutId);
      reject(new Error(`WebSocket error connecting to ${host}:${port}: ${err.message}`));
    });
  });
}

/**
 * Record audio from all hosts in a TDoA job.
 * Runs recordings in parallel for efficiency.
 */
export async function recordAllHosts(
  jobId: number,
  hosts: Array<{ h: string; p: number }>,
  frequencyKhz: number,
  durationSec: number = 15,
  mode?: "am" | "usb" | "lsb" | "cw"
): Promise<RecordingResult[]> {
  console.log(`[KiwiRecorder] Starting recordings for job ${jobId} with ${hosts.length} hosts`);

  const results = await Promise.allSettled(
    hosts.map((host) =>
      recordKiwiAudio({
        host: host.h,
        port: host.p,
        hostId: `${host.h}:${host.p}`,
        frequencyKhz,
        mode: mode || detectMode(frequencyKhz),
        durationSec,
        jobId,
      })
    )
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      id: 0,
      hostId: `${hosts[i].h}:${hosts[i].p}`,
      fileUrl: "",
      fileKey: "",
      durationSec,
      fileSizeBytes: 0,
      status: "error" as const,
      errorMessage: r.reason?.message || "Recording failed",
    };
  });
}
