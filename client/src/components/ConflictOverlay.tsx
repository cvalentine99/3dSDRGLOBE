/**
 * ConflictOverlay — UCDP conflict event overlay for the 3D globe
 * Shows armed conflict events as colored markers with filtering and detail view.
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
} from "lucide-react";
import { trpc } from "@/lib/trpc";

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
}

export default function ConflictOverlay({
  visible,
  onEventsLoaded,
  onEventSelect,
}: ConflictOverlayProps) {
  // ── Filter state ────────────────────────────────────────────────
  const [region, setRegion] = useState("All");
  const [typeFilter, setTypeFilter] = useState<Set<number>>(new Set([1, 2, 3]));
  const [daysBack, setDaysBack] = useState(365);
  const [expanded, setExpanded] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<SlimConflictEvent | null>(null);

  // ── Computed date range ─────────────────────────────────────────
  const startDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    return d.toISOString().split("T")[0];
  }, [daysBack]);

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

  // ── Pass events to parent for globe rendering ───────────────────
  useEffect(() => {
    if (eventsData?.events && onEventsLoaded) {
      onEventsLoaded(eventsData.events as SlimConflictEvent[]);
    }
  }, [eventsData, onEventsLoaded]);

  // ── Clear events when hidden ────────────────────────────────────
  useEffect(() => {
    if (!visible && onEventsLoaded) {
      onEventsLoaded([]);
    }
  }, [visible, onEventsLoaded]);

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

  if (!visible) return null;

  const eventCount = eventsData?.fetchedCount ?? 0;
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
                  Events shown
                </span>
                <span className="text-xs font-mono text-foreground">
                  {eventCount.toLocaleString()}
                  {totalCount > eventCount && (
                    <span className="text-muted-foreground">
                      {" "}
                      / {totalCount.toLocaleString()}
                    </span>
                  )}
                </span>
              </div>

              {/* Type breakdown */}
              {summaryData && (
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
