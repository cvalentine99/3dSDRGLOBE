/**
 * TranslationPanel.tsx — Live radio translation overlay
 * Captures audio from the browser tab, sends chunks to the Whisper API,
 * and displays rolling English subtitles.
 *
 * Double-buffer approach (mirrors translate.py):
 *   Records chunk N+1 while the server translates chunk N.
 *
 * Design: "Ether" — frosted glass with monospace transcript
 */
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Languages, Mic, MicOff, Square, Settings2,
  ChevronDown, ChevronUp, Clock, Loader2, AlertCircle,
  Volume2, Copy, Check, Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

// ── Types ───────────────────────────────────────────────────────────────────
interface TranslationEntry {
  id: string;
  chunkIndex: number;
  text: string;
  detectedLanguage: string;
  duration: number;
  processingTimeMs: number;
  timestamp: number; // wall-clock ms
  segments: { start: number; end: number; text: string }[];
  task: string;
}

type TranslationMode = "translate" | "transcribe";

// ── Constants ───────────────────────────────────────────────────────────────
const CHUNK_DURATION_MS = 20_000; // 20 seconds per chunk
const MAX_HISTORY = 100;

// Language name lookup
const LANG_NAMES: Record<string, string> = {
  ar: "Arabic", zh: "Chinese", cs: "Czech", da: "Danish", nl: "Dutch",
  en: "English", fi: "Finnish", fr: "French", de: "German", el: "Greek",
  he: "Hebrew", hi: "Hindi", hu: "Hungarian", id: "Indonesian", it: "Italian",
  ja: "Japanese", ko: "Korean", ms: "Malay", no: "Norwegian", fa: "Persian",
  pl: "Polish", pt: "Portuguese", ro: "Romanian", ru: "Russian", es: "Spanish",
  sv: "Swedish", th: "Thai", tr: "Turkish", uk: "Ukrainian", ur: "Urdu",
  vi: "Vietnamese",
};

// ── Component ───────────────────────────────────────────────────────────────
interface TranslationPanelProps {
  stationLabel?: string;
  isVisible: boolean;
  onClose: () => void;
}

export default function TranslationPanel({ stationLabel, isVisible, onClose }: TranslationPanelProps) {
  // State
  const [isRecording, setIsRecording] = useState(false);
  const [mode, setMode] = useState<TranslationMode>("translate");
  const [sourceLanguage, setSourceLanguage] = useState<string>(""); // empty = auto-detect
  const [history, setHistory] = useState<TranslationEntry[]>([]);
  const [currentText, setCurrentText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const chunkIndexRef = useRef(0);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // tRPC mutations
  const translateMutation = trpc.translation.translateChunk.useMutation();
  const transcribeMutation = trpc.translation.transcribeChunk.useMutation();

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, currentText]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  // ── Audio capture ─────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      setError(null);

      // Use getDisplayMedia to capture tab audio (the radio stream)
      // This captures whatever audio is playing in the browser
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: false, // We only want audio
        });
      } catch (displayErr) {
        // Fallback: if getDisplayMedia fails (e.g., user denies screen share),
        // try getUserMedia with microphone (user can hold mic to speaker)
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          });
          setError("Using microphone input — for best results, share your browser tab audio.");
        } catch {
          setError("No audio source available. Please allow microphone or tab audio sharing.");
          return;
        }
      }

      streamRef.current = stream;

      // Determine best supported MIME type
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/ogg";

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 64000, // Keep chunks small
      });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      chunkIndexRef.current = 0;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(1000); // Collect data every second
      setIsRecording(true);
      setChunkCount(0);

      // Set up chunk processing interval (double-buffer)
      recordingIntervalRef.current = setInterval(() => {
        processCurrentChunk();
      }, CHUNK_DURATION_MS);

    } catch (err) {
      console.error("[Translation] Failed to start recording:", err);
      setError(`Failed to start audio capture: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [mode, sourceLanguage]);

  const stopRecording = useCallback(() => {
    // Stop the media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    // Stop all tracks on the stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Clear the interval
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    // Process any remaining audio
    if (audioChunksRef.current.length > 0) {
      processCurrentChunk();
    }

    setIsRecording(false);
  }, []);

  const processCurrentChunk = useCallback(async () => {
    const chunks = audioChunksRef.current;
    audioChunksRef.current = []; // Reset for next chunk (double-buffer)

    if (chunks.length === 0) return;

    const blob = new Blob(chunks, { type: chunks[0].type });

    // Skip very small chunks (likely silence)
    if (blob.size < 1000) return;

    const chunkIdx = chunkIndexRef.current++;
    setChunkCount((c) => c + 1);
    setIsProcessing(true);
    setCurrentText("Translating...");

    try {
      // Convert blob to base64
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
      );

      const mimeType = blob.type || "audio/webm";

      // Call the appropriate mutation
      const mutation = mode === "translate" ? translateMutation : transcribeMutation;
      const result = await mutation.mutateAsync({
        audioBase64: base64,
        mimeType,
        language: sourceLanguage || undefined,
        chunkIndex: chunkIdx,
        ...(mode === "translate" ? { stationLabel } : {}),
      });

      if (result.text && result.text.trim()) {
        const entry: TranslationEntry = {
          id: `${Date.now()}-${chunkIdx}`,
          chunkIndex: result.chunkIndex,
          text: result.text,
          detectedLanguage: result.detectedLanguage,
          duration: result.duration,
          processingTimeMs: result.processingTimeMs,
          timestamp: Date.now(),
          segments: result.segments,
          task: result.task,
        };

        setHistory((prev) => {
          const next = [...prev, entry];
          return next.slice(-MAX_HISTORY);
        });
        setCurrentText("");
      } else {
        setCurrentText("(no speech detected)");
        setTimeout(() => setCurrentText(""), 2000);
      }
    } catch (err) {
      console.error("[Translation] Chunk processing failed:", err);
      setCurrentText("");
      setError(`Translation failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      // Clear error after 5s
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsProcessing(false);
    }
  }, [mode, sourceLanguage, stationLabel, translateMutation, transcribeMutation]);

  // Copy text to clipboard
  const copyText = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  // Copy all history
  const copyAllHistory = useCallback(() => {
    const fullText = history
      .map((e) => {
        const time = new Date(e.timestamp).toLocaleTimeString();
        const lang = LANG_NAMES[e.detectedLanguage] || e.detectedLanguage;
        return `[${time}] (${lang}) ${e.text}`;
      })
      .join("\n");
    navigator.clipboard.writeText(fullText);
    setCopiedId("all");
    setTimeout(() => setCopiedId(null), 2000);
  }, [history]);

  // Clear history
  const clearHistory = useCallback(() => {
    setHistory([]);
    setCurrentText("");
    setChunkCount(0);
  }, []);

  // Format timestamp
  const formatTime = (ms: number) => new Date(ms).toLocaleTimeString();

  if (!isVisible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="absolute bottom-20 right-4 z-40 w-[420px] max-h-[60vh] flex flex-col glass-panel rounded-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Languages className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">
              Live {mode === "translate" ? "Translation" : "Transcription"}
            </span>
            {isRecording && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[10px] font-mono text-red-400">LIVE</span>
              </span>
            )}
            {isProcessing && (
              <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {history.length > 0 && (
              <>
                <button
                  onClick={copyAllHistory}
                  className="p-1.5 rounded-lg bg-foreground/5 text-muted-foreground hover:bg-foreground/10 transition-all"
                  title="Copy all"
                >
                  {copiedId === "all" ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={clearHistory}
                  className="p-1.5 rounded-lg bg-foreground/5 text-muted-foreground hover:bg-foreground/10 transition-all"
                  title="Clear history"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-1.5 rounded-lg transition-all ${
                showSettings ? "bg-primary/20 text-primary" : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10"
              }`}
              title="Settings"
            >
              <Settings2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-foreground/5 text-muted-foreground hover:bg-foreground/10 transition-all"
              title="Close"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Settings panel */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-b border-border overflow-hidden"
            >
              <div className="px-4 py-3 space-y-3">
                {/* Mode toggle */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-16">Mode</span>
                  <div className="flex rounded-lg overflow-hidden border border-border">
                    <button
                      onClick={() => setMode("translate")}
                      className={`px-3 py-1.5 text-xs font-mono transition-all ${
                        mode === "translate"
                          ? "bg-primary/20 text-primary"
                          : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10"
                      }`}
                    >
                      Translate → EN
                    </button>
                    <button
                      onClick={() => setMode("transcribe")}
                      className={`px-3 py-1.5 text-xs font-mono transition-all ${
                        mode === "transcribe"
                          ? "bg-primary/20 text-primary"
                          : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10"
                      }`}
                    >
                      Transcribe
                    </button>
                  </div>
                </div>

                {/* Source language */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-16">Source</span>
                  <select
                    value={sourceLanguage}
                    onChange={(e) => setSourceLanguage(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs font-mono bg-foreground/5 border border-border rounded-lg text-foreground appearance-none cursor-pointer"
                  >
                    <option value="">Auto-detect</option>
                    {Object.entries(LANG_NAMES).map(([code, name]) => (
                      <option key={code} value={code}>{name}</option>
                    ))}
                  </select>
                </div>

                {/* Info */}
                <p className="text-[10px] text-muted-foreground/60 font-mono">
                  Chunks: {CHUNK_DURATION_MS / 1000}s • Processed: {chunkCount} • Buffer: double
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Translation log */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto min-h-[120px] max-h-[40vh] px-4 py-3 space-y-2"
        >
          {history.length === 0 && !currentText && !isRecording && (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-8">
              <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Languages className="w-6 h-6 text-primary/50" />
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">
                  {mode === "translate" ? "Translate radio broadcasts to English" : "Transcribe radio audio to text"}
                </p>
                <p className="text-[10px] text-muted-foreground/50 mt-1 font-mono">
                  Press the microphone button to start capturing audio
                </p>
              </div>
            </div>
          )}

          {history.length === 0 && !currentText && isRecording && (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-8">
              <Loader2 className="w-8 h-8 text-primary/50 animate-spin" />
              <p className="text-xs text-muted-foreground font-mono">
                Recording... first translation in ~{CHUNK_DURATION_MS / 1000}s
              </p>
            </div>
          )}

          {/* History entries */}
          {history.map((entry) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="group relative"
            >
              <div className="flex items-start gap-2">
                <div className="shrink-0 mt-1">
                  <span className="text-[9px] font-mono text-muted-foreground/50">
                    {formatTime(entry.timestamp)}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[9px] font-mono text-cyan-400/70 bg-cyan-400/10 px-1.5 py-0.5 rounded">
                      {LANG_NAMES[entry.detectedLanguage] || entry.detectedLanguage}
                    </span>
                    <span className="text-[9px] font-mono text-muted-foreground/30">
                      {entry.duration.toFixed(1)}s • {entry.processingTimeMs}ms
                    </span>
                  </div>
                  <p className="text-sm text-foreground/90 leading-relaxed">
                    {entry.text}
                  </p>
                </div>
                <button
                  onClick={() => copyText(entry.id, entry.text)}
                  className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-foreground/5 hover:bg-foreground/10"
                  title="Copy"
                >
                  {copiedId === entry.id ? (
                    <Check className="w-3 h-3 text-green-400" />
                  ) : (
                    <Copy className="w-3 h-3 text-muted-foreground" />
                  )}
                </button>
              </div>
            </motion.div>
          ))}

          {/* Current processing indicator */}
          {currentText && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 text-xs text-muted-foreground/70 font-mono"
            >
              <Loader2 className="w-3 h-3 animate-spin" />
              {currentText}
            </motion.div>
          )}
        </div>

        {/* Error bar */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="px-4 py-2 bg-red-500/10 border-t border-red-500/20"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <p className="text-[10px] text-red-400 font-mono">{error}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Controls bar */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-muted-foreground/50">
              {mode === "translate" ? "→ English" : "Original"} •{" "}
              {sourceLanguage ? LANG_NAMES[sourceLanguage] : "Auto"}
            </span>
          </div>
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              isRecording
                ? "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
                : "bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30"
            }`}
          >
            {isRecording ? (
              <>
                <Square className="w-4 h-4" />
                Stop
              </>
            ) : (
              <>
                <Mic className="w-4 h-4" />
                Start
              </>
            )}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
