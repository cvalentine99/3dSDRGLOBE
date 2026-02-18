/**
 * AudioPlayer.tsx — Enhanced receiver embed with smart auto-tune, quick-tune presets,
 * recording guidance, auto-detection, and optimal iframe settings per receiver type
 * Design: "Ether" — frosted glass with cinematic controls
 */
import { useRadio } from "@/contexts/RadioContext";
import { motion, AnimatePresence } from "framer-motion";
import {
  Radio, ExternalLink, X, Volume2, Globe, Play, Disc,
  ChevronDown, ChevronUp, Zap, Crosshair, Mic, Info,
  Scan, Check, AlertTriangle, RefreshCw,
} from "lucide-react";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  buildTunedUrl,
  suggestMode,
  formatFrequency,
  getRecordingInfo,
  QUICK_TUNE_PRESETS,
  parseFrequencyToKhz,
  detectReceiverType,
  getOptimalIframeConfig,
  getClickToStartMessage,
  type SDRMode,
  type TuneParams,
  type ReceiverTypeId,
  type DetectionResult,
  type IframeConfig,
} from "@/lib/receiverUrls";
import { crossReferenceFrequencies } from "@/lib/frequencyCrossRef";

/**
 * Detect if embedding a URL will cause mixed content blocking.
 * Browsers block HTTP iframes when the parent page is served over HTTPS.
 */
function hasMixedContentIssue(receiverUrl: string): boolean {
  try {
    const pageProtocol = window.location.protocol; // "https:" or "http:"
    const receiverProtocol = new URL(receiverUrl).protocol;
    return pageProtocol === "https:" && receiverProtocol === "http:";
  } catch {
    return false;
  }
}

const TYPE_DOT: Record<string, string> = {
  OpenWebRX: "bg-cyan-400",
  WebSDR: "bg-primary",
  KiwiSDR: "bg-green-400",
};

const TYPE_COLOR: Record<string, string> = {
  KiwiSDR: "text-green-400",
  OpenWebRX: "text-cyan-400",
  WebSDR: "text-primary",
};

const TYPE_BG: Record<string, string> = {
  KiwiSDR: "bg-green-400/10",
  OpenWebRX: "bg-cyan-400/10",
  WebSDR: "bg-primary/10",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "text-green-400",
  medium: "text-amber-400",
  low: "text-red-400/70",
};

const CONFIDENCE_BG: Record<string, string> = {
  high: "bg-green-400/10 border-green-400/20",
  medium: "bg-amber-400/10 border-amber-400/20",
  low: "bg-red-400/10 border-red-400/20",
};

export default function AudioPlayer() {
  const { selectedReceiver, selectedStation, selectStation, setShowPanel } = useRadio();
  const [showEmbed, setShowEmbed] = useState(false);
  const [showQuickTune, setShowQuickTune] = useState(false);
  const [showRecording, setShowRecording] = useState(false);
  const [tuneParams, setTuneParams] = useState<TuneParams | null>(null);
  const [customFreq, setCustomFreq] = useState("");
  const [customMode, setCustomMode] = useState<SDRMode>("usb");
  const [iframeStarted, setIframeStarted] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [iframeLoadFailed, setIframeLoadFailed] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-detect receiver type from URL
  const detection: DetectionResult | null = useMemo(() => {
    if (!selectedReceiver) return null;
    return detectReceiverType(selectedReceiver.url, selectedReceiver.label);
  }, [selectedReceiver]);

  // Use the known type from data, but show detection result for verification
  const effectiveType: ReceiverTypeId = selectedReceiver?.type as ReceiverTypeId || detection?.type || "KiwiSDR";

  // Get optimal iframe config for the detected/known type
  const iframeConfig: IframeConfig = useMemo(() => {
    return getOptimalIframeConfig(effectiveType);
  }, [effectiveType]);

  // Get click-to-start message
  const startMessage = useMemo(() => {
    return getClickToStartMessage(effectiveType);
  }, [effectiveType]);

  // Detect mixed content (HTTPS page embedding HTTP receiver)
  const isMixedContent = useMemo(() => {
    return selectedReceiver ? hasMixedContentIssue(selectedReceiver.url) : false;
  }, [selectedReceiver]);

  // Get military frequencies for this station
  const milFreqs = useMemo(() => {
    if (!selectedStation) return [];
    return crossReferenceFrequencies(selectedStation);
  }, [selectedStation]);

  // Build the current embed URL
  const embedUrl = useMemo(() => {
    if (!selectedReceiver) return "";
    if (tuneParams) {
      return buildTunedUrl(selectedReceiver.url, effectiveType, tuneParams);
    }
    return selectedReceiver.url;
  }, [selectedReceiver, tuneParams, effectiveType]);

  // Recording info for current receiver type
  const recordingInfo = useMemo(() => {
    if (!selectedReceiver) return null;
    return getRecordingInfo(effectiveType);
  }, [selectedReceiver, effectiveType]);

  // Reset iframe state when receiver changes
  useEffect(() => {
    setIframeStarted(false);
    setIframeLoadFailed(false);
    setIframeKey((k) => k + 1);
    if (iframeLoadTimerRef.current) {
      clearTimeout(iframeLoadTimerRef.current);
      iframeLoadTimerRef.current = null;
    }
  }, [selectedReceiver?.url]);

  // Detect iframe load failure via timeout — if the iframe hasn't signaled
  // a successful load within 15s, it's likely blocked (mixed content, X-Frame-Options, etc.)
  useEffect(() => {
    if (!iframeStarted || isMixedContent) return;
    if (iframeLoadTimerRef.current) clearTimeout(iframeLoadTimerRef.current);
    iframeLoadTimerRef.current = setTimeout(() => {
      // Check if the iframe is blank/empty (heuristic for load failure)
      const iframe = iframeRef.current;
      if (iframe) {
        try {
          // Cross-origin iframes throw on contentDocument access — that's expected and means it loaded
          const _doc = iframe.contentDocument;
          // If we CAN access it and it's empty/about:blank, it likely failed
          if (_doc && (_doc.URL === "about:blank" || !_doc.body?.childElementCount)) {
            setIframeLoadFailed(true);
          }
        } catch {
          // SecurityError = cross-origin frame loaded successfully (normal)
        }
      }
    }, 15000);
    return () => {
      if (iframeLoadTimerRef.current) clearTimeout(iframeLoadTimerRef.current);
    };
  }, [iframeStarted, iframeKey, isMixedContent]);

  // Tune to a specific frequency
  const tuneTo = useCallback((freqKhz: number, mode?: SDRMode) => {
    const params: TuneParams = {
      frequencyKhz: freqKhz,
      mode: mode || suggestMode(freqKhz),
    };
    setTuneParams(params);
    setIframeKey((k) => k + 1);
    setIframeStarted(false);
    setIframeLoadFailed(false);
  }, []);

  // Handle custom frequency input
  const handleCustomTune = useCallback(() => {
    const khz = parseFrequencyToKhz(customFreq);
    if (khz && khz > 0) {
      tuneTo(khz, customMode);
      setShowQuickTune(false);
    }
  }, [customFreq, customMode, tuneTo]);

  if (!selectedReceiver || !selectedStation) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="absolute bottom-4 left-4 right-4 z-30"
      >
        {/* Embedded receiver iframe */}
        <AnimatePresence>
          {showEmbed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "70vh", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="mb-2 glass-panel rounded-2xl overflow-hidden relative"
              style={{
                maxHeight: "600px",
                minHeight: `${iframeConfig.minHeight}px`,
              }}
            >
              {/* Embed header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-primary" />
                  <span className="text-xs font-mono text-white/70">Live Signal Feed</span>
                  {tuneParams && (
                    <span className="text-[10px] font-mono text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 px-2 py-0.5 rounded-full">
                      {formatFrequency(tuneParams.frequencyKhz)} {tuneParams.mode?.toUpperCase()}
                    </span>
                  )}
                  {/* Auto-detected type badge */}
                  {detection && (
                    <span
                      className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full border flex items-center gap-1 ${CONFIDENCE_BG[detection.confidence]}`}
                      title={`Auto-detected: ${detection.reason}`}
                    >
                      <Scan className="w-2.5 h-2.5" />
                      <span className={`${TYPE_COLOR[effectiveType]}`}>{effectiveType}</span>
                      <span className={`${CONFIDENCE_COLORS[detection.confidence]}`}>
                        {detection.confidence === "high" ? "✓" : detection.confidence === "medium" ? "~" : "?"}
                      </span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {/* Quick Tune toggle */}
                  <button
                    onClick={() => { setShowQuickTune(!showQuickTune); setShowRecording(false); }}
                    className={`p-1.5 rounded-lg transition-all text-xs flex items-center gap-1 ${
                      showQuickTune ? "bg-cyan-400/20 text-cyan-400" : "hover:bg-white/5 text-white/50 hover:text-white/80"
                    }`}
                    title="Quick Tune"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline text-[10px] font-mono">Tune</span>
                  </button>
                  {/* Recording info toggle */}
                  <button
                    onClick={() => { setShowRecording(!showRecording); setShowQuickTune(false); }}
                    className={`p-1.5 rounded-lg transition-all text-xs flex items-center gap-1 ${
                      showRecording ? "bg-red-400/20 text-red-400" : "hover:bg-white/5 text-white/50 hover:text-white/80"
                    }`}
                    title="Recording Guide"
                  >
                    <Mic className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline text-[10px] font-mono">Rec</span>
                  </button>
                  {/* Open in new tab */}
                  <a
                    href={embedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg hover:bg-white/5 text-white/50 hover:text-white/80 transition-colors"
                    title="Open in new tab"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button
                    onClick={() => { setShowEmbed(false); setShowQuickTune(false); setShowRecording(false); }}
                    className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-white/50 hover:text-white/80"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Quick Tune Panel */}
              <AnimatePresence>
                {showQuickTune && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="border-b border-white/5 overflow-hidden"
                  >
                    <div className="p-3 space-y-3">
                      {/* Custom frequency input */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5">
                          <Zap className="w-3.5 h-3.5 text-cyan-400/60 shrink-0" />
                          <input
                            type="text"
                            value={customFreq}
                            onChange={(e) => setCustomFreq(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleCustomTune()}
                            placeholder="e.g. 7200 kHz or 14.1 MHz"
                            className="bg-transparent text-xs font-mono text-white/90 placeholder:text-white/25 outline-none flex-1 w-0"
                          />
                        </div>
                        <select
                          value={customMode}
                          onChange={(e) => setCustomMode(e.target.value as SDRMode)}
                          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] font-mono text-white/80 outline-none"
                        >
                          <option value="am">AM</option>
                          <option value="usb">USB</option>
                          <option value="lsb">LSB</option>
                          <option value="cw">CW</option>
                          <option value="nbfm">NFM</option>
                          <option value="wfm">WFM</option>
                        </select>
                        <button
                          onClick={handleCustomTune}
                          className="px-3 py-1.5 rounded-lg bg-cyan-400/15 border border-cyan-400/25 text-cyan-400 text-[10px] font-mono hover:bg-cyan-400/25 transition-colors"
                        >
                          Tune
                        </button>
                      </div>

                      {/* Quick presets */}
                      <div>
                        <p className="text-[9px] font-mono text-white/30 uppercase tracking-wider mb-1.5">Presets</p>
                        <div className="flex flex-wrap gap-1">
                          {QUICK_TUNE_PRESETS.map((preset) => (
                            <button
                              key={preset.label}
                              onClick={() => tuneTo(preset.freq, preset.mode)}
                              className="text-[9px] font-mono px-2 py-1 rounded-md bg-white/5 border border-white/8 text-white/60 hover:text-white/90 hover:bg-white/10 hover:border-white/15 transition-all"
                              title={`${preset.desc} — ${formatFrequency(preset.freq)} ${preset.mode.toUpperCase()}`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Military frequencies from cross-reference */}
                      {milFreqs.length > 0 && (
                        <div>
                          <p className="text-[9px] font-mono text-red-400/50 uppercase tracking-wider mb-1.5">
                            Mil-RF in Range ({milFreqs.length})
                          </p>
                          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                            {milFreqs.slice(0, 30).map((freq) => (
                              <button
                                key={freq.id}
                                onClick={() => {
                                  const mode = freq.signalType === "voice" ? suggestMode(freq.frequencyKhz) :
                                    freq.signalType === "digital" ? "usb" as SDRMode :
                                    freq.signalType === "beacon" ? "cw" as SDRMode :
                                    suggestMode(freq.frequencyKhz);
                                  tuneTo(freq.frequencyKhz, mode);
                                }}
                                className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/15 text-red-400/70 hover:text-red-400 hover:bg-red-500/20 transition-all"
                                title={`${freq.system} — ${freq.operator} — ${freq.description}`}
                              >
                                {freq.frequency} {freq.system.substring(0, 12)}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Recording Guide Panel */}
              <AnimatePresence>
                {showRecording && recordingInfo && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="border-b border-white/5 overflow-hidden"
                  >
                    <div className="p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Disc className={`w-4 h-4 ${recordingInfo.supported ? "text-red-400" : "text-white/30"}`} />
                        <span className="text-xs font-medium text-white/80">{recordingInfo.method}</span>
                        {recordingInfo.supported && (
                          <span className="text-[8px] font-mono text-green-400/80 bg-green-400/10 border border-green-400/20 px-1.5 py-0.5 rounded-full">
                            Available
                          </span>
                        )}
                      </div>
                      <div className="space-y-1">
                        {recordingInfo.instructions.map((step, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="text-[9px] font-mono text-white/25 shrink-0 w-4 text-right">{i + 1}.</span>
                            <span className="text-[10px] text-white/60 leading-relaxed">{step}</span>
                          </div>
                        ))}
                      </div>
                      {recordingInfo.formats.length > 0 && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[8px] font-mono text-white/25 uppercase">Formats:</span>
                          {recordingInfo.formats.map((fmt) => (
                            <span key={fmt} className="text-[8px] font-mono text-amber-400/70 bg-amber-400/10 border border-amber-400/15 px-1.5 py-0.5 rounded">
                              {fmt}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-start gap-1.5 mt-1 p-2 rounded-lg bg-amber-400/5 border border-amber-400/10">
                        <Info className="w-3 h-3 text-amber-400/50 shrink-0 mt-0.5" />
                        <span className="text-[9px] text-amber-400/60 leading-relaxed">
                          For best recording quality, open the receiver in a new tab using the external link button above.
                        </span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Mixed content warning — HTTPS page cannot embed HTTP receivers */}
              {isMixedContent && (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm z-10"
                  style={{ top: "41px" }}
                >
                  <div className="flex flex-col items-center gap-4 max-w-sm px-6">
                    <div className="w-16 h-16 rounded-full bg-amber-500/20 border-2 border-amber-500/40 flex items-center justify-center">
                      <AlertTriangle className="w-8 h-8 text-amber-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-white/90">Secure Connection Required</p>
                      <p className="text-xs text-white/50 mt-2 leading-relaxed">
                        This receiver uses HTTP but the app is served over HTTPS.
                        Browsers block mixed content for security. Open the receiver
                        directly in a new tab to access the waterfall and signal feed.
                      </p>
                    </div>
                    <a
                      href={embedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30 transition-all text-sm font-medium"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open in New Tab
                    </a>
                    <p className="text-[9px] text-white/25 font-mono text-center">
                      Tip: Signal intelligence data still works via the backend proxy
                    </p>
                  </div>
                </div>
              )}

              {/* Click-to-start overlay with type-specific messaging */}
              {!iframeStarted && !isMixedContent && (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-10 cursor-pointer"
                  style={{ top: "41px" }}
                  onClick={() => setIframeStarted(true)}
                >
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-20 h-20 rounded-full bg-primary/20 border-2 border-primary/40 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Play className="w-10 h-10 text-primary ml-1" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-white/90">{startMessage.title}</p>
                      <p className="text-xs text-white/50 mt-1 max-w-xs">
                        {startMessage.subtitle}
                      </p>
                      {tuneParams && (
                        <p className="text-[10px] font-mono text-cyan-400/80 mt-2">
                          Pre-tuned to {formatFrequency(tuneParams.frequencyKhz)} {tuneParams.mode?.toUpperCase()}
                        </p>
                      )}
                      {/* Type-specific tips */}
                      <div className="mt-3 space-y-1">
                        {iframeConfig.tips.slice(0, 2).map((tip, i) => (
                          <p key={i} className="text-[9px] text-white/30 font-mono">
                            {tip}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Iframe load failure fallback */}
              {iframeStarted && iframeLoadFailed && !isMixedContent && (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm z-10"
                  style={{ top: "41px" }}
                >
                  <div className="flex flex-col items-center gap-4 max-w-sm px-6">
                    <div className="w-16 h-16 rounded-full bg-red-500/20 border-2 border-red-500/40 flex items-center justify-center">
                      <AlertTriangle className="w-8 h-8 text-red-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-white/90">Receiver Embed Blocked</p>
                      <p className="text-xs text-white/50 mt-2 leading-relaxed">
                        This receiver may block iframe embedding (X-Frame-Options),
                        or may be temporarily offline. Open it directly for full access
                        to the waterfall and signal display.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={embedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30 transition-all text-sm font-medium"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Open in New Tab
                      </a>
                      <button
                        onClick={() => { setIframeLoadFailed(false); setIframeKey((k) => k + 1); }}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition-all text-sm"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Retry
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Iframe with optimal settings per receiver type */}
              {iframeStarted && !isMixedContent && (
                <iframe
                  key={iframeKey}
                  ref={iframeRef}
                  src={embedUrl}
                  className={`w-full ${iframeConfig.containerClass}`}
                  style={{ height: "calc(100% - 41px)" }}
                  title={`${effectiveType} Radio Receiver`}
                  sandbox={iframeConfig.sandbox}
                  allow={iframeConfig.allow}
                  scrolling={iframeConfig.scrolling}
                  loading={iframeConfig.loading}
                  referrerPolicy={iframeConfig.referrerPolicy as React.HTMLAttributeReferrerPolicy}
                  onError={() => setIframeLoadFailed(true)}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Player bar */}
        <div className="glass-panel rounded-2xl px-5 py-3.5 flex items-center gap-4">
          {/* Station indicator */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="relative">
              <div className={`w-10 h-10 rounded-xl ${TYPE_BG[effectiveType] || "bg-primary/10"} flex items-center justify-center`}>
                <Radio className={`w-5 h-5 ${TYPE_COLOR[effectiveType] || "text-primary"}`} />
              </div>
              {/* Pulsing live indicator */}
              <div className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full ${TYPE_DOT[effectiveType] || "bg-primary"}`}>
                <div className={`absolute inset-0 rounded-full ${TYPE_DOT[effectiveType] || "bg-primary"} animate-ping opacity-75`} />
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {selectedStation.label}
              </p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground truncate font-mono">
                  {effectiveType} • {selectedReceiver.version || "Live"}
                </p>
                {/* Detection confidence indicator */}
                {detection && detection.type === selectedReceiver.type && detection.confidence === "high" && (
                  <span className="text-[8px] font-mono text-green-400/50 flex items-center gap-0.5" title={detection.reason}>
                    <Check className="w-2.5 h-2.5" />
                    verified
                  </span>
                )}
                {detection && detection.type !== selectedReceiver.type && (
                  <span
                    className="text-[8px] font-mono text-amber-400/50 flex items-center gap-0.5"
                    title={`URL pattern suggests ${detection.type} (${detection.reason}), but data says ${selectedReceiver.type}`}
                  >
                    <AlertTriangle className="w-2.5 h-2.5" />
                    type mismatch
                  </span>
                )}
                {tuneParams && (
                  <span className="text-[9px] font-mono text-cyan-400/80 bg-cyan-400/10 border border-cyan-400/15 px-1.5 py-0.5 rounded-full shrink-0">
                    {formatFrequency(tuneParams.frequencyKhz)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {/* Quick tune button */}
            <button
              onClick={() => {
                if (!showEmbed) {
                  setShowEmbed(true);
                  setShowQuickTune(true);
                  setShowRecording(false);
                } else {
                  setShowQuickTune(!showQuickTune);
                  setShowRecording(false);
                }
              }}
              className={`p-2.5 rounded-xl transition-all duration-200 ${
                showQuickTune
                  ? "bg-cyan-400/20 text-cyan-400 glow-coral"
                  : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
              }`}
              title="Quick Tune"
            >
              <Crosshair className="w-5 h-5" />
            </button>

            {/* Embed toggle */}
            <button
              onClick={() => {
                setShowEmbed(!showEmbed);
                if (showEmbed) {
                  setShowQuickTune(false);
                  setShowRecording(false);
                }
              }}
              className={`p-2.5 rounded-xl transition-all duration-200 ${
                showEmbed
                  ? "bg-primary/20 text-primary glow-coral"
                  : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
              }`}
              title="Embed receiver"
            >
              <Volume2 className="w-5 h-5" />
            </button>

            {/* Open in new tab */}
            <a
              href={embedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2.5 rounded-xl bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground transition-all duration-200"
              title="Open in new tab"
            >
              <ExternalLink className="w-5 h-5" />
            </a>

            {/* Close */}
            <button
              onClick={() => {
                selectStation(null);
                setShowPanel(false);
                setShowEmbed(false);
                setShowQuickTune(false);
                setShowRecording(false);
                setTuneParams(null);
              }}
              className="p-2.5 rounded-xl bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground transition-all duration-200"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
