/**
 * AudioPlayer.tsx — Floating bottom audio player bar
 * Design: "Ether" — minimal frosted glass bar with station info and controls
 * Opens the receiver URL in an embedded iframe for streaming
 */
import { useRadio } from "@/contexts/RadioContext";
import { motion, AnimatePresence } from "framer-motion";
import { Radio, ExternalLink, X, Volume2, Globe } from "lucide-react";
import { useState } from "react";

const TYPE_DOT: Record<string, string> = {
  OpenWebRX: "bg-cyan-400",
  WebSDR: "bg-primary",
  KiwiSDR: "bg-green-400",
};

export default function AudioPlayer() {
  const { selectedReceiver, selectedStation, selectStation, setShowPanel, isPlaying, setIsPlaying } = useRadio();
  const [showEmbed, setShowEmbed] = useState(false);

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
              animate={{ height: 400, opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="mb-2 glass-panel rounded-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-primary" />
                  <span className="text-xs font-mono text-muted-foreground">Live Signal Feed</span>
                </div>
                <button
                  onClick={() => setShowEmbed(false)}
                  className="p-1 rounded-lg hover:bg-white/5 transition-colors text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <iframe
                src={selectedReceiver.url}
                className="w-full"
                style={{ height: "calc(100% - 40px)" }}
                title="Radio Receiver"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Player bar */}
        <div className="glass-panel rounded-2xl px-5 py-3.5 flex items-center gap-4">
          {/* Station indicator */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="relative">
              <div className={`w-10 h-10 rounded-xl ${selectedReceiver.type === "KiwiSDR" ? "bg-green-400/10" : selectedReceiver.type === "OpenWebRX" ? "bg-cyan-400/10" : "bg-primary/10"} flex items-center justify-center`}>
                <Radio className={`w-5 h-5 ${selectedReceiver.type === "KiwiSDR" ? "text-green-400" : selectedReceiver.type === "OpenWebRX" ? "text-cyan-400" : "text-primary"}`} />
              </div>
              {/* Pulsing live indicator */}
              <div className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full ${TYPE_DOT[selectedReceiver.type] || "bg-primary"}`}>
                <div className={`absolute inset-0 rounded-full ${TYPE_DOT[selectedReceiver.type] || "bg-primary"} animate-ping opacity-75`} />
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {selectedStation.label}
              </p>
              <p className="text-xs text-muted-foreground truncate font-mono">
                {selectedReceiver.type} • {selectedReceiver.version || "Live"}
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowEmbed(!showEmbed)}
              className={`p-2.5 rounded-xl transition-all duration-200 ${
                showEmbed
                  ? "bg-primary/20 text-primary glow-coral"
                  : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
              }`}
              title="Embed receiver"
            >
              <Volume2 className="w-5 h-5" />
            </button>

            <a
              href={selectedReceiver.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2.5 rounded-xl bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground transition-all duration-200"
              title="Open in new tab"
            >
              <ExternalLink className="w-5 h-5" />
            </a>

            <button
              onClick={() => {
                selectStation(null);
                setShowPanel(false);
                setShowEmbed(false);
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
