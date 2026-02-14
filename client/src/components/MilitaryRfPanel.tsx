/**
 * MilitaryRfPanel.tsx — Military RF Intelligence Database
 * Design: "Ether" — frosted glass panel with tactical styling
 * 
 * A comprehensive reference panel showing military frequencies, systems,
 * operators, digital waveforms, and band information from the research PDF.
 */
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Search, Radio, Shield, Zap, Waves, Signal,
  ChevronDown, ChevronRight, Radar, Lock, Globe2, Antenna
} from "lucide-react";
import {
  MILITARY_FREQUENCIES,
  BAND_SECTIONS,
  WAVEFORMS,
  ALL_OPERATORS,
  ALL_SIGNAL_TYPES,
  OPERATOR_COLORS,
  OPERATOR_FLAGS,
  SIGNAL_TYPE_COLORS,
  SIGNAL_TYPE_LABELS,
  type BandCategory,
  type Operator,
  type SignalType,
  type MilitaryFrequency,
} from "@/lib/militaryRfData";

type TabId = "frequencies" | "waveforms" | "bands";

const CLASSIFICATION_ICONS: Record<string, typeof Shield> = {
  Strategic: Shield,
  Tactical: Zap,
  Navigation: Globe2,
};

const CLASSIFICATION_COLORS: Record<string, string> = {
  Strategic: "text-red-400",
  Tactical: "text-amber-400",
  Navigation: "text-cyan-400",
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function MilitaryRfPanel({ isOpen, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("frequencies");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterBand, setFilterBand] = useState<BandCategory | "all">("all");
  const [filterOperator, setFilterOperator] = useState<Operator | "all">("all");
  const [filterSignalType, setFilterSignalType] = useState<SignalType | "all">("all");
  const [expandedFreq, setExpandedFreq] = useState<string | null>(null);
  const [expandedWaveform, setExpandedWaveform] = useState<string | null>(null);

  const filteredFrequencies = useMemo(() => {
    return MILITARY_FREQUENCIES.filter((f) => {
      const matchesBand = filterBand === "all" || f.band === filterBand;
      const matchesOperator = filterOperator === "all" || f.operator === filterOperator;
      const matchesSignalType = filterSignalType === "all" || f.signalType === filterSignalType;
      const matchesSearch =
        !searchQuery ||
        f.frequency.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.system.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.designation.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.operator.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.signalType.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesBand && matchesOperator && matchesSignalType && matchesSearch;
    }).sort((a, b) => a.frequencyKhz - b.frequencyKhz);
  }, [filterBand, filterOperator, filterSignalType, searchQuery]);

  // Count by band
  const bandCounts = useMemo(() => {
    const counts: Record<string, number> = { all: MILITARY_FREQUENCIES.length };
    BAND_SECTIONS.forEach((b) => {
      counts[b.id] = MILITARY_FREQUENCIES.filter((f) => f.band === b.id).length;
    });
    return counts;
  }, []);

  // Count by operator
  const operatorCounts = useMemo(() => {
    const counts: Record<string, number> = { all: MILITARY_FREQUENCIES.length };
    ALL_OPERATORS.forEach((op) => {
      counts[op] = MILITARY_FREQUENCIES.filter((f) => f.operator === op).length;
    });
    return counts;
  }, []);

  // Count by signal type
  const signalTypeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: MILITARY_FREQUENCIES.length };
    ALL_SIGNAL_TYPES.forEach((st) => {
      counts[st] = MILITARY_FREQUENCIES.filter((f) => f.signalType === st).length;
    });
    return counts;
  }, []);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 h-full z-50 flex"
            style={{ width: "min(680px, 90vw)" }}
          >
            <div className="flex-1 flex flex-col bg-[#0c1020]/95 backdrop-blur-xl border-l border-white/10 overflow-hidden">
              {/* Header */}
              <div className="shrink-0 px-5 py-4 border-b border-white/10 bg-[#0c1020]/80">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
                      <Radar className="w-4 h-4 text-red-400" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-white tracking-tight">
                        Military RF Intelligence
                      </h2>
                      <p className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                        VLF – UHF Spectrum Analysis · {MILITARY_FREQUENCIES.length} Entries
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                  >
                    <X className="w-3.5 h-3.5 text-white/60" />
                  </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-1">
                  {([
                    { id: "frequencies" as TabId, label: "Frequencies", icon: Radio, count: MILITARY_FREQUENCIES.length },
                    { id: "waveforms" as TabId, label: "Waveforms", icon: Waves, count: WAVEFORMS.length },
                    { id: "bands" as TabId, label: "Band Intel", icon: Signal, count: BAND_SECTIONS.length },
                  ]).map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase tracking-wider transition-all ${
                        activeTab === tab.id
                          ? "bg-white/10 text-white"
                          : "text-white/40 hover:text-white/60 hover:bg-white/5"
                      }`}
                    >
                      <tab.icon className="w-3 h-3" />
                      {tab.label}
                      <span className="text-[9px] text-white/30 ml-0.5">{tab.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {activeTab === "frequencies" && (
                  <FrequenciesTab
                    frequencies={filteredFrequencies}
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    filterBand={filterBand}
                    setFilterBand={setFilterBand}
                    filterOperator={filterOperator}
                    setFilterOperator={setFilterOperator}
                    filterSignalType={filterSignalType}
                    setFilterSignalType={setFilterSignalType}
                    expandedFreq={expandedFreq}
                    setExpandedFreq={setExpandedFreq}
                    bandCounts={bandCounts}
                    operatorCounts={operatorCounts}
                    signalTypeCounts={signalTypeCounts}
                  />
                )}
                {activeTab === "waveforms" && (
                  <WaveformsTab
                    expandedWaveform={expandedWaveform}
                    setExpandedWaveform={setExpandedWaveform}
                  />
                )}
                {activeTab === "bands" && <BandsTab />}
              </div>

              {/* Footer */}
              <div className="shrink-0 px-5 py-2.5 border-t border-white/10 bg-[#0c1020]/80">
                <p className="text-[9px] font-mono text-white/25 text-center">
                  Sources: Global Military Spectrum Dominance PDF · sigidwiki.com · priyom.org · radioreference.com
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ========== Frequencies Tab ========== */
function FrequenciesTab({
  frequencies,
  searchQuery,
  setSearchQuery,
  filterBand,
  setFilterBand,
  filterOperator,
  setFilterOperator,
  filterSignalType,
  setFilterSignalType,
  expandedFreq,
  setExpandedFreq,
  bandCounts,
  operatorCounts,
  signalTypeCounts,
}: {
  frequencies: MilitaryFrequency[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  filterBand: BandCategory | "all";
  setFilterBand: (b: BandCategory | "all") => void;
  filterOperator: Operator | "all";
  setFilterOperator: (o: Operator | "all") => void;
  filterSignalType: SignalType | "all";
  setFilterSignalType: (s: SignalType | "all") => void;
  expandedFreq: string | null;
  setExpandedFreq: (id: string | null) => void;
  bandCounts: Record<string, number>;
  operatorCounts: Record<string, number>;
  signalTypeCounts: Record<string, number>;
}) {
  return (
    <div>
      {/* Search + Filters */}
      <div className="px-4 py-3 border-b border-white/5 space-y-2.5">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search frequencies, systems, operators..."
            className="w-full pl-8 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-white/20 focus:bg-white/8"
          />
        </div>

        {/* Band filter */}
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setFilterBand("all")}
            className={`px-2 py-1 rounded text-[9px] font-mono transition-all ${
              filterBand === "all"
                ? "bg-white/15 text-white"
                : "bg-white/5 text-white/40 hover:text-white/60"
            }`}
          >
            All {bandCounts.all}
          </button>
          {BAND_SECTIONS.map((b) => (
            <button
              key={b.id}
              onClick={() => setFilterBand(b.id)}
              className={`px-2 py-1 rounded text-[9px] font-mono transition-all flex items-center gap-1 ${
                filterBand === b.id
                  ? "bg-white/15 text-white"
                  : "bg-white/5 text-white/40 hover:text-white/60"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: b.color }} />
              {b.label} {bandCounts[b.id]}
            </button>
          ))}
        </div>

        {/* Operator filter */}
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setFilterOperator("all")}
            className={`px-2 py-1 rounded text-[9px] font-mono transition-all ${
              filterOperator === "all"
                ? "bg-white/15 text-white"
                : "bg-white/5 text-white/40 hover:text-white/60"
            }`}
          >
            All Operators
          </button>
          {ALL_OPERATORS.filter((op) => operatorCounts[op] > 0).map((op) => (
            <button
              key={op}
              onClick={() => setFilterOperator(op)}
              className={`px-2 py-1 rounded text-[9px] font-mono transition-all flex items-center gap-1 ${
                filterOperator === op
                  ? "bg-white/15 text-white"
                  : "bg-white/5 text-white/40 hover:text-white/60"
              }`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: OPERATOR_COLORS[op] }}
              />
              {OPERATOR_FLAGS[op]} {operatorCounts[op]}
            </button>
          ))}
        </div>

        {/* Signal Type filter */}
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setFilterSignalType("all")}
            className={`px-2 py-1 rounded text-[9px] font-mono transition-all ${
              filterSignalType === "all"
                ? "bg-white/15 text-white"
                : "bg-white/5 text-white/40 hover:text-white/60"
            }`}
          >
            All Types
          </button>
          {ALL_SIGNAL_TYPES.filter((st) => signalTypeCounts[st] > 0).map((st) => (
            <button
              key={st}
              onClick={() => setFilterSignalType(st)}
              className={`px-2 py-1 rounded text-[9px] font-mono transition-all flex items-center gap-1 ${
                filterSignalType === st
                  ? "bg-white/15 text-white"
                  : "bg-white/5 text-white/40 hover:text-white/60"
              }`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: SIGNAL_TYPE_COLORS[st] }}
              />
              {SIGNAL_TYPE_LABELS[st]} {signalTypeCounts[st]}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <div className="px-4 py-2 border-b border-white/5">
        <p className="text-[9px] font-mono text-white/30 uppercase tracking-wider">
          {frequencies.length} frequencies · sorted by frequency ascending
        </p>
      </div>

      {/* Frequency list */}
      <div className="divide-y divide-white/5">
        {frequencies.map((freq) => {
          const isExpanded = expandedFreq === freq.id;
          const ClassIcon = CLASSIFICATION_ICONS[freq.classification] || Shield;
          const classColor = CLASSIFICATION_COLORS[freq.classification] || "text-white/40";
          const bandSection = BAND_SECTIONS.find((b) => b.id === freq.band);

          return (
            <button
              key={freq.id}
              onClick={() => setExpandedFreq(isExpanded ? null : freq.id)}
              className="w-full text-left px-4 py-2.5 hover:bg-white/5 transition-colors group"
            >
              <div className="flex items-start gap-3">
                {/* Frequency badge */}
                <div className="shrink-0 mt-0.5">
                  <div
                    className="px-2 py-1 rounded text-[10px] font-mono font-semibold text-white border"
                    style={{
                      borderColor: bandSection?.color + "40",
                      backgroundColor: bandSection?.color + "15",
                    }}
                  >
                    {freq.frequency}
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-white truncate">
                      {freq.system}
                    </span>
                    <span className="text-[9px] font-mono text-white/30">
                      {freq.designation}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <p className="text-[10px] text-white/50 line-clamp-1 flex-1">
                      {freq.description}
                    </p>
                    {freq.status === "active" && (
                      <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" title="Active" />
                    )}
                    {freq.status === "inactive" && (
                      <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-red-400/50" title="Inactive" />
                    )}
                  </div>
                </div>

                {/* Tags */}
                <div className="shrink-0 flex items-center gap-1.5">
                  {/* Operator */}
                  <span
                    className="text-[8px] font-mono font-semibold px-1.5 py-0.5 rounded"
                    style={{
                      color: OPERATOR_COLORS[freq.operator],
                      backgroundColor: OPERATOR_COLORS[freq.operator] + "20",
                    }}
                  >
                    {OPERATOR_FLAGS[freq.operator]}
                  </span>
                  {/* Classification */}
                  <ClassIcon className={`w-3 h-3 ${classColor}`} />
                  {/* Expand icon */}
                  {isExpanded ? (
                    <ChevronDown className="w-3 h-3 text-white/30" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-white/20 group-hover:text-white/40" />
                  )}
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="mt-2.5 ml-0 p-3 rounded-lg bg-white/5 border border-white/5 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <DetailRow label="Operator" value={freq.operator} />
                    <DetailRow label="Band" value={`${freq.band} (${bandSection?.range})`} />
                    <DetailRow label="Classification" value={freq.classification} />
                    <DetailRow label="Signal Type" value={freq.signalType} />
                    {freq.power && <DetailRow label="Power" value={freq.power} />}
                    {freq.location && <DetailRow label="Location" value={freq.location} />}
                    {freq.modulation && <DetailRow label="Modulation" value={freq.modulation} />}
                    {freq.bandwidth && <DetailRow label="Bandwidth" value={freq.bandwidth} />}
                    {freq.source && <DetailRow label="Source" value={freq.source} />}
                    {freq.status && <DetailRow label="Status" value={freq.status} />}
                  </div>
                  <p className="text-[10px] text-white/60 leading-relaxed">
                    {freq.description}
                  </p>
                  {freq.notes && (
                    <div className="flex items-start gap-1.5 mt-1">
                      <Lock className="w-3 h-3 text-amber-400/60 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-amber-400/70 italic">
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

      {frequencies.length === 0 && (
        <div className="px-4 py-12 text-center">
          <Antenna className="w-8 h-8 text-white/10 mx-auto mb-2" />
          <p className="text-xs text-white/30">No frequencies match your filters</p>
        </div>
      )}
    </div>
  );
}

/* ========== Waveforms Tab ========== */
function WaveformsTab({
  expandedWaveform,
  setExpandedWaveform,
}: {
  expandedWaveform: string | null;
  setExpandedWaveform: (id: string | null) => void;
}) {
  return (
    <div className="divide-y divide-white/5">
      <div className="px-4 py-3 border-b border-white/5">
        <p className="text-[10px] text-white/50 leading-relaxed">
          Digital signal processing waveforms used in modern military communications. Identifying the waveform type is critical for SDR signal classification.
        </p>
      </div>
      {WAVEFORMS.map((wf) => {
        const isExpanded = expandedWaveform === wf.id;
        return (
          <button
            key={wf.id}
            onClick={() => setExpandedWaveform(isExpanded ? null : wf.id)}
            className="w-full text-left px-4 py-3 hover:bg-white/5 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center">
                  <Waves className="w-3.5 h-3.5 text-cyan-400" />
                </div>
                <div>
                  <span className="text-xs font-medium text-white">{wf.name}</span>
                  <span className="text-[9px] font-mono text-white/30 ml-2">{wf.standard}</span>
                </div>
              </div>
              {isExpanded ? (
                <ChevronDown className="w-3 h-3 text-white/30" />
              ) : (
                <ChevronRight className="w-3 h-3 text-white/20 group-hover:text-white/40" />
              )}
            </div>

            {isExpanded && (
              <div className="mt-2.5 p-3 rounded-lg bg-white/5 border border-white/5 space-y-2">
                <p className="text-[10px] text-white/60 leading-relaxed">{wf.description}</p>
                <div className="grid grid-cols-2 gap-2">
                  <DetailRow label="Bandwidth" value={wf.bandwidth} />
                  <DetailRow label="Users" value={wf.users} />
                </div>
                <div className="flex items-start gap-1.5 mt-1">
                  <Signal className="w-3 h-3 text-cyan-400/60 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-cyan-400/70 italic">
                    Visual ID: {wf.visualId}
                  </p>
                </div>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ========== Bands Tab ========== */
function BandsTab() {
  return (
    <div className="p-4 space-y-4">
      <p className="text-[10px] text-white/50 leading-relaxed">
        The VLF–UHF spectrum is segmented by propagation capability and operational domain. Each band has unique physics that dictate military doctrine.
      </p>

      {BAND_SECTIONS.map((band) => {
        const freqsInBand = MILITARY_FREQUENCIES.filter((f) => f.band === band.id);
        const operators = Array.from(new Set(freqsInBand.map((f) => f.operator)));

        return (
          <div
            key={band.id}
            className="rounded-xl border border-white/10 overflow-hidden"
            style={{ borderLeftColor: band.color, borderLeftWidth: "3px" }}
          >
            {/* Band header */}
            <div className="px-4 py-3 bg-white/5">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-xs font-bold"
                  style={{ color: band.color }}
                >
                  {band.label}
                </span>
                <span className="text-[10px] font-mono text-white/40">{band.range}</span>
              </div>
              <p className="text-[11px] font-medium text-white/80">{band.description}</p>
            </div>

            {/* Band details */}
            <div className="px-4 py-3 space-y-2">
              <div className="flex items-start gap-2">
                <Antenna className="w-3 h-3 text-white/30 shrink-0 mt-0.5" />
                <p className="text-[10px] text-white/50 leading-relaxed">
                  <span className="text-white/70 font-medium">Propagation:</span> {band.propagation}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Radio className="w-3 h-3 text-white/30 shrink-0" />
                <p className="text-[10px] text-white/50">
                  <span className="text-white/70 font-medium">{freqsInBand.length}</span> tracked frequencies
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Globe2 className="w-3 h-3 text-white/30 shrink-0" />
                <div className="flex flex-wrap gap-1">
                  {operators.map((op: Operator) => (
                    <span
                      key={op}
                      className="text-[8px] font-mono font-semibold px-1.5 py-0.5 rounded"
                      style={{
                        color: OPERATOR_COLORS[op],
                        backgroundColor: OPERATOR_COLORS[op] + "20",
                      }}
                    >
                      {op}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Recommendations */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-amber-300">SDR Scanning Recommendations</span>
        </div>
        <ul className="space-y-1.5">
          <li className="text-[10px] text-white/60 leading-relaxed flex items-start gap-2">
            <span className="text-amber-400/60 shrink-0">1.</span>
            <span>Prioritize the "Big Three": HFGCS (8992/11175 kHz), The Buzzer (4625 kHz), and SINCGARS bands (30–88 MHz). Also monitor TACAMO VLF (26.9 kHz) for nuclear C2.</span>
          </li>
          <li className="text-[10px] text-white/60 leading-relaxed flex items-start gap-2">
            <span className="text-amber-400/60 shrink-0">2.</span>
            <span>Check Russian Single Letter Beacons in their 3.5, 4.5, and 7.5 MHz clusters simultaneously.</span>
          </li>
          <li className="text-[10px] text-white/60 leading-relaxed flex items-start gap-2">
            <span className="text-amber-400/60 shrink-0">3.</span>
            <span>Integrate demodulators for ALE (2G) and STANAG 4285 — the "handshakes" of modern military connectivity.</span>
          </li>
          <li className="text-[10px] text-white/60 leading-relaxed flex items-start gap-2">
            <span className="text-amber-400/60 shrink-0">4.</span>
            <span>Account for massive VLF/LF signal strength (Chayka at 100 kHz) which can desensitize receivers.</span>
          </li>
          <li className="text-[10px] text-white/60 leading-relaxed flex items-start gap-2">
            <span className="text-amber-400/60 shrink-0">5.</span>
            <span>Monitor OTH radars: Russian Kontayner (6–32 MHz), Chinese Foghorn (6–29 MHz), UK PLUTO II (8–38 MHz), and Australian JORN.</span>
          </li>
          <li className="text-[10px] text-white/60 leading-relaxed flex items-start gap-2">
            <span className="text-amber-400/60 shrink-0">6.</span>
            <span>Track French SALAMANDRE wideband HF (up to 150 kHz aggregate) and Israeli Navy hybrid modems for advanced signal analysis.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

/* ========== Helpers ========== */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[8px] font-mono text-white/25 uppercase tracking-wider">{label}</span>
      <p className="text-[10px] text-white/70">{value}</p>
    </div>
  );
}
