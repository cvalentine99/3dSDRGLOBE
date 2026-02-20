/**
 * SigintConflictTimeline.tsx — Unified SIGINT × Conflict Timeline
 *
 * Cross-references conflict events with nearby receiver signal logs
 * to surface potential intelligence correlations in a unified timeline.
 *
 * Features:
 * - Unified timeline showing both signal events and conflict events
 * - Temporal correlation: flags signal changes that coincide with conflict events
 * - Per-station drill-down with filtering
 * - Export correlated data as CSV
 */
import { useState, useMemo, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Radio,
  Flame,
  Activity,
  Clock,
  MapPin,
  ChevronDown,
  ChevronUp,
  Download,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Zap,
  Crosshair,
  FileText,
} from "lucide-react";
import { generateSigintPdfReport } from "@/lib/sigintPdfExport";
import {
  getAllMonitoredStations,
  type StationLog,
  type SigintLogEntry,
} from "@/lib/sigintLogger";
import type { SlimConflictEvent } from "@/components/ConflictOverlay";

/* ── Types ──────────────────────────────────────────────────── */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  conflictEvents: SlimConflictEvent[];
  onFocusPosition?: (lat: number, lon: number) => void;
}

/** A unified timeline entry */
interface TimelineEntry {
  id: string;
  timestamp: string;
  type: "signal" | "conflict";
  stationLabel?: string;
  snr?: number;
  online?: boolean;
  adcOverload?: boolean;
  users?: number;
  signalEventType?: "snr_drop" | "snr_spike" | "offline" | "adc_overload" | "normal";
  conflictEvent?: SlimConflictEvent;
  lat?: number;
  lon?: number;
}

/** A correlated pair of signal + conflict events */
interface CorrelationMatch {
  signalEntry: TimelineEntry;
  conflictEntry: TimelineEntry;
  timeDeltaHours: number;
  score: number;
  reason: string;
}

/* ── Constants ──────────────────────────────────────────────── */

const CORRELATION_TIME_WINDOW_HOURS = 48;

const VIOLENCE_LABELS: Record<number, string> = {
  1: "State-based",
  2: "Non-state",
  3: "One-sided",
};

/* ── Helpers ────────────────────────────────────────────────── */

function classifySignalEvent(
  entry: SigintLogEntry,
  prevEntry?: SigintLogEntry
): "snr_drop" | "snr_spike" | "offline" | "adc_overload" | "normal" {
  if (!entry.online) return "offline";
  if (entry.adcOverload) return "adc_overload";
  if (prevEntry && prevEntry.snr >= 0 && entry.snr >= 0) {
    const delta = entry.snr - prevEntry.snr;
    if (delta <= -5) return "snr_drop";
    if (delta >= 8) return "snr_spike";
  }
  return "normal";
}

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(ms / 3600000);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(ms / 86400000);
  return `${days}d ago`;
}

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function buildCorrelationReason(
  sig: TimelineEntry,
  conf: TimelineEntry,
  timeDeltaHours: number
): string {
  const parts: string[] = [];
  if (sig.signalEventType === "offline") parts.push("Station went offline");
  else if (sig.signalEventType === "snr_drop") parts.push("Significant SNR drop detected");
  else if (sig.signalEventType === "adc_overload") parts.push("ADC overload event");
  else if (sig.signalEventType === "snr_spike") parts.push("Unusual SNR spike");

  if (timeDeltaHours < 1) parts.push("within 1 hour of conflict event");
  else if (timeDeltaHours < 6) parts.push(`within ${timeDeltaHours.toFixed(0)}h of conflict event`);
  else if (timeDeltaHours < 24) parts.push("within same day as conflict event");
  else parts.push(`within ${Math.ceil(timeDeltaHours / 24)}d of conflict event`);

  if (conf.conflictEvent && conf.conflictEvent.best >= 10) {
    parts.push(`(${conf.conflictEvent.best} fatalities in ${conf.conflictEvent.country})`);
  }
  return parts.join(" ");
}

/* ── Component ──────────────────────────────────────────────── */

export default function SigintConflictTimeline({
  isOpen,
  onClose,
  conflictEvents,
  onFocusPosition,
}: Props) {
  const [stations, setStations] = useState<StationLog[]>([]);
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [showCorrelationsOnly, setShowCorrelationsOnly] = useState(false);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<"24h" | "7d" | "30d" | "all">("7d");

  useEffect(() => {
    if (isOpen) setStations(getAllMonitoredStations());
  }, [isOpen]);

  // Build unified timeline and find correlations
  const { timeline, correlations } = useMemo(() => {
    const entries: TimelineEntry[] = [];
    const now = Date.now();
    const timeFilterMs: Record<string, number> = {
      "24h": 24 * 3600000,
      "7d": 7 * 24 * 3600000,
      "30d": 30 * 24 * 3600000,
      all: Infinity,
    };
    const maxAge = timeFilterMs[timeFilter] ?? Infinity;

    // Add signal entries
    const targetStations = selectedStation
      ? stations.filter((s) => s.stationLabel === selectedStation)
      : stations;

    for (const station of targetStations) {
      let prevEntry: SigintLogEntry | undefined;
      for (const entry of station.entries) {
        const entryTime = new Date(entry.ts).getTime();
        if (now - entryTime > maxAge) { prevEntry = entry; continue; }
        const eventType = classifySignalEvent(entry, prevEntry);
        if (eventType !== "normal" || !showCorrelationsOnly) {
          entries.push({
            id: `sig-${station.stationLabel}-${entry.ts}`,
            timestamp: entry.ts,
            type: "signal",
            stationLabel: station.stationLabel,
            snr: entry.snr,
            online: entry.online,
            adcOverload: entry.adcOverload,
            users: entry.users,
            signalEventType: eventType,
          });
        }
        prevEntry = entry;
      }
    }

    // Add conflict events
    for (const evt of conflictEvents) {
      const evtTime = new Date(evt.date).getTime();
      if (now - evtTime > maxAge) continue;
      entries.push({
        id: `conf-${evt.id}`,
        timestamp: evt.date,
        type: "conflict",
        conflictEvent: evt,
        lat: evt.lat,
        lon: evt.lng,
      });
    }

    entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Find temporal correlations
    const signalAnomalies = entries.filter(
      (e) => e.type === "signal" && e.signalEventType !== "normal"
    );
    const conflictEntries = entries.filter((e) => e.type === "conflict");
    const matches: CorrelationMatch[] = [];

    for (const sig of signalAnomalies) {
      for (const conf of conflictEntries) {
        if (!conf.conflictEvent) continue;
        const timeDelta = Math.abs(
          new Date(sig.timestamp).getTime() - new Date(conf.timestamp).getTime()
        );
        const timeDeltaHours = timeDelta / 3600000;
        if (timeDeltaHours > CORRELATION_TIME_WINDOW_HOURS) continue;

        const timeScore = 1 - timeDeltaHours / CORRELATION_TIME_WINDOW_HOURS;
        let severityBoost = 0;
        if (sig.signalEventType === "offline") severityBoost = 0.3;
        else if (sig.signalEventType === "adc_overload") severityBoost = 0.2;
        else if (sig.signalEventType === "snr_drop") severityBoost = 0.15;
        const fatalityBoost = Math.min((conf.conflictEvent.best || 0) / 100, 0.2);
        const score = Math.min(timeScore * 0.5 + severityBoost + fatalityBoost, 1);

        if (score >= 0.15) {
          matches.push({
            signalEntry: sig,
            conflictEntry: conf,
            timeDeltaHours,
            score,
            reason: buildCorrelationReason(sig, conf, timeDeltaHours),
          });
        }
      }
    }

    matches.sort((a, b) => b.score - a.score);

    const correlatedIds = new Set(
      matches.flatMap((m) => [m.signalEntry.id, m.conflictEntry.id])
    );

    const filtered = showCorrelationsOnly
      ? entries.filter((e) => correlatedIds.has(e.id) || (e.type === "signal" && e.signalEventType !== "normal"))
      : entries;

    return { timeline: filtered, correlations: matches };
  }, [stations, conflictEvents, selectedStation, showCorrelationsOnly, timeFilter]);

  const handleExport = useCallback(() => {
    if (correlations.length === 0) return;
    const headers = [
      "Score", "Signal Station", "Signal Event", "Signal Time", "SNR (dB)",
      "Conflict", "Conflict Date", "Country", "Fatalities", "Time Delta (h)", "Reason",
    ];
    const rows = correlations.map((c) => [
      c.score.toFixed(2),
      c.signalEntry.stationLabel ?? "",
      c.signalEntry.signalEventType ?? "",
      c.signalEntry.timestamp,
      c.signalEntry.snr?.toString() ?? "N/A",
      c.conflictEntry.conflictEvent?.conflict ?? "",
      c.conflictEntry.timestamp,
      c.conflictEntry.conflictEvent?.country ?? "",
      c.conflictEntry.conflictEvent?.best?.toString() ?? "0",
      c.timeDeltaHours.toFixed(1),
      c.reason,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sigint-conflict-correlations-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [correlations]);

  if (!isOpen) return null;

  const uniqueStations = Array.from(new Set(stations.map((s) => s.stationLabel)));

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        className="fixed left-4 top-20 w-[460px] max-h-[calc(100vh-120px)] bg-gray-900/95 backdrop-blur-xl border border-cyan-500/20 rounded-xl shadow-2xl shadow-cyan-500/5 z-50 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div>
              <span className="text-sm font-semibold text-foreground tracking-wide uppercase">
                SIGINT × Conflict
              </span>
              <p className="text-[9px] text-muted-foreground/60 font-mono">
                Signal–Conflict Correlation Timeline
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {timeline.length > 0 && (
              <button
                onClick={() => generateSigintPdfReport({
                  timeline,
                  correlations,
                  timeFilter,
                  selectedStation,
                })}
                className="p-1.5 text-muted-foreground/70 hover:text-amber-400 rounded-lg transition-colors"
                title="Export as PDF intelligence report"
              >
                <FileText className="w-3.5 h-3.5" />
              </button>
            )}
            {correlations.length > 0 && (
              <button
                onClick={handleExport}
                className="p-1.5 text-muted-foreground/70 hover:text-cyan-400 rounded-lg transition-colors"
                title="Export correlations as CSV"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-muted-foreground/70 hover:text-foreground/70 rounded-lg transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="px-3 py-2 border-b border-border space-y-2 shrink-0">
          {/* Time filter */}
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-muted-foreground/50" />
            {(["24h", "7d", "30d", "all"] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeFilter(tf)}
                className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${
                  timeFilter === tf
                    ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                    : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 border border-transparent"
                }`}
              >
                {tf === "all" ? "All" : tf}
              </button>
            ))}
            <div className="ml-auto">
              <button
                onClick={() => setShowCorrelationsOnly(!showCorrelationsOnly)}
                className={`text-[10px] px-2 py-0.5 rounded-md transition-colors flex items-center gap-1 ${
                  showCorrelationsOnly
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                    : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 border border-transparent"
                }`}
                title="Show only correlated events"
              >
                <Zap className="w-3 h-3" />
                Correlated
              </button>
            </div>
          </div>

          {/* Station filter */}
          <div className="flex items-center gap-1 flex-wrap">
            <Radio className="w-3 h-3 text-muted-foreground/50 shrink-0" />
            <button
              onClick={() => setSelectedStation(null)}
              className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${
                !selectedStation
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 border border-transparent"
              }`}
            >
              All
            </button>
            {uniqueStations.slice(0, 5).map((label) => (
              <button
                key={label}
                onClick={() => setSelectedStation(label === selectedStation ? null : label)}
                className={`text-[10px] px-2 py-0.5 rounded-md transition-colors truncate max-w-[90px] ${
                  selectedStation === label
                    ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                    : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 border border-transparent"
                }`}
                title={label}
              >
                {label.length > 12 ? label.slice(0, 12) + "\u2026" : label}
              </button>
            ))}
            {uniqueStations.length > 5 && (
              <span className="text-[9px] text-muted-foreground/40">
                +{uniqueStations.length - 5}
              </span>
            )}
          </div>
        </div>

        {/* Correlation Summary */}
        {correlations.length > 0 && (
          <div className="px-3 py-2 border-b border-border bg-amber-500/5 shrink-0">
            <div className="flex items-center gap-2 text-[10px]">
              <Zap className="w-3 h-3 text-amber-400" />
              <span className="text-amber-400 font-semibold">
                {correlations.length} correlation{correlations.length !== 1 ? "s" : ""} detected
              </span>
              <span className="text-muted-foreground/50 ml-auto">
                Top: {(correlations[0]?.score * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-border">
          {timeline.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/50">
              <Activity className="w-8 h-8 mb-2" />
              <p className="text-sm">No events to display</p>
              <p className="text-xs mt-1 text-center px-4">
                {stations.length === 0
                  ? "No monitored stations. Add stations to the watchlist to begin logging."
                  : "No events match the current filters."}
              </p>
            </div>
          ) : (
            <div className="relative">
              <div className="absolute left-6 top-0 bottom-0 w-px bg-border" />
              <div className="py-2 space-y-0.5">
                {timeline.slice(0, 200).map((entry) => {
                  const isExpanded = expandedEntryId === entry.id;
                  const isCorrelated = correlations.some(
                    (c) => c.signalEntry.id === entry.id || c.conflictEntry.id === entry.id
                  );

                  if (entry.type === "signal") {
                    return (
                      <SignalRow
                        key={entry.id}
                        entry={entry}
                        isExpanded={isExpanded}
                        isCorrelated={isCorrelated}
                        onToggle={() => setExpandedEntryId(isExpanded ? null : entry.id)}
                        correlations={correlations.filter((c) => c.signalEntry.id === entry.id)}
                      />
                    );
                  }
                  return (
                    <ConflictRow
                      key={entry.id}
                      entry={entry}
                      isExpanded={isExpanded}
                      isCorrelated={isCorrelated}
                      onToggle={() => setExpandedEntryId(isExpanded ? null : entry.id)}
                      onFocus={() => {
                        if (entry.lat != null && entry.lon != null) {
                          onFocusPosition?.(entry.lat, entry.lon);
                        }
                      }}
                      correlations={correlations.filter((c) => c.conflictEntry.id === entry.id)}
                    />
                  );
                })}
                {timeline.length > 200 && (
                  <div className="text-center py-2 text-[10px] text-muted-foreground/40">
                    Showing 200 of {timeline.length} entries
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border text-[10px] text-muted-foreground/50 flex items-center justify-between shrink-0">
          <span>
            {timeline.length} events \u00b7 {stations.length} stations \u00b7 {conflictEvents.length} conflicts
          </span>
          <span className="font-mono">\u00b1{CORRELATION_TIME_WINDOW_HOURS}h window</span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/* ── Sub-components ─────────────────────────────────────────── */

const EVENT_CONFIG = {
  snr_drop: { icon: TrendingDown, color: "text-orange-400", bg: "bg-orange-400", label: "SNR Drop" },
  snr_spike: { icon: TrendingUp, color: "text-green-400", bg: "bg-green-400", label: "SNR Spike" },
  offline: { icon: AlertTriangle, color: "text-red-400", bg: "bg-red-400", label: "Offline" },
  adc_overload: { icon: Zap, color: "text-yellow-400", bg: "bg-yellow-400", label: "ADC Overload" },
  normal: { icon: Radio, color: "text-cyan-400/50", bg: "bg-cyan-400/50", label: "Normal" },
};

function SignalRow({
  entry,
  isExpanded,
  isCorrelated,
  onToggle,
  correlations,
}: {
  entry: TimelineEntry;
  isExpanded: boolean;
  isCorrelated: boolean;
  onToggle: () => void;
  correlations: CorrelationMatch[];
}) {
  const config = EVENT_CONFIG[entry.signalEventType ?? "normal"];
  const Icon = config.icon;

  return (
    <div
      className={`relative pl-10 pr-3 py-1.5 cursor-pointer hover:bg-foreground/[0.03] transition-colors ${
        isCorrelated ? "bg-amber-500/[0.05]" : ""
      }`}
      onClick={onToggle}
    >
      <div
        className={`absolute left-[18px] top-3 w-3 h-3 rounded-full border-2 border-gray-900 ${config.bg} ${
          isCorrelated ? "ring-2 ring-amber-400/40" : ""
        }`}
      />
      <div className="flex items-center gap-2">
        <Icon className={`w-3 h-3 ${config.color} shrink-0`} />
        <span className="text-[10px] font-medium text-foreground/80 truncate">
          {entry.stationLabel}
        </span>
        <span className={`text-[9px] px-1 py-0.5 rounded ${config.color} bg-foreground/5`}>
          {config.label}
        </span>
        {isCorrelated && <Zap className="w-3 h-3 text-amber-400 shrink-0" />}
        <span className="text-[9px] text-muted-foreground/50 ml-auto shrink-0">
          {formatTimeAgo(entry.timestamp)}
        </span>
      </div>
      {entry.snr !== undefined && entry.snr >= 0 && (
        <div className="text-[9px] text-muted-foreground/50 mt-0.5 ml-5">
          SNR: {entry.snr} dB \u00b7 Users: {entry.users ?? "N/A"}
        </div>
      )}
      <AnimatePresence>
        {isExpanded && correlations.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-1.5 ml-5 space-y-1"
          >
            <div className="text-[9px] text-amber-400 font-semibold flex items-center gap-1">
              <Zap className="w-3 h-3" />
              Correlated Conflict Events
            </div>
            {correlations.map((c, i) => (
              <div key={i} className="bg-red-500/5 border border-red-500/10 rounded-md p-1.5 text-[9px]">
                <div className="flex items-center gap-1 text-foreground/70">
                  <Flame className="w-3 h-3 text-red-400" />
                  <span className="font-medium truncate">{c.conflictEntry.conflictEvent?.conflict}</span>
                  <span className="text-amber-400 font-mono ml-auto">{(c.score * 100).toFixed(0)}%</span>
                </div>
                <div className="text-muted-foreground/50 mt-0.5">
                  {c.conflictEntry.conflictEvent?.country} \u00b7 {c.conflictEntry.conflictEvent?.best} fatalities \u00b7 {c.timeDeltaHours.toFixed(1)}h apart
                </div>
                <div className="text-muted-foreground/40 mt-0.5 italic">{c.reason}</div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ConflictRow({
  entry,
  isExpanded,
  isCorrelated,
  onToggle,
  onFocus,
  correlations,
}: {
  entry: TimelineEntry;
  isExpanded: boolean;
  isCorrelated: boolean;
  onToggle: () => void;
  onFocus: () => void;
  correlations: CorrelationMatch[];
}) {
  const evt = entry.conflictEvent;
  if (!evt) return null;

  const typeColors: Record<number, string> = { 1: "text-red-400", 2: "text-orange-400", 3: "text-yellow-400" };
  const typeBgs: Record<number, string> = { 1: "bg-red-400", 2: "bg-orange-400", 3: "bg-yellow-400" };

  return (
    <div
      className={`relative pl-10 pr-3 py-1.5 cursor-pointer hover:bg-foreground/[0.03] transition-colors ${
        isCorrelated ? "bg-amber-500/[0.05]" : ""
      }`}
      onClick={onToggle}
    >
      <div
        className={`absolute left-[18px] top-3 w-3 h-3 rounded-full border-2 border-gray-900 ${typeBgs[evt.type] ?? "bg-red-400"} ${
          isCorrelated ? "ring-2 ring-amber-400/40" : ""
        }`}
      />
      <div className="flex items-center gap-2">
        <Flame className={`w-3 h-3 ${typeColors[evt.type] ?? "text-red-400"} shrink-0`} />
        <span className="text-[10px] font-medium text-foreground/80 truncate">{evt.conflict}</span>
        {isCorrelated && <Zap className="w-3 h-3 text-amber-400 shrink-0" />}
        <span className="text-[9px] text-muted-foreground/50 ml-auto shrink-0">{evt.date}</span>
      </div>
      <div className="text-[9px] text-muted-foreground/50 mt-0.5 ml-5 flex items-center gap-2">
        <span>{evt.country}</span>
        <span>\u00b7</span>
        <span>{VIOLENCE_LABELS[evt.type] ?? "Unknown"}</span>
        <span>\u00b7</span>
        <span>{evt.best} fatalities</span>
      </div>
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-1.5 ml-5 space-y-1.5"
          >
            <div className="bg-background/40 rounded-md p-2 text-[9px] space-y-1">
              <div className="flex items-center gap-2">
                <MapPin className="w-3 h-3 text-muted-foreground/50" />
                <span className="text-foreground/60 font-mono">
                  {evt.lat.toFixed(4)}\u00b0, {evt.lng.toFixed(4)}\u00b0
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onFocus(); }}
                  className="text-cyan-400 hover:text-cyan-300 transition-colors ml-auto"
                >
                  <Crosshair className="w-3 h-3" />
                </button>
              </div>
              <div className="text-muted-foreground/50">
                <span className="font-medium text-foreground/60">Side A:</span> {evt.sideA}
              </div>
              {evt.sideB && (
                <div className="text-muted-foreground/50">
                  <span className="font-medium text-foreground/60">Side B:</span> {evt.sideB}
                </div>
              )}
              <div className="text-muted-foreground/50">
                <span className="font-medium text-foreground/60">Region:</span> {evt.region}
              </div>
            </div>
            {correlations.length > 0 && (
              <>
                <div className="text-[9px] text-amber-400 font-semibold flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  Correlated Signal Events
                </div>
                {correlations.map((c, i) => (
                  <div key={i} className="bg-cyan-500/5 border border-cyan-500/10 rounded-md p-1.5 text-[9px]">
                    <div className="flex items-center gap-1 text-foreground/70">
                      <Radio className="w-3 h-3 text-cyan-400" />
                      <span className="font-medium">{c.signalEntry.stationLabel}</span>
                      <span className="text-muted-foreground/50">{c.signalEntry.signalEventType}</span>
                      <span className="text-amber-400 font-mono ml-auto">{(c.score * 100).toFixed(0)}%</span>
                    </div>
                    <div className="text-muted-foreground/50 mt-0.5">
                      SNR: {c.signalEntry.snr ?? "N/A"} dB \u00b7 {c.timeDeltaHours.toFixed(1)}h apart
                    </div>
                    <div className="text-muted-foreground/40 mt-0.5 italic">{c.reason}</div>
                  </div>
                ))}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
