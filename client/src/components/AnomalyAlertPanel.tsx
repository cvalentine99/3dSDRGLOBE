/**
 * AnomalyAlertPanel.tsx — Displays anomaly detection alerts
 *
 * Shows flagged targets whose positions deviate from prediction models
 * AND targets that have drifted into active conflict zones.
 * Features:
 * - Alert list with severity indicators (low/medium/high)
 * - Filter tabs: All, Position Anomaly, Conflict Zone
 * - Acknowledge individual or all alerts
 * - Click to focus globe on anomalous target
 * - Real-time unacknowledged count badge
 * - Conflict zone context (zone name, event count, fatalities)
 */
import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  AlertTriangle,
  AlertCircle,
  AlertOctagon,
  Check,
  CheckCheck,
  Trash2,
  MapPin,
  Navigation,
  Clock,
  ChevronDown,
  ChevronUp,
  Bell,
  BellOff,
  Flame,
  Crosshair,
  Shield,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface AnomalyAlertPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onFocusTarget?: (lat: number, lon: number) => void;
  targets?: Array<{ id: number; label: string; category: string }>;
}

const SEVERITY_CONFIG = {
  low: {
    icon: AlertCircle,
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
    border: "border-yellow-400/30",
    label: "Low",
    description: "Unusual deviation (1.5-2\u03c3)",
  },
  medium: {
    icon: AlertTriangle,
    color: "text-orange-400",
    bg: "bg-orange-400/10",
    border: "border-orange-400/30",
    label: "Medium",
    description: "Unexpected movement (2-3\u03c3)",
  },
  high: {
    icon: AlertOctagon,
    color: "text-red-400",
    bg: "bg-red-400/10",
    border: "border-red-400/30",
    label: "High",
    description: "Significant anomaly (>3\u03c3)",
  },
};

type AlertFilter = "all" | "position" | "conflict";

export default function AnomalyAlertPanel({
  isOpen,
  onClose,
  onFocusTarget,
  targets = [],
}: AnomalyAlertPanelProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const [alertFilter, setAlertFilter] = useState<AlertFilter>("all");

  const utils = trpc.useUtils();

  const alertsQuery = trpc.anomalies.list.useQuery(
    {
      limit: 50,
      acknowledged: showAcknowledged ? undefined : false,
      alertType: alertFilter,
    },
    { refetchInterval: 15000 }
  );

  const countQuery = trpc.anomalies.unacknowledgedCount.useQuery(undefined, {
    refetchInterval: 15000,
  });

  const acknowledgeMut = trpc.anomalies.acknowledge.useMutation({
    onSuccess: () => {
      utils.anomalies.list.invalidate();
      utils.anomalies.unacknowledgedCount.invalidate();
    },
  });

  const deleteMut = trpc.anomalies.dismiss.useMutation({
    onSuccess: () => {
      utils.anomalies.list.invalidate();
      utils.anomalies.unacknowledgedCount.invalidate();
    },
  });

  const alerts = alertsQuery.data ?? [];
  const counts = countQuery.data ?? { count: 0, positionCount: 0, conflictCount: 0 };

  const getTargetLabel = useCallback(
    (targetId: number) => {
      const target = targets.find((t) => t.id === targetId);
      return target?.label ?? `Target #${targetId}`;
    },
    [targets]
  );

  const formatTime = (ts: number) => {
    const now = Date.now();
    const diffMs = now - ts;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return new Date(ts).toLocaleDateString();
  };

  /** Parse conflict zone details from alert description */
  const parseConflictDetails = (description: string | null) => {
    if (!description || !description.startsWith("[CONFLICT ZONE]")) return null;
    const lines = description.split("\n");
    const details: Record<string, string> = {};
    for (const line of lines) {
      const match = line.match(/^(.+?):\s*(.+)$/);
      if (match) {
        details[match[1].trim()] = match[2].trim();
      }
    }
    return {
      closestDistance: details["Closest conflict event"] ?? "N/A",
      nearbyEvents: details[`Nearby events (within 200km)`] ?? "N/A",
      totalFatalities: details["Total fatalities in area"] ?? "N/A",
      primaryConflict: details["Primary conflict"] ?? null,
      country: details["Country"] ?? null,
    };
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="fixed right-4 top-20 w-[420px] max-h-[calc(100vh-120px)] bg-gray-900/95 backdrop-blur-xl border border-red-500/20 rounded-xl shadow-2xl shadow-red-500/5 z-50 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-sm font-semibold text-foreground tracking-wide uppercase">
              Anomaly Alerts
            </span>
            {counts.count > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-red-500/20 text-red-400 rounded-full">
                {counts.count}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowAcknowledged(!showAcknowledged)}
              className={`p-1.5 rounded-lg transition-colors ${
                showAcknowledged
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground/70 hover:text-foreground/70"
              }`}
              title={showAcknowledged ? "Hide acknowledged" : "Show acknowledged"}
            >
              {showAcknowledged ? (
                <Bell className="w-3.5 h-3.5" />
              ) : (
                <BellOff className="w-3.5 h-3.5" />
              )}
            </button>
            {alerts.some((a) => !a.acknowledged) && (
              <button
                onClick={() => {
                  alerts.filter(a => !a.acknowledged).forEach(a => acknowledgeMut.mutate({ id: a.id }));
                }}
                className="p-1.5 text-muted-foreground/70 hover:text-green-400 rounded-lg transition-colors"
                title="Acknowledge all"
              >
                <CheckCheck className="w-3.5 h-3.5" />
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

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-border">
          <button
            onClick={() => setAlertFilter("all")}
            className={`text-[10px] px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 ${
              alertFilter === "all"
                ? "bg-red-500/20 text-red-400 border border-red-500/30"
                : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 border border-transparent"
            }`}
          >
            <Shield className="w-3 h-3" />
            All
            {counts.count > 0 && (
              <span className="text-[8px] font-bold ml-0.5">{counts.count}</span>
            )}
          </button>
          <button
            onClick={() => setAlertFilter("position")}
            className={`text-[10px] px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 ${
              alertFilter === "position"
                ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 border border-transparent"
            }`}
          >
            <Crosshair className="w-3 h-3" />
            Position
            {counts.positionCount > 0 && (
              <span className="text-[8px] font-bold ml-0.5">{counts.positionCount}</span>
            )}
          </button>
          <button
            onClick={() => setAlertFilter("conflict")}
            className={`text-[10px] px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 ${
              alertFilter === "conflict"
                ? "bg-red-500/20 text-red-400 border border-red-500/30"
                : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 border border-transparent"
            }`}
          >
            <Flame className="w-3 h-3" />
            Conflict
            {counts.conflictCount > 0 && (
              <span className="text-[8px] font-bold ml-0.5">{counts.conflictCount}</span>
            )}
          </button>
        </div>

        {/* Alert List */}
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-border">
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/50">
              <AlertCircle className="w-8 h-8 mb-2" />
              <p className="text-sm">No anomaly alerts</p>
              <p className="text-xs mt-1 text-center px-4">
                {alertFilter === "conflict"
                  ? "Conflict zone alerts appear when targets drift near active conflict zones"
                  : alertFilter === "position"
                    ? "Position alerts appear when targets move outside their predicted zones"
                    : "Alerts appear when targets move unexpectedly or enter conflict zones"}
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {alerts.map((alert: any) => {
                const severity =
                  SEVERITY_CONFIG[alert.severity as keyof typeof SEVERITY_CONFIG] ??
                  SEVERITY_CONFIG.medium;
                const SeverityIcon = severity.icon;
                const isExpanded = expandedId === alert.id;
                const isConflictAlert = alert.alertType === "conflict";
                const conflictDetails = isConflictAlert
                  ? parseConflictDetails(alert.description)
                  : null;

                return (
                  <motion.div
                    key={alert.id}
                    layout
                    className={`rounded-lg border ${severity.border} ${severity.bg} overflow-hidden ${
                      alert.acknowledged ? "opacity-50" : ""
                    }`}
                  >
                    {/* Alert Header */}
                    <div
                      className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-foreground/5 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : alert.id)}
                    >
                      <div className="relative shrink-0">
                        <SeverityIcon className={`w-4 h-4 ${severity.color}`} />
                        {isConflictAlert && (
                          <Flame className="w-2.5 h-2.5 text-red-500 absolute -bottom-0.5 -right-0.5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-foreground truncate">
                            {alert.targetLabel ?? getTargetLabel(alert.targetId)}
                          </span>
                          <span
                            className={`px-1 py-0.5 text-[9px] font-bold uppercase rounded ${severity.bg} ${severity.color}`}
                          >
                            {severity.label}
                          </span>
                          {isConflictAlert && (
                            <span className="px-1 py-0.5 text-[8px] font-bold uppercase rounded bg-red-500/20 text-red-400">
                              CONFLICT
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70 mt-0.5">
                          {isConflictAlert ? (
                            <>
                              <span>{conflictDetails?.closestDistance ?? `${alert.deviationKm.toFixed(1)} km`}</span>
                              {conflictDetails?.country && (
                                <>
                                  <span>·</span>
                                  <span>{conflictDetails.country}</span>
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              <span>{alert.deviationKm.toFixed(1)} km deviation</span>
                              <span>·</span>
                              <span>{alert.deviationSigma.toFixed(1)}\u03c3</span>
                            </>
                          )}
                          <span>·</span>
                          <span>{formatTime(alert.createdAt)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!alert.acknowledged && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              acknowledgeMut.mutate({ id: alert.id });
                            }}
                            className="p-1 text-muted-foreground/50 hover:text-green-400 transition-colors"
                            title="Acknowledge"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        )}
                        {isExpanded ? (
                          <ChevronUp className="w-3 h-3 text-muted-foreground/50" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
                        )}
                      </div>
                    </div>

                    {/* Expanded Details */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="border-t border-border"
                        >
                          <div className="px-3 py-2 space-y-2 text-xs">
                            {/* Conflict zone details */}
                            {isConflictAlert && conflictDetails && (
                              <div className="bg-red-500/5 rounded-lg p-2 border border-red-500/10">
                                <div className="text-[10px] font-semibold text-red-400 mb-1.5 flex items-center gap-1">
                                  <Flame className="w-3 h-3" />
                                  Conflict Zone Context
                                </div>
                                <div className="grid grid-cols-2 gap-1.5">
                                  <div>
                                    <div className="text-[9px] text-muted-foreground/50">Nearby Events</div>
                                    <div className="text-[11px] text-foreground/70 font-mono">
                                      {conflictDetails.nearbyEvents}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[9px] text-muted-foreground/50">Total Fatalities</div>
                                    <div className="text-[11px] text-foreground/70 font-mono">
                                      {conflictDetails.totalFatalities}
                                    </div>
                                  </div>
                                  {conflictDetails.primaryConflict && (
                                    <div className="col-span-2">
                                      <div className="text-[9px] text-muted-foreground/50">Primary Conflict</div>
                                      <div className="text-[11px] text-foreground/70 leading-tight">
                                        {conflictDetails.primaryConflict}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Position comparison (for position anomalies) */}
                            {!isConflictAlert && (
                              <div className="grid grid-cols-2 gap-2">
                                <div className="bg-background/40 rounded-lg p-2">
                                  <div className="text-muted-foreground/70 text-[10px] mb-1 flex items-center gap-1">
                                    <Navigation className="w-3 h-3" />
                                    Predicted
                                  </div>
                                  <div className="text-foreground/70 font-mono text-[11px]">
                                    {parseFloat(alert.predictedLat).toFixed(4)}\u00b0,{" "}
                                    {parseFloat(alert.predictedLon).toFixed(4)}\u00b0
                                  </div>
                                </div>
                                <div className="bg-background/40 rounded-lg p-2">
                                  <div className="text-muted-foreground/70 text-[10px] mb-1 flex items-center gap-1">
                                    <MapPin className="w-3 h-3" />
                                    Observed
                                  </div>
                                  <div className="text-foreground/70 font-mono text-[11px]">
                                    {parseFloat(alert.actualLat).toFixed(4)}\u00b0,{" "}
                                    {parseFloat(alert.actualLon).toFixed(4)}\u00b0
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Position for conflict alerts */}
                            {isConflictAlert && (
                              <div className="bg-background/40 rounded-lg p-2">
                                <div className="text-muted-foreground/70 text-[10px] mb-1 flex items-center gap-1">
                                  <MapPin className="w-3 h-3" />
                                  Target Position
                                </div>
                                <div className="text-foreground/70 font-mono text-[11px]">
                                  {parseFloat(alert.actualLat).toFixed(4)}\u00b0,{" "}
                                  {parseFloat(alert.actualLon).toFixed(4)}\u00b0
                                </div>
                              </div>
                            )}

                            {/* Description */}
                            {alert.description && (
                              <div className="bg-background/40 rounded-lg p-2 text-foreground/50 text-[11px] leading-relaxed whitespace-pre-line">
                                {alert.description}
                              </div>
                            )}

                            {/* Actions */}
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                onClick={() => {
                                  onFocusTarget?.(
                                    parseFloat(alert.actualLat),
                                    parseFloat(alert.actualLon)
                                  );
                                }}
                                className="flex items-center gap-1 px-2 py-1 bg-foreground/5 hover:bg-foreground/10 text-foreground/60 hover:text-foreground rounded-md transition-colors text-[11px]"
                              >
                                <MapPin className="w-3 h-3" />
                                Focus on Globe
                              </button>
                              <button
                                onClick={() => {
                                  deleteMut.mutate({ id: alert.id });
                                  setExpandedId(null);
                                }}
                                className="flex items-center gap-1 px-2 py-1 bg-foreground/5 hover:bg-red-500/20 text-muted-foreground/70 hover:text-red-400 rounded-md transition-colors text-[11px]"
                              >
                                <Trash2 className="w-3 h-3" />
                                Delete
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border text-[10px] text-muted-foreground/50 text-center">
          {alertFilter === "conflict"
            ? "Conflict alerts triggered when targets enter active conflict zones"
            : alertFilter === "position"
              ? "Position anomalies detected when targets deviate >1.5\u03c3 from prediction"
              : "Position anomalies + conflict zone proximity alerts"}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
