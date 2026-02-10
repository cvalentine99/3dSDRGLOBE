/**
 * StationPanel.tsx — Floating frosted-glass panel showing station details
 * Design: "Ether" — translucent overlay with smooth slide-in animation
 */
import { useRadio } from "@/contexts/RadioContext";
import { motion, AnimatePresence } from "framer-motion";
import { X, Radio, Globe, ExternalLink, ChevronRight } from "lucide-react";

const TYPE_COLORS: Record<string, string> = {
  OpenWebRX: "text-cyan-400",
  WebSDR: "text-primary",
  KiwiSDR: "text-green-400",
};

const TYPE_BG: Record<string, string> = {
  OpenWebRX: "bg-cyan-400/10 border-cyan-400/20",
  WebSDR: "bg-primary/10 border-primary/20",
  KiwiSDR: "bg-green-400/10 border-green-400/20",
};

const TYPE_DOT: Record<string, string> = {
  OpenWebRX: "bg-cyan-400",
  WebSDR: "bg-primary",
  KiwiSDR: "bg-green-400",
};

export default function StationPanel() {
  const {
    selectedStation,
    selectedReceiver,
    selectStation,
    selectReceiver,
    showPanel,
    setShowPanel,
  } = useRadio();

  return (
    <AnimatePresence>
      {showPanel && selectedStation && (
        <motion.div
          initial={{ x: 400, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 400, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="absolute top-4 right-4 bottom-20 w-[380px] xl:w-[420px] max-w-[calc(100vw-2rem)] z-30 glass-panel rounded-2xl overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="p-5 border-b border-white/5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Radio className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    Station
                  </span>
                </div>
                <h2 className="text-lg font-semibold text-foreground leading-tight truncate">
                  {selectedStation.label}
                </h2>
                <p className="text-xs text-muted-foreground font-mono mt-1">
                  {selectedStation.location.coordinates[1].toFixed(4)}°N,{" "}
                  {selectedStation.location.coordinates[0].toFixed(4)}°E
                </p>
              </div>
              <button
                onClick={() => {
                  setShowPanel(false);
                  selectStation(null);
                }}
                className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Receivers list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3 px-1">
              {selectedStation.receivers.length} Receiver{selectedStation.receivers.length !== 1 ? "s" : ""}
            </p>
            {selectedStation.receivers.map((receiver, idx) => {
              const isSelected = selectedReceiver?.url === receiver.url;
              return (
                <button
                  key={idx}
                  onClick={() => selectReceiver(receiver)}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all duration-200 group ${
                    isSelected
                      ? "bg-white/8 border-primary/30 glow-coral"
                      : "bg-white/3 border-white/5 hover:bg-white/6 hover:border-white/10"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${TYPE_DOT[receiver.type] || "bg-primary"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground leading-snug line-clamp-2"
                         dangerouslySetInnerHTML={{ __html: receiver.label }}
                      />
                      <div className="flex items-center gap-2 mt-2">
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${TYPE_BG[receiver.type] || ""} ${TYPE_COLORS[receiver.type] || "text-primary"}`}>
                          {receiver.type}
                        </span>
                        {receiver.version && (
                          <span className="text-[10px] font-mono text-muted-foreground">
                            v{receiver.version}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 mt-1 shrink-0 transition-transform ${
                      isSelected ? "text-primary" : "text-muted-foreground group-hover:translate-x-0.5"
                    }`} />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Open in browser button */}
          {selectedReceiver && (
            <div className="p-4 border-t border-white/5">
              <a
                href={selectedReceiver.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25 transition-all duration-200 text-sm font-medium"
              >
                <Globe className="w-4 h-4" />
                Open in Browser
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
