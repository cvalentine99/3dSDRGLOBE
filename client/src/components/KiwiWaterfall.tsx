/**
 * KiwiWaterfall.tsx — Live KiwiSDR Waterfall/Spectrogram Embed
 *
 * Embeds a live KiwiSDR receiver tuned to the TDoA target frequency,
 * allowing real-time signal monitoring alongside triangulation runs.
 * Uses an iframe pointed at the KiwiSDR web interface with URL parameters.
 */
import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Radio,
  X,
  Maximize2,
  Minimize2,
  ExternalLink,
  RefreshCw,
  Volume2,
  VolumeX,
  ChevronDown,
} from "lucide-react";

/* ── Types ────────────────────────────────────────── */

interface KiwiHost {
  h: string;
  p: number;
  id?: string;
  lat?: number;
  lon?: number;
  n?: string;
}

interface KiwiWaterfallProps {
  /** Currently selected TDoA hosts */
  hosts: KiwiHost[];
  /** Target frequency in kHz */
  frequencyKhz: number;
  /** Passband in Hz */
  passbandHz?: number;
  /** Whether the panel is visible */
  visible: boolean;
  /** Close callback */
  onClose: () => void;
}

/* ── Helpers ──────────────────────────────────────── */

/** Build a KiwiSDR URL with frequency and zoom parameters */
function buildKiwiUrl(
  host: string,
  port: number,
  freqKhz: number,
  passbandHz: number = 1000
): string {
  // Determine mode based on frequency
  let mode = "am";
  if (freqKhz < 500) mode = "cw"; // LF signals
  else if (freqKhz > 3000 && freqKhz < 30000) mode = "usb"; // HF default

  // Calculate zoom level based on passband
  let zoom = 10; // default
  if (passbandHz <= 500) zoom = 12;
  else if (passbandHz <= 2000) zoom = 10;
  else if (passbandHz <= 6000) zoom = 8;
  else zoom = 6;

  // Use our relay proxy to avoid mixed-content issues
  // The KiwiSDR runs on HTTP, but we serve over HTTPS
  // We'll embed via iframe with the direct KiwiSDR URL
  return `http://${host}:${port}/?f=${freqKhz}/${mode}&z=${zoom}`;
}

/* ── Component ────────────────────────────────────── */

export default function KiwiWaterfall({
  hosts,
  frequencyKhz,
  passbandHz = 1000,
  visible,
  onClose,
}: KiwiWaterfallProps) {
  const [selectedHostIdx, setSelectedHostIdx] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [muted, setMuted] = useState(true);
  const [iframeKey, setIframeKey] = useState(0);
  const [showHostPicker, setShowHostPicker] = useState(false);

  const selectedHost = hosts[selectedHostIdx] || hosts[0];

  const iframeUrl = useMemo(() => {
    if (!selectedHost) return null;
    return buildKiwiUrl(
      selectedHost.h,
      selectedHost.p,
      frequencyKhz,
      passbandHz
    );
  }, [selectedHost, frequencyKhz, passbandHz]);

  const directUrl = useMemo(() => {
    if (!selectedHost) return null;
    return `http://${selectedHost.h}:${selectedHost.p}`;
  }, [selectedHost]);

  const handleRefresh = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  if (!visible || hosts.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className={`fixed z-[60] ${
          expanded
            ? "inset-4"
            : "bottom-4 right-4 w-[520px] h-[380px]"
        } flex flex-col rounded-xl overflow-hidden border border-border bg-background/80 backdrop-blur-xl shadow-2xl`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 bg-foreground/5 border-b border-border">
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-green-400" />
            <span className="text-[11px] font-medium text-foreground/80">
              Live Waterfall
            </span>
            <span className="text-[9px] font-mono text-green-400/70 bg-green-500/10 px-1.5 py-0.5 rounded">
              {frequencyKhz.toLocaleString()} kHz
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* Host picker */}
            {hosts.length > 1 && (
              <button
                onClick={() => setShowHostPicker(!showHostPicker)}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] text-muted-foreground/70 hover:text-muted-foreground hover:bg-foreground/5 transition-colors"
                title="Switch receiver"
              >
                <span className="font-mono truncate max-w-[100px]">
                  {selectedHost?.h?.split(".")[0] || "Host"}
                </span>
                <ChevronDown
                  className={`w-2.5 h-2.5 transition-transform ${
                    showHostPicker ? "rotate-180" : ""
                  }`}
                />
              </button>
            )}
            {/* Mute toggle */}
            <button
              onClick={() => setMuted(!muted)}
              className="p-1 rounded text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/5 transition-colors"
              title={muted ? "Unmute audio" : "Mute audio"}
            >
              {muted ? (
                <VolumeX className="w-3.5 h-3.5" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
            </button>
            {/* Refresh */}
            <button
              onClick={handleRefresh}
              className="p-1 rounded text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/5 transition-colors"
              title="Reload receiver"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            {/* Open in new tab */}
            {directUrl && (
              <a
                href={directUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 rounded text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/5 transition-colors"
                title="Open receiver in new tab"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            {/* Expand/collapse */}
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 rounded text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/5 transition-colors"
              title={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
            {/* Close */}
            <button
              onClick={onClose}
              className="p-1 rounded text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/5 transition-colors"
              title="Close waterfall"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Host picker dropdown */}
        <AnimatePresence>
          {showHostPicker && hosts.length > 1 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="border-b border-border bg-background/50 overflow-hidden"
            >
              <div className="px-3 py-2 space-y-1 max-h-32 overflow-y-auto scrollbar-thin">
                <p className="text-[8px] text-muted-foreground/50 uppercase tracking-wider">
                  Select Receiver
                </p>
                {hosts.map((host, idx) => (
                  <button
                    key={`${host.h}:${host.p}`}
                    onClick={() => {
                      setSelectedHostIdx(idx);
                      setShowHostPicker(false);
                      setIframeKey((k) => k + 1);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded text-[10px] transition-colors ${
                      idx === selectedHostIdx
                        ? "bg-green-500/15 border border-green-500/20 text-green-300"
                        : "bg-foreground/5 border border-border text-muted-foreground hover:bg-foreground/10 hover:text-foreground/70"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono truncate">
                        {host.h}:{host.p}
                      </span>
                      {host.n && (
                        <span className="text-[8px] text-muted-foreground/50 ml-2 truncate">
                          {host.n}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Iframe body */}
        <div className="flex-1 relative bg-black">
          {iframeUrl ? (
            <>
              <iframe
                key={iframeKey}
                src={iframeUrl}
                className="absolute inset-0 w-full h-full border-0"
                allow={muted ? "" : "autoplay"}
                sandbox="allow-scripts allow-same-origin allow-popups"
                title="KiwiSDR Live Waterfall"
              />
              {/* Mute overlay — covers iframe to prevent audio autoplay */}
              {muted && (
                <div
                  className="absolute inset-0 z-10 cursor-pointer"
                  onClick={() => setMuted(false)}
                  title="Click to unmute and interact"
                  style={{ pointerEvents: "auto" }}
                >
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/80 border border-border text-muted-foreground text-[10px]">
                    <VolumeX className="w-3 h-3" />
                    Click to interact with receiver
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <Radio className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-[11px] text-muted-foreground/50">
                  No receiver selected
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-background/50 border-t border-border text-[9px] text-muted-foreground/50">
          <span className="font-mono">
            {selectedHost?.h}:{selectedHost?.p}
          </span>
          <div className="flex items-center gap-2">
            <span>
              {frequencyKhz.toLocaleString()} kHz / {passbandHz} Hz PB
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
