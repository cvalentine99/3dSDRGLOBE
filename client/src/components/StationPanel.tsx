/**
 * StationPanel.tsx — Floating frosted-glass panel showing station details
 * Design: "Ether" — translucent overlay with smooth slide-in animation
 * 
 * Includes frequency cross-reference: automatically highlights military
 * frequencies from the Mil-RF database that fall within the receiver's tuning range.
 */
import { useRadio } from "@/contexts/RadioContext";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Radio, Globe, ExternalLink, ChevronRight, Waves, MapPin, Star,
  ChevronDown, Shield, Zap, Radar as RadarIcon, Lock, Eye, EyeOff, Play, Info
} from "lucide-react";
import {
  isWatched,
  addToWatchlist,
  removeFromWatchlist,
} from "@/lib/watchlistService";
import { detectBands, BAND_DEFINITIONS } from "@/lib/types";
import { useMemo, useState } from "react";
import SignalStrength from "@/components/SignalStrength";
import SigintLogViewer from "@/components/SigintLogViewer";
import {
  crossReferenceFrequencies,
  getStationTuningRanges,
  SIGNAL_TYPE_DISPLAY,
} from "@/lib/frequencyCrossRef";
import {
  OPERATOR_COLORS,
  OPERATOR_FLAGS,
  BAND_SECTIONS,
  type MilitaryFrequency,
} from "@/lib/militaryRfData";

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
    stationContinents,
    stationRegions,
    isFavorite,
    toggleFavorite,
  } = useRadio();

  const isStarred = selectedStation ? isFavorite(selectedStation) : false;

  // Watchlist state
  const stationKey = selectedStation
    ? `${selectedStation.label}|${selectedStation.location.coordinates[0]}|${selectedStation.location.coordinates[1]}`
    : "";
  const [watched, setWatched] = useState(false);

  // Sync watchlist state when station changes
  useMemo(() => {
    if (stationKey) setWatched(isWatched(stationKey));
  }, [stationKey]);

  const toggleWatch = () => {
    if (!selectedStation) return;
    if (watched) {
      removeFromWatchlist(stationKey);
      setWatched(false);
    } else {
      const firstReceiver = selectedStation.receivers[0];
      addToWatchlist(
        stationKey,
        selectedStation.label,
        firstReceiver?.url || "",
        firstReceiver?.type || "KiwiSDR",
        selectedStation.location.coordinates as [number, number]
      );
      setWatched(true);
    }
  };

  const detectedBands = useMemo(() => {
    if (!selectedStation) return [];
    return detectBands(selectedStation);
  }, [selectedStation]);

  const bandLabels = useMemo(() => {
    return detectedBands.map((b) => {
      const def = BAND_DEFINITIONS.find((d) => d.id === b);
      return def ? `${def.label} (${def.description})` : b;
    });
  }, [detectedBands]);

  // Cross-reference military frequencies
  const milFreqs = useMemo(() => {
    if (!selectedStation) return [];
    return crossReferenceFrequencies(selectedStation);
  }, [selectedStation]);

  const tuningRanges = useMemo(() => {
    if (!selectedStation) return [];
    return getStationTuningRanges(selectedStation);
  }, [selectedStation]);

  // Group mil freqs by signal type for summary
  const milFreqsByType = useMemo(() => {
    const groups: Record<string, MilitaryFrequency[]> = {};
    milFreqs.forEach((f) => {
      if (!groups[f.signalType]) groups[f.signalType] = [];
      groups[f.signalType].push(f);
    });
    return groups;
  }, [milFreqs]);

  const [showMilFreqs, setShowMilFreqs] = useState(false);
  const [expandedMilFreq, setExpandedMilFreq] = useState<string | null>(null);
  const [showLogViewer, setShowLogViewer] = useState(false);

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
                    Target
                  </span>
                </div>
                <h2 className="text-lg font-semibold text-foreground leading-tight truncate">
                  {selectedStation.label}
                </h2>
                <p className="text-xs text-muted-foreground font-mono mt-1">
                  {selectedStation.location.coordinates[1].toFixed(4)}°N,{" "}
                  {selectedStation.location.coordinates[0].toFixed(4)}°E
                </p>
                {selectedStation && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <MapPin className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                    <span className="text-[10px] font-mono text-muted-foreground/70">
                      {stationRegions.get(selectedStation) || ""}
                      {stationContinents.get(selectedStation) && stationRegions.get(selectedStation) !== stationContinents.get(selectedStation)
                        ? ` · ${stationContinents.get(selectedStation)}`
                        : ""}
                    </span>
                  </div>
                )}
                {bandLabels.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <Waves className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                    {bandLabels.map((bl) => (
                      <span key={bl} className="text-[9px] font-mono text-accent/80 bg-accent/10 border border-accent/20 px-1.5 py-0.5 rounded">
                        {bl}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={toggleWatch}
                  className={`p-1.5 rounded-lg transition-all duration-200 ${
                    watched
                      ? "text-emerald-400 hover:text-emerald-300"
                      : "text-muted-foreground/40 hover:text-emerald-400/70"
                  }`}
                  title={watched ? "Remove from watchlist" : "Add to watchlist"}
                >
                  {watched ? (
                    <Eye className="w-4.5 h-4.5" />
                  ) : (
                    <EyeOff className="w-4.5 h-4.5" />
                  )}
                </button>
                <button
                  onClick={() => selectedStation && toggleFavorite(selectedStation)}
                  className={`p-1.5 rounded-lg transition-all duration-200 ${
                    isStarred
                      ? "text-yellow-400 hover:text-yellow-300"
                      : "text-muted-foreground/40 hover:text-yellow-400/70"
                  }`}
                  title={isStarred ? "Remove from favorites" : "Add to favorites"}
                >
                  <Star className={`w-4.5 h-4.5 ${isStarred ? "fill-yellow-400" : ""}`} />
                </button>
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
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            {/* Receivers list */}
            <div className="p-4 space-y-2">
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

            {/* Signal Strength Indicator */}
            {selectedReceiver && (
              <div className="px-4 pb-2">
                <SignalStrength
                  receiverUrl={selectedReceiver.url}
                  receiverType={selectedReceiver.type}
                  stationLabel={selectedStation.label}
                  onOpenLog={() => setShowLogViewer(true)}
                />
              </div>
            )}

            {/* Military Frequency Cross-Reference */}
            {milFreqs.length > 0 && (
              <div className="border-t border-white/5">
                <button
                  onClick={() => setShowMilFreqs(!showMilFreqs)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/3 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-md bg-red-500/15 border border-red-500/20 flex items-center justify-center">
                      <RadarIcon className="w-3 h-3 text-red-400" />
                    </div>
                    <div className="text-left">
                      <span className="text-xs font-medium text-white/90">
                        Mil-RF Cross-Reference
                      </span>
                      <span className="text-[9px] font-mono text-red-400/80 ml-2">
                        {milFreqs.length} match{milFreqs.length !== 1 ? "es" : ""}
                      </span>
                    </div>
                  </div>
                  {showMilFreqs ? (
                    <ChevronDown className="w-4 h-4 text-white/30" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-white/30" />
                  )}
                </button>

                <AnimatePresence>
                  {showMilFreqs && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      {/* Tuning range info */}
                      <div className="px-4 pb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[9px] font-mono text-white/30 uppercase">Tuning:</span>
                          {tuningRanges.map((r, i) => (
                            <span key={i} className="text-[9px] font-mono text-cyan-400/80 bg-cyan-400/10 border border-cyan-400/15 px-1.5 py-0.5 rounded">
                              {r.label}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Signal type summary badges */}
                      <div className="px-4 pb-2">
                        <div className="flex items-center gap-1 flex-wrap">
                          {Object.entries(milFreqsByType).map(([type, freqs]) => {
                            const display = SIGNAL_TYPE_DISPLAY[type];
                            return (
                              <span
                                key={type}
                                className="text-[8px] font-mono px-1.5 py-0.5 rounded border"
                                style={{
                                  color: display?.color || "#999",
                                  borderColor: (display?.color || "#999") + "30",
                                  backgroundColor: (display?.color || "#999") + "10",
                                }}
                              >
                                {display?.label || type} {freqs.length}
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {/* Frequency list */}
                      <div className="px-3 pb-3 space-y-1">
                        {milFreqs.map((freq) => {
                          const isExpanded = expandedMilFreq === freq.id;
                          const bandSection = BAND_SECTIONS.find((b) => b.id === freq.band);
                          const sigDisplay = SIGNAL_TYPE_DISPLAY[freq.signalType];

                          return (
                            <button
                              key={freq.id}
                              onClick={() => setExpandedMilFreq(isExpanded ? null : freq.id)}
                              className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-white/5 transition-colors group"
                            >
                              <div className="flex items-center gap-2">
                                {/* Frequency */}
                                <span
                                  className="text-[10px] font-mono font-semibold shrink-0 px-1.5 py-0.5 rounded border"
                                  style={{
                                    borderColor: (bandSection?.color || "#666") + "40",
                                    backgroundColor: (bandSection?.color || "#666") + "15",
                                    color: "white",
                                  }}
                                >
                                  {freq.frequency}
                                </span>

                                {/* System name */}
                                <span className="text-[10px] text-white/80 truncate flex-1">
                                  {freq.system}
                                </span>

                                {/* Signal type dot */}
                                <span
                                  className="w-1.5 h-1.5 rounded-full shrink-0"
                                  style={{ backgroundColor: sigDisplay?.color || "#666" }}
                                  title={sigDisplay?.label || freq.signalType}
                                />

                                {/* Operator flag */}
                                <span className="text-[8px] shrink-0">
                                  {OPERATOR_FLAGS[freq.operator]}
                                </span>

                                {/* Expand arrow */}
                                {isExpanded ? (
                                  <ChevronDown className="w-3 h-3 text-white/30 shrink-0" />
                                ) : (
                                  <ChevronRight className="w-3 h-3 text-white/20 group-hover:text-white/40 shrink-0" />
                                )}
                              </div>

                              {/* Expanded details */}
                              {isExpanded && (
                                <div className="mt-2 p-2.5 rounded-lg bg-white/5 border border-white/5 space-y-1.5">
                                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                                    <MiniDetail label="Operator" value={freq.operator} />
                                    <MiniDetail label="Band" value={`${freq.band} (${bandSection?.range || ""})`} />
                                    <MiniDetail label="Classification" value={freq.classification} />
                                    <MiniDetail label="Signal Type" value={freq.signalType} />
                                    {freq.modulation && <MiniDetail label="Modulation" value={freq.modulation} />}
                                    {freq.power && <MiniDetail label="Power" value={freq.power} />}
                                    {freq.location && <MiniDetail label="Location" value={freq.location} />}
                                  </div>
                                  <p className="text-[9px] text-white/50 leading-relaxed">
                                    {freq.description}
                                  </p>
                                  {freq.notes && (
                                    <div className="flex items-start gap-1.5">
                                      <Lock className="w-2.5 h-2.5 text-amber-400/60 shrink-0 mt-0.5" />
                                      <p className="text-[9px] text-amber-400/70 italic">
                                        {freq.notes}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* No mil-freq match info */}
            {milFreqs.length === 0 && tuningRanges.length > 0 && (
              <div className="border-t border-white/5 px-4 py-3">
                <div className="flex items-center gap-2 text-white/25">
                  <RadarIcon className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-mono">
                    No military frequencies in tuning range
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Open in browser + receiver guidance */}
          {selectedReceiver && (
            <div className="p-4 border-t border-white/5 space-y-3">
              {/* Receiver-specific guidance */}
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-400/5 border border-amber-400/10">
                <Info className="w-3.5 h-3.5 text-amber-400/50 shrink-0 mt-0.5" />
                <p className="text-[10px] text-amber-400/60 leading-relaxed">
                  {selectedReceiver.type === "KiwiSDR"
                    ? "Click the waterfall display to start audio. Use the frequency/mode controls to tune. The REC button records audio."
                    : selectedReceiver.type === "OpenWebRX"
                    ? "Click the 'Start OpenWebRX' button to begin. Click the waterfall to tune. Some versions have a record button."
                    : "Select a band tab, then click the waterfall to tune. Use the 'Audio recording: Start' button to record."}
                </p>
              </div>
              <a
                href={selectedReceiver.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25 transition-all duration-200 text-sm font-medium"
              >
                <Play className="w-4 h-4" />
                Open Receiver
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </motion.div>
      )}

      {/* Signal Intelligence Log Viewer Modal */}
      {showLogViewer && selectedStation && selectedReceiver && (
        <SigintLogViewer
          stationLabel={selectedStation.label}
          receiverUrl={selectedReceiver.url}
          receiverType={selectedReceiver.type}
          onClose={() => setShowLogViewer(false)}
        />
      )}
    </AnimatePresence>
  );
}

function MiniDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[7px] font-mono text-white/25 uppercase tracking-wider">{label}</span>
      <p className="text-[9px] text-white/70">{value}</p>
    </div>
  );
}
