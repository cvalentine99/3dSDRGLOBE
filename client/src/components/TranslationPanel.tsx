/**
 * TranslationPanel.tsx — Live radio translation overlay
 *
 * Server-side architecture:
 *   1. User clicks Start → frontend calls POST /api/translate/start with receiver host/port/freq
 *   2. Server connects directly to KiwiSDR WebSocket, captures PCM audio
 *   3. Every 15s, server sends audio chunk to Whisper API
 *   4. Results stream back to frontend via SSE (Server-Sent Events)
 *   5. No browser audio permissions needed — all audio capture is server-side
 *
 * Modes:
 *   - Dual: Side-by-side original transcription + English translation
 *   - Translate: Foreign audio → English text only
 *   - Transcribe: Audio → same-language text only
 *
 * Design: "Ether" — frosted glass with monospace transcript
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Languages, Radio, Square, Settings2,
  ChevronDown, Loader2, AlertCircle,
  Copy, Check, Trash2, Columns2, AlignLeft,
  Wifi, WifiOff,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────
interface TranslationEntry {
  id: string;
  chunkIndex: number;
  text: string;                     // Primary text (translated or transcribed)
  originalText?: string | null;     // Original-language text (dual mode only)
  detectedLanguage: string;
  duration: number;
  processingTimeMs: number;
  timestamp: number;                // wall-clock ms
  isEnglishSource?: boolean;
}

type TranslationMode = "dual" | "translate" | "transcribe";

// ── Constants ───────────────────────────────────────────────────────────────
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
  receiverUrl?: string;        // e.g. "http://kiwisdr.example.com:8073"
  frequencyKhz?: number;       // current tuned frequency
  sdrMode?: string;            // current modulation mode
  isVisible: boolean;
  onClose: () => void;
}

export default function TranslationPanel({
  stationLabel,
  receiverUrl,
  frequencyKhz,
  sdrMode,
  isVisible,
  onClose,
}: TranslationPanelProps) {
  // State
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [mode, setMode] = useState<TranslationMode>("dual");
  const [sourceLanguage, setSourceLanguage] = useState<string>("");
  const [history, setHistory] = useState<TranslationEntry[]>([]);
  const [statusText, setStatusText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [chunkCount, setChunkCount] = useState(0);

  // Refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, statusText]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopTranslation();
    };
  }, []);

  // ── Extract host/port from receiver URL ──────────────────────────────────
  function parseReceiverUrl(url: string): { host: string; port: number } | null {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname;
      const port = parsed.port ? parseInt(parsed.port) : 8073; // KiwiSDR default
      return { host, port };
    } catch {
      return null;
    }
  }

  // ── Start server-side translation ────────────────────────────────────────
  const startTranslation = useCallback(async () => {
    if (!receiverUrl) {
      setError("No receiver URL available. Select a KiwiSDR station first.");
      return;
    }

    const parsed = parseReceiverUrl(receiverUrl);
    if (!parsed) {
      setError("Invalid receiver URL. Cannot extract host/port.");
      return;
    }

    setError(null);
    setIsConnecting(true);
    setStatusText("Connecting to server...");

    // Abort any existing connection
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch("/api/translate/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: parsed.host,
          port: parsed.port,
          frequencyKhz: frequencyKhz || 7200,
          mode: sdrMode || "am",
          language: sourceLanguage || undefined,
          dualMode: mode === "dual",
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errData.error || `Server error ${response.status}`);
      }

      setIsConnected(true);
      setIsConnecting(false);

      // Read SSE stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);
            handleSSEEvent(event);
          } catch {
            // Ignore malformed events
          }
        }
      }

      // Stream ended
      setIsConnected(false);
      setStatusText("");
    } catch (err: any) {
      if (err.name === "AbortError") return; // User stopped
      console.error("[TranslationPanel] Connection error:", err);
      setError(err.message || "Connection failed");
      setIsConnected(false);
      setIsConnecting(false);
      setStatusText("");
    }
  }, [receiverUrl, frequencyKhz, sdrMode, mode, sourceLanguage]);

  // ── Handle SSE events ────────────────────────────────────────────────────
  const handleSSEEvent = useCallback((event: { type: string; data: any }) => {
    switch (event.type) {
      case "status":
        setStatusText(typeof event.data === "string" ? event.data : "");
        break;

      case "translation": {
        const chunk = event.data;
        setChunkCount((c) => c + 1);
        setStatusText("");

        const originalText = chunk.original?.text || null;
        const translatedText = chunk.translated?.text || null;
        const primaryText = translatedText || originalText || "";

        if (!primaryText.trim()) {
          setStatusText("(no speech detected)");
          setTimeout(() => setStatusText(""), 2000);
          break;
        }

        const entry: TranslationEntry = {
          id: `${Date.now()}-${chunk.chunkIndex}`,
          chunkIndex: chunk.chunkIndex,
          text: primaryText,
          originalText: originalText,
          detectedLanguage: chunk.detectedLanguage || "unknown",
          duration: chunk.duration || 0,
          processingTimeMs: chunk.processingTimeMs || 0,
          timestamp: Date.now(),
          isEnglishSource: chunk.isEnglishSource,
        };

        setHistory((prev) => [...prev, entry].slice(-MAX_HISTORY));
        break;
      }

      case "error":
        setError(typeof event.data === "string" ? event.data : "Translation error");
        setTimeout(() => setError(null), 8000);
        break;

      case "done":
        setIsConnected(false);
        setStatusText("Session ended");
        setTimeout(() => setStatusText(""), 3000);
        break;
    }
  }, []);

  // ── Stop translation ─────────────────────────────────────────────────────
  const stopTranslation = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setIsConnected(false);
    setIsConnecting(false);
    setStatusText("");

    // Also tell the server to stop
    try {
      await fetch("/api/translate/stop", { method: "POST" });
    } catch {
      // Ignore — server may already be stopped
    }
  }, []);

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
        if (e.originalText && e.text !== e.originalText) {
          return `[${time}] (${lang})\n  Original: ${e.originalText}\n  English:  ${e.text}`;
        }
        return `[${time}] (${lang}) ${e.text}`;
      })
      .join("\n\n");
    navigator.clipboard.writeText(fullText);
    setCopiedId("all");
    setTimeout(() => setCopiedId(null), 2000);
  }, [history]);

  // Clear history
  const clearHistory = useCallback(() => {
    setHistory([]);
    setChunkCount(0);
  }, []);

  const formatTime = (ms: number) => new Date(ms).toLocaleTimeString();

  if (!isVisible) return null;

  // Panel width: wider in dual mode for side-by-side
  const panelWidth = mode === "dual" ? "w-[620px]" : "w-[420px]";

  // Parse receiver info for display
  const receiverInfo = receiverUrl ? parseReceiverUrl(receiverUrl) : null;
  const isKiwiSDR = receiverUrl?.includes("8073") || receiverUrl?.toLowerCase().includes("kiwi");

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className={`absolute bottom-20 right-4 z-40 ${panelWidth} max-h-[60vh] flex flex-col glass-panel rounded-2xl overflow-hidden`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Languages className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">
              {mode === "dual" ? "Dual Translation" : mode === "translate" ? "Live Translation" : "Transcription"}
            </span>
            {isConnected && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[10px] font-mono text-green-400">LIVE</span>
              </span>
            )}
            {isConnecting && (
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
                {/* Mode toggle — 3 options */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-16">Mode</span>
                  <div className="flex rounded-lg overflow-hidden border border-border">
                    <button
                      onClick={() => setMode("dual")}
                      disabled={isConnected}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono transition-all ${
                        mode === "dual"
                          ? "bg-primary/20 text-primary"
                          : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10"
                      } ${isConnected ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <Columns2 className="w-3 h-3" />
                      Dual
                    </button>
                    <button
                      onClick={() => setMode("translate")}
                      disabled={isConnected}
                      className={`px-3 py-1.5 text-xs font-mono transition-all ${
                        mode === "translate"
                          ? "bg-primary/20 text-primary"
                          : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10"
                      } ${isConnected ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      Translate → EN
                    </button>
                    <button
                      onClick={() => setMode("transcribe")}
                      disabled={isConnected}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono transition-all ${
                        mode === "transcribe"
                          ? "bg-primary/20 text-primary"
                          : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10"
                      } ${isConnected ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <AlignLeft className="w-3 h-3" />
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
                    disabled={isConnected}
                    className="flex-1 px-3 py-1.5 text-xs font-mono bg-foreground/5 border border-border rounded-lg text-foreground appearance-none cursor-pointer disabled:opacity-50"
                  >
                    <option value="">Auto-detect</option>
                    {Object.entries(LANG_NAMES).map(([code, name]) => (
                      <option key={code} value={code}>{name}</option>
                    ))}
                  </select>
                </div>

                {/* Connection info */}
                <div className="text-[10px] text-muted-foreground/60 font-mono space-y-0.5">
                  <p>
                    Server-side audio capture via KiwiSDR WebSocket
                    {receiverInfo && ` → ${receiverInfo.host}:${receiverInfo.port}`}
                  </p>
                  <p>Chunks: 15s • Processed: {chunkCount} • Max session: 10 min</p>
                  {mode === "dual" && <p>Parallel: transcribe + translate (Whisper API)</p>}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Translation log */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto min-h-[120px] max-h-[40vh] px-4 py-3 space-y-3"
        >
          {/* Empty state */}
          {history.length === 0 && !statusText && !isConnected && !isConnecting && (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-8">
              <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                {mode === "dual" ? (
                  <Columns2 className="w-6 h-6 text-primary/50" />
                ) : (
                  <Languages className="w-6 h-6 text-primary/50" />
                )}
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">
                  {mode === "dual"
                    ? "Dual mode: original transcription + English translation side by side"
                    : mode === "translate"
                      ? "Translate radio broadcasts to English"
                      : "Transcribe radio audio to text"}
                </p>
                <p className="text-[10px] text-muted-foreground/50 mt-1 font-mono">
                  {!receiverUrl
                    ? "Select a KiwiSDR station to enable translation"
                    : !isKiwiSDR
                      ? "Translation works best with KiwiSDR receivers"
                      : `Ready to translate from ${receiverInfo?.host || "receiver"}`}
                </p>
                <p className="text-[10px] text-muted-foreground/30 mt-1 font-mono">
                  Audio captured server-side — no microphone needed
                </p>
              </div>
            </div>
          )}

          {/* Connecting state */}
          {isConnecting && history.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-8">
              <Loader2 className="w-8 h-8 text-primary/50 animate-spin" />
              <p className="text-xs text-muted-foreground font-mono">
                {statusText || "Connecting to KiwiSDR..."}
              </p>
            </div>
          )}

          {/* Recording waiting state */}
          {isConnected && history.length === 0 && !statusText && (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-8">
              <div className="relative">
                <Wifi className="w-8 h-8 text-green-400/50" />
                <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-green-500 animate-pulse" />
              </div>
              <p className="text-xs text-muted-foreground font-mono">
                Connected — first translation in ~15s
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
              {/* Timestamp + language badge row */}
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[9px] font-mono text-muted-foreground/50">
                  {formatTime(entry.timestamp)}
                </span>
                <span className="text-[9px] font-mono text-cyan-400/70 bg-cyan-400/10 px-1.5 py-0.5 rounded">
                  {LANG_NAMES[entry.detectedLanguage] || entry.detectedLanguage}
                </span>
                <span className="text-[9px] font-mono text-muted-foreground/30">
                  {entry.duration.toFixed(1)}s • {entry.processingTimeMs}ms
                </span>
                {entry.isEnglishSource && (
                  <span className="text-[9px] font-mono text-amber-400/70 bg-amber-400/10 px-1.5 py-0.5 rounded">
                    EN source
                  </span>
                )}
                <button
                  onClick={() => {
                    const fullText = entry.originalText
                      ? `Original: ${entry.originalText}\nEnglish: ${entry.text}`
                      : entry.text;
                    copyText(entry.id, fullText);
                  }}
                  className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-foreground/5 hover:bg-foreground/10 ml-auto"
                  title="Copy"
                >
                  {copiedId === entry.id ? (
                    <Check className="w-3 h-3 text-green-400" />
                  ) : (
                    <Copy className="w-3 h-3 text-muted-foreground" />
                  )}
                </button>
              </div>

              {/* Content: dual or single */}
              {mode === "dual" && entry.originalText && entry.text !== entry.originalText ? (
                /* ── Side-by-side dual display ── */
                <div className="grid grid-cols-2 gap-3">
                  {/* Original language column */}
                  <div className="rounded-lg bg-foreground/[0.03] border border-border/50 px-3 py-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[9px] font-mono text-orange-400/80 uppercase tracking-wider">
                        Original
                      </span>
                    </div>
                    <p className="text-sm text-foreground/70 leading-relaxed" dir="auto">
                      {entry.originalText}
                    </p>
                  </div>

                  {/* English translation column */}
                  <div className="rounded-lg bg-primary/[0.03] border border-primary/20 px-3 py-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[9px] font-mono text-primary/80 uppercase tracking-wider">
                        English
                      </span>
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed">
                      {entry.text}
                    </p>
                  </div>
                </div>
              ) : (
                /* ── Single-column display ── */
                <p className="text-sm text-foreground/90 leading-relaxed pl-1">
                  {entry.text}
                </p>
              )}
            </motion.div>
          ))}

          {/* Status text */}
          {statusText && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 text-xs text-muted-foreground/70 font-mono"
            >
              {isConnected && <Loader2 className="w-3 h-3 animate-spin" />}
              {statusText}
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
              {isConnected ? (
                <span className="flex items-center gap-1">
                  <Wifi className="w-3 h-3 text-green-400" />
                  {receiverInfo?.host}:{receiverInfo?.port} • {frequencyKhz || "?"} kHz
                </span>
              ) : (
                <>
                  {mode === "dual" ? "Original + English" : mode === "translate" ? "→ English" : "Original"} •{" "}
                  {sourceLanguage ? LANG_NAMES[sourceLanguage] : "Auto"}
                </>
              )}
            </span>
          </div>
          <button
            onClick={isConnected || isConnecting ? stopTranslation : startTranslation}
            disabled={!receiverUrl && !isConnected}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              isConnected || isConnecting
                ? "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
                : !receiverUrl
                  ? "bg-foreground/5 text-muted-foreground/30 border border-border cursor-not-allowed"
                  : "bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30"
            }`}
          >
            {isConnected || isConnecting ? (
              <>
                <Square className="w-4 h-4" />
                Stop
              </>
            ) : (
              <>
                <Radio className="w-4 h-4" />
                Start
              </>
            )}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
