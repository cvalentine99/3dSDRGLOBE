/**
 * AnomalyAlertPanel.tsx — Displays anomaly detection alerts
 *
 * Shows flagged targets whose positions deviate from prediction models.
 * Features:
 * - Alert list with severity indicators (low/medium/high)
 * - Acknowledge individual or all alerts
 * - Click to focus globe on anomalous target
 * - Real-time unacknowledged count badge
 */
import { useState, useCallback } from "react";
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
    description: "Unusual deviation (1.5-2σ)",
  },
  medium: {
    icon: AlertTriangle,
    color: "text-orange-400",
    bg: "bg-orange-400/10",
    border: "border-orange-400/30",
    label: "Medium",
    description: "Unexpected movement (2-3σ)",
  },
  high: {
    icon: AlertOctagon,
    color: "text-red-400",
    bg: "bg-red-400/10",
    border: "border-red-400/30",
    label: "High",
    description: "Significant anomaly (>3σ)",
  },
};

export default function AnomalyAlertPanel({
  isOpen,
  onClose,
  onFocusTarget,
  targets = [],
}: AnomalyAlertPanelProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showAcknowledged, setShowAcknowledged] = useState(false);

  const utils = trpc.useUtils();

  const alertsQuery = trpc.anomalies.list.useQuery(
    { limit: 50, acknowledged: showAcknowledged ? undefined : false },
    { refetchInterval: 15000 }
  );

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

  const getTargetLabel = useCallback(
    (targetId: number) => {
      const target = targets.find((t) => t.id === targetId);
      return target?.label ?? `Target #${targetId}`;
    },
    [targets]
  );

  const getTargetCategory = useCallback(
    (targetId: number) => {
      const target = targets.find((t) => t.id === targetId);
      return target?.category ?? "unknown";
    },
    [targets]
  );

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    const now = Date.now();
    const diffMs = now - ts;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString();
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
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-sm font-semibold text-white tracking-wide uppercase">
              Anomaly Alerts
            </span>
            {alerts.length > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-red-500/20 text-red-400 rounded-full">
                {alerts.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowAcknowledged(!showAcknowledged)}
              className={`p-1.5 rounded-lg transition-colors ${
                showAcknowledged
                  ? "bg-white/10 text-white"
                  : "text-white/40 hover:text-white/70"
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
                className="p-1.5 text-white/40 hover:text-green-400 rounded-lg transition-colors"
                title="Acknowledge all"
              >
                <CheckCheck className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-white/40 hover:text-white rounded-lg transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Alert List */}
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/30">
              <AlertCircle className="w-8 h-8 mb-2" />
              <p className="text-sm">No anomaly alerts</p>
              <p className="text-xs mt-1">
                Alerts appear when targets move outside their predicted zones
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {alerts.map((alert) => {
                const severity =
                  SEVERITY_CONFIG[alert.severity as keyof typeof SEVERITY_CONFIG] ??
                  SEVERITY_CONFIG.medium;
                const SeverityIcon = severity.icon;
                const isExpanded = expandedId === alert.id;

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
                      className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/5 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : alert.id)}
                    >
                      <SeverityIcon className={`w-4 h-4 ${severity.color} shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-white truncate">
                            {getTargetLabel(alert.targetId)}
                          </span>
                          <span
                            className={`px-1 py-0.5 text-[9px] font-bold uppercase rounded ${severity.bg} ${severity.color}`}
                          >
                            {severity.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-white/40 mt-0.5">
                          <span>{alert.deviationKm.toFixed(1)} km deviation</span>
                          <span>·</span>
                          <span>{alert.deviationSigma.toFixed(1)}σ</span>
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
                            className="p-1 text-white/30 hover:text-green-400 transition-colors"
                            title="Acknowledge"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        )}
                        {isExpanded ? (
                          <ChevronUp className="w-3 h-3 text-white/30" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-white/30" />
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
                          className="border-t border-white/5"
                        >
                          <div className="px-3 py-2 space-y-2 text-xs">
                            {/* Position comparison */}
                            <div className="grid grid-cols-2 gap-2">
                              <div className="bg-black/20 rounded-lg p-2">
                                <div className="text-white/40 text-[10px] mb-1 flex items-center gap-1">
                                  <Navigation className="w-3 h-3" />
                                  Predicted
                                </div>
                                <div className="text-white/70 font-mono text-[11px]">
                                  {parseFloat(alert.predictedLat).toFixed(4)}°,{" "}
                                  {parseFloat(alert.predictedLon).toFixed(4)}°
                                </div>
                              </div>
                              <div className="bg-black/20 rounded-lg p-2">
                                <div className="text-white/40 text-[10px] mb-1 flex items-center gap-1">
                                  <MapPin className="w-3 h-3" />
                                  Observed
                                </div>
                                <div className="text-white/70 font-mono text-[11px]">
                                  {parseFloat(alert.actualLat).toFixed(4)}°,{" "}
                                  {parseFloat(alert.actualLon).toFixed(4)}°
                                </div>
                              </div>
                            </div>

                            {/* Description */}
                            {alert.description && (
                              <div className="bg-black/20 rounded-lg p-2 text-white/50 text-[11px] leading-relaxed whitespace-pre-line">
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
                                className="flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-md transition-colors text-[11px]"
                              >
                                <MapPin className="w-3 h-3" />
                                Focus on Globe
                              </button>
                              <button
                                onClick={() => {
                                  deleteMut.mutate({ id: alert.id });
                                  setExpandedId(null);
                                }}
                                className="flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-red-500/20 text-white/40 hover:text-red-400 rounded-md transition-colors text-[11px]"
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
        <div className="px-4 py-2 border-t border-white/5 text-[10px] text-white/30 text-center">
          Anomalies detected when positions deviate &gt;1.5σ from prediction model
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
