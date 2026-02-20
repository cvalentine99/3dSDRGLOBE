/**
 * ConflictOverlay — UCDP conflict event overlay for the 3D globe
 * Shows armed conflict events as colored markers with filtering, detail view,
 * heatmap mode, timeline scrubber, and receiver-conflict correlation.
 * Data source: Uppsala Conflict Data Program (UCDP) Georeferenced Event Dataset
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Flame,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  X,
  Filter,
  Calendar,
  MapPin,
  Skull,
  Shield,
  Users,
  Crosshair,
  Info,
  Globe2,
  BarChart3,
  Layers,
  Radio,
  AlertTriangle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useRadio } from "@/contexts/RadioContext";
import TimelineScrubber from "./TimelineScrubber";
import {
  computeConflictCorrelations,
  getStationThreatLevel,
  type ConflictCorrelation,
} from "@/lib/conflictCorrelation";

// ── Types ───────────────────────────────────────────────────────────
export interface SlimConflictEvent {
  id: number;
  lat: number;
  lng: number;
  type: number; // 1=state-based, 2=non-state, 3=one-sided
  best: number; // fatalities best estimate
  date: string;
  country: string;
  region: string;
  conflict: string;
  sideA: string;
  sideB: string;
}

// ── Color mapping by violence type ──────────────────────────────────
export const VIOLENCE_TYPE_COLORS: Record<number, string> = {
  1: "#ef4444", // State-based → red
  2: "#f97316", // Non-state → orange
  3: "#eab308", // One-sided → yellow
};

export const VIOLENCE_TYPE_LABELS: Record<number, string> = {
  1: "State-based",
  2: "Non-state",
  3: "One-sided",
};

export const VIOLENCE_TYPE_ICONS: Record<number, string> = {
  1: "⚔️",
  2: "🔥",
  3: "💀",
};

// ── Marker size by fatalities ───────────────────────────────────────
export function getMarkerSize(fatalities: number): number {
  if (fatalities <= 0) return 0.03;
  if (fatalities <= 5) return 0.04;
  if (fatalities <= 20) return 0.055;
  if (fatalities <= 100) return 0.07;
  if (fatalities <= 500) return 0.09;
  return 0.12;
}

// ── Region options ──────────────────────────────────────────────────
const REGIONS = ["All", "Africa", "Americas", "Asia", "Europe", "Middle East"];

// ── Date range presets ──────────────────────────────────────────────
const DATE_PRESETS = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "6 months", days: 180 },
  { label: "1 year", days: 365 },
  { label: "2 years", days: 730 },
];

interface ConflictOverlayProps {
  visible: boolean;
  onEventsLoaded?: (events: SlimConflictEvent[]) => void;
  onEventSelect?: (event: SlimConflictEvent | null) => void;
  /** Callback to toggle heatmap mode */
  onHeatmapToggle?: (enabled: boolean) => void;
  /** Current heatmap mode state */
  heatmapMode?: boolean;
  /** Callback when conflict zone stations are computed */
  onConflictZoneStations?: (labels: Set<string>) => void;
  /** Correlation radius in km */
  correlationRadius?: number;
  /** Callback to change correlation radius */
  onCorrelationRadiusChange?: (radius: number) => void;
}

export default function ConflictOverlay({
  visible,
  onEventsLoaded,
  onEventSelect,
  onHeatmapToggle,
  heatmapMode = false,
  onConflictZoneStations,
  correlationRadius = 200,
  onCorrelationRadiusChange,
}: ConflictOverlayProps) {
  // ── Filter state ────────────────────────────────────────────────
  const [region, setRegion] = useState("All");
  const [typeFilter, setTypeFilter] = useState<Set<number>>(new Set([1, 2, 3]));
  const [daysBack, setDaysBack] = useState(365);
  const [expanded, setExpanded] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<SlimConflictEvent | null>(null);
  const [showCorrelation, setShowCorrelation] = useState(false);
  const [timelineActive, setTimelineActive] = useState(false);
  const [timelineRange, setTimelineRange] = useState<{ start: string; end: string } | null>(null);

  // ── Access stations from RadioContext ───────────────────────────
  const { filteredStations } = useRadio();

  // ── Computed date range ─────────────────────────────────────────
  const startDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    return d.toISOString().split("T")[0];
  }, [daysBack]);

  const endDate = useMemo(() => {
    return new Date().toISOString().split("T")[0];
  }, []);

  // ── Data fetching ───────────────────────────────────────────────
  const queryInput = useMemo(
    () => ({
      startDate,
      region: region === "All" ? undefined : region,
      typeOfViolence:
        typeFilter.size === 3
          ? undefined
          : Array.from(typeFilter).join(","),
      maxPages: 20,
    }),
    [startDate, region, typeFilter]
  );

  const {
    data: eventsData,
    isLoading,
    isFetching,
    refetch,
  } = trpc.ucdp.getEvents.useQuery(queryInput, {
    enabled: visible,
    staleTime: 60 * 60 * 1000, // 1 hour
    refetchOnWindowFocus: false,
  });

  const { data: summaryData } = trpc.ucdp.getSummary.useQuery(queryInput, {
    enabled: visible && expanded,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // ── Filter events by timeline if active ─────────────────────────
  const displayEvents = useMemo(() => {
    if (!eventsData?.events) return [];
    const events = eventsData.events as SlimConflictEvent[];
    if (!timelineActive || !timelineRange) return events;

    return events.filter((e) => {
      return e.date >= timelineRange.start && e.date <= timelineRange.end;
    });
  }, [eventsData, timelineActive, timelineRange]);

  // ── Pass events to parent for globe rendering ───────────────────
  useEffect(() => {
    if (onEventsLoaded) {
      onEventsLoaded(displayEvents);
    }
  }, [displayEvents, onEventsLoaded]);

  // ── Clear events when hidden ────────────────────────────────────
  useEffect(() => {
    if (!visible && onEventsLoaded) {
      onEventsLoaded([]);
    }
  }, [visible, onEventsLoaded]);

  // ── Compute conflict-receiver correlations ──────────────────────
  const correlations = useMemo(() => {
    if (!showCorrelation || displayEvents.length === 0 || filteredStations.length === 0) {
      return [];
    }
    return computeConflictCorrelations(filteredStations, displayEvents, correlationRadius);
  }, [showCorrelation, displayEvents, filteredStations, correlationRadius]);

  // ── Pass conflict zone station labels to parent ─────────────────
  useEffect(() => {
    if (onConflictZoneStations) {
      if (showCorrelation && correlations.length > 0) {
        onConflictZoneStations(new Set(correlations.map((c) => c.station.label)));
      } else {
        onConflictZoneStations(new Set());
      }
    }
  }, [correlations, showCorrelation, onConflictZoneStations]);

  const toggleType = useCallback((type: number) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size > 1) next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const handleEventClick = useCallback(
    (event: SlimConflictEvent) => {
      setSelectedEvent(event);
      onEventSelect?.(event);
    },
    [onEventSelect]
  );

  const handleMonthChange = useCallback((start: string, end: string) => {
    setTimelineActive(true);
    setTimelineRange({ start, end });
  }, []);

  const handleShowAll = useCallback(() => {
    setTimelineActive(false);
    setTimelineRange(null);
  }, []);

  if (!visible) return null;

  const eventCount = displayEvents.length;
  const totalCount = eventsData?.totalCount ?? 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="absolute top-20 right-4 z-30 w-80"
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="glass-panel rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-red-500 dark:text-red-400" />
              <span className="text-sm font-semibold tracking-wide text-foreground">
                CONFLICT DATA
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-600 dark:text-red-400 font-mono">
                UCDP
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => refetch()}
                className="p-1 rounded hover:bg-foreground/10 transition-colors"
                title="Refresh data"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 text-muted-foreground ${
                    isFetching ? "animate-spin" : ""
                  }`}
                />
              </button>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="p-1 rounded hover:bg-foreground/10 transition-colors"
                title="Toggle filters"
              >
                <Filter
                  className={`w-3.5 h-3.5 ${
                    showFilters
                      ? "text-red-500 dark:text-red-400"
                      : "text-muted-foreground"
                  }`}
                />
              </button>
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-1 rounded hover:bg-foreground/10 transition-colors"
              >
                {expanded ? (
                  <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </button>
            </div>
          </div>

          {/* ── Mode toggles (Heatmap + Correlation) ──────────────── */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-border">
            <button
              onClick={() => onHeatmapToggle?.(!heatmapMode)}
              className={`text-[10px] px-2 py-1 rounded-md transition-colors flex items-center gap-1 ${
                heatmapMode
                  ? "bg-orange-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/30"
                  : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 border border-transparent"
              }`}
              title="Toggle heatmap density view"
            >
              <Layers className="w-3 h-3" />
              Heatmap
            </button>
            <button
              onClick={() => setShowCorrelation(!showCorrelation)}
              className={`text-[10px] px-2 py-1 rounded-md transition-colors flex items-center gap-1 ${
                showCorrelation
                  ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                  : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 border border-transparent"
              }`}
              title="Highlight receivers near conflict zones"
            >
              <Radio className="w-3 h-3" />
              Receivers
            </button>
            {showCorrelation && (
              <span className="text-[9px] text-amber-600 dark:text-amber-400 font-mono ml-auto">
                {correlations.length} found
              </span>
            )}
          </div>

          {/* ── Loading state ──────────────────────────────────── */}
          {isLoading && (
            <div className="px-4 py-6 text-center">
              <RefreshCw className="w-5 h-5 text-red-500 dark:text-red-400 animate-spin mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">
                Loading conflict data...
              </p>
            </div>
          )}

          {/* ── Filters panel ──────────────────────────────────── */}
          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden border-b border-border"
              >
                <div className="px-4 py-3 space-y-3">
                  {/* Date range */}
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1 mb-1.5">
                      <Calendar className="w-3 h-3" /> Time Range
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {DATE_PRESETS.map((preset) => (
                        <button
                          key={preset.days}
                          onClick={() => setDaysBack(preset.days)}
                          className={`text-[10px] px-2 py-1 rounded-md transition-colors ${
                            daysBack === preset.days
                              ? "bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30"
                              : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 border border-transparent"
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Region filter */}
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1 mb-1.5">
                      <Globe2 className="w-3 h-3" /> Region
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {REGIONS.map((r) => (
                        <button
                          key={r}
                          onClick={() => setRegion(r)}
                          className={`text-[10px] px-2 py-1 rounded-md transition-colors ${
                            region === r
                              ? "bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30"
                              : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 border border-transparent"
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Violence type filter */}
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1 mb-1.5">
                      <Crosshair className="w-3 h-3" /> Violence Type
                    </label>
                    <div className="flex gap-1">
                      {[1, 2, 3].map((type) => (
                        <button
                          key={type}
                          onClick={() => toggleType(type)}
                          className={`text-[10px] px-2 py-1 rounded-md transition-colors flex items-center gap-1 ${
                            typeFilter.has(type)
                              ? "border"
                              : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 border border-transparent opacity-50"
                          }`}
                          style={
                            typeFilter.has(type)
                              ? {
                                  backgroundColor: `${VIOLENCE_TYPE_COLORS[type]}20`,
                                  color: VIOLENCE_TYPE_COLORS[type],
                                  borderColor: `${VIOLENCE_TYPE_COLORS[type]}40`,
                                }
                              : undefined
                          }
                        >
                          <span>{VIOLENCE_TYPE_ICONS[type]}</span>
                          {VIOLENCE_TYPE_LABELS[type]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Correlation radius (only when correlation is active) */}
                  {showCorrelation && (
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1 mb-1.5">
                        <Radio className="w-3 h-3" /> Correlation Radius
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={50}
                          max={500}
                          step={25}
                          value={correlationRadius}
                          onChange={(e) => onCorrelationRadiusChange?.(Number(e.target.value))}
                          className="flex-1 h-1 rounded-full appearance-none cursor-pointer
                            [&::-webkit-slider-thumb]:appearance-none
                            [&::-webkit-slider-thumb]:w-3
                            [&::-webkit-slider-thumb]:h-3
                            [&::-webkit-slider-thumb]:rounded-full
                            [&::-webkit-slider-thumb]:bg-amber-500
                            [&::-webkit-slider-thumb]:cursor-pointer"
                          style={{ background: `linear-gradient(to right, #f59e0b 0%, var(--color-foreground, #888) 100%)`, opacity: 0.5 }}
                        />
                        <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 min-w-[40px] text-right">
                          {correlationRadius}km
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Summary stats ──────────────────────────────────── */}
          {expanded && !isLoading && (
            <div className="px-4 py-3 space-y-3">
              {/* Event count bar */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Events {timelineActive ? "(filtered)" : "shown"}
                </span>
                <span className="text-xs font-mono text-foreground">
                  {eventCount.toLocaleString()}
                  {totalCount > eventCount && !timelineActive && (
                    <span className="text-muted-foreground">
                      {" "}
                      / {totalCount.toLocaleString()}
                    </span>
                  )}
                </span>
              </div>

              {/* Type breakdown */}
              {summaryData && !timelineActive && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <StatCard
                      icon={<Shield className="w-3 h-3" />}
                      label="State"
                      value={summaryData.byType.stateBased}
                      color="#ef4444"
                    />
                    <StatCard
                      icon={<Users className="w-3 h-3" />}
                      label="Non-state"
                      value={summaryData.byType.nonState}
                      color="#f97316"
                    />
                    <StatCard
                      icon={<Skull className="w-3 h-3" />}
                      label="One-sided"
                      value={summaryData.byType.oneSided}
                      color="#eab308"
                    />
                  </div>

                  {/* Fatality stats */}
                  <div className="flex items-center justify-between py-2 border-t border-border">
                    <div className="flex items-center gap-1.5">
                      <Skull className="w-3 h-3 text-red-500 dark:text-red-400" />
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Fatalities
                      </span>
                    </div>
                    <span className="text-xs font-mono text-red-600 dark:text-red-400 font-semibold">
                      {summaryData.totalFatalities.toLocaleString()}
                    </span>
                  </div>

                  {/* Top countries */}
                  {summaryData.topCountries.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <BarChart3 className="w-3 h-3 text-muted-foreground" />
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Most affected
                        </span>
                      </div>
                      <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
                        {summaryData.topCountries.slice(0, 8).map((c) => (
                          <div
                            key={c.name}
                            className="flex items-center justify-between text-[11px] cursor-pointer hover:bg-foreground/5 rounded px-1 py-0.5 transition-colors"
                            onClick={() => setRegion("All")}
                          >
                            <span className="text-foreground/80 truncate">
                              {c.name}
                            </span>
                            <span className="text-muted-foreground font-mono ml-2">
                              {c.count.toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Attribution */}
              <div className="flex items-start gap-1.5 pt-2 border-t border-border">
                <Info className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-[9px] text-muted-foreground leading-relaxed">
                  Data: Uppsala Conflict Data Program (UCDP) GED v25.1.
                  Free for academic and non-commercial use.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Timeline Scrubber ────────────────────────────────── */}
        {expanded && !isLoading && eventsData && (
          <TimelineScrubber
            startDate={startDate}
            endDate={endDate}
            onMonthChange={handleMonthChange}
            onShowAll={handleShowAll}
            isActive={timelineActive}
          />
        )}

        {/* ── Correlation Panel ────────────────────────────────── */}
        <AnimatePresence>
          {showCorrelation && correlations.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="glass-panel rounded-xl mt-2 overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-xs font-semibold text-foreground">
                    Receivers in Conflict Zones
                  </span>
                </div>
                <span className="text-[9px] font-mono text-amber-600 dark:text-amber-400">
                  {correlations.length}
                </span>
              </div>
              <div className="max-h-48 overflow-y-auto custom-scrollbar">
                {correlations.slice(0, 20).map((corr) => (
                  <CorrelationRow key={corr.station.label} correlation={corr} />
                ))}
                {correlations.length > 20 && (
                  <div className="px-4 py-2 text-center text-[9px] text-muted-foreground">
                    +{correlations.length - 20} more receivers
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Selected event detail ────────────────────────────── */}
        <AnimatePresence>
          {selectedEvent && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="glass-panel rounded-xl mt-2 overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                <div className="flex items-center gap-2">
                  <MapPin
                    className="w-3.5 h-3.5"
                    style={{ color: VIOLENCE_TYPE_COLORS[selectedEvent.type] }}
                  />
                  <span className="text-xs font-semibold text-foreground">
                    Event Detail
                  </span>
                </div>
                <button
                  onClick={() => {
                    setSelectedEvent(null);
                    onEventSelect?.(null);
                  }}
                  className="p-1 rounded hover:bg-foreground/10 transition-colors"
                >
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>
              <div className="px-4 py-3 space-y-2">
                <div className="text-xs font-medium text-foreground">
                  {selectedEvent.conflict}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                  <DetailRow label="Type" value={VIOLENCE_TYPE_LABELS[selectedEvent.type]} />
                  <DetailRow label="Date" value={selectedEvent.date} />
                  <DetailRow label="Country" value={selectedEvent.country} />
                  <DetailRow label="Region" value={selectedEvent.region} />
                  <DetailRow label="Side A" value={selectedEvent.sideA} />
                  <DetailRow label="Side B" value={selectedEvent.sideB || "—"} />
                  <DetailRow
                    label="Fatalities"
                    value={String(selectedEvent.best)}
                    highlight
                  />
                  <DetailRow
                    label="Location"
                    value={`${selectedEvent.lat.toFixed(3)}, ${selectedEvent.lng.toFixed(3)}`}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Sub-components ──────────────────────────────────────────────────
function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div
      className="rounded-lg px-2 py-1.5 border"
      style={{
        backgroundColor: `${color}10`,
        borderColor: `${color}25`,
      }}
    >
      <div className="flex items-center gap-1 mb-0.5" style={{ color }}>
        {icon}
        <span className="text-[9px] uppercase tracking-wider font-medium">
          {label}
        </span>
      </div>
      <div className="text-sm font-mono font-semibold" style={{ color }}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <span className="text-muted-foreground text-[10px] uppercase tracking-wider">
        {label}
      </span>
      <div
        className={`text-[11px] ${
          highlight
            ? "text-red-600 dark:text-red-400 font-semibold"
            : "text-foreground/80"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function CorrelationRow({ correlation }: { correlation: ConflictCorrelation }) {
  const threatLevel = getStationThreatLevel(correlation);
  const threatColor =
    threatLevel > 0.6
      ? "text-red-600 dark:text-red-400"
      : threatLevel > 0.3
        ? "text-amber-600 dark:text-amber-400"
        : "text-yellow-600 dark:text-yellow-400";

  const threatBg =
    threatLevel > 0.6
      ? "bg-red-500/10"
      : threatLevel > 0.3
        ? "bg-amber-500/10"
        : "bg-yellow-500/10";

  return (
    <div className={`flex items-center justify-between px-4 py-2 border-b border-border/50 ${threatBg} hover:bg-foreground/5 transition-colors`}>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium text-foreground truncate">
          {correlation.station.label}
        </div>
        <div className="text-[9px] text-muted-foreground">
          {correlation.station.receivers[0]?.type ?? "SDR"} · {Math.round(correlation.closestDistance)}km to nearest
        </div>
      </div>
      <div className="flex items-center gap-2 ml-2 shrink-0">
        <div className="text-right">
          <div className={`text-[10px] font-mono font-semibold ${threatColor}`}>
            {correlation.nearbyConflicts}
          </div>
          <div className="text-[8px] text-muted-foreground">events</div>
        </div>
        {correlation.totalFatalities > 0 && (
          <div className="text-right">
            <div className="text-[10px] font-mono font-semibold text-red-600 dark:text-red-400">
              {correlation.totalFatalities}
            </div>
            <div className="text-[8px] text-muted-foreground">fatal</div>
          </div>
        )}
      </div>
    </div>
  );
}
