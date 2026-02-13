/**
 * SigintLogViewer.tsx — Signal Intelligence Log Viewer
 * Design: "Ether" dark atmospheric theme
 * 
 * Shows a timeline chart of SNR/users over time, summary stats,
 * a data table of log entries, and export/clear controls.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Download, Trash2, BarChart3, Table, Clock,
  TrendingUp, TrendingDown, Users, Wifi, WifiOff,
  ChevronDown, ChevronRight, FileJson, FileSpreadsheet,
  Activity, AlertTriangle
} from "lucide-react";
import {
  getStationLogs,
  getLogSummary,
  exportStationLogAsCsv,
  exportLogsAsJson,
  clearStationLogs,
  getAllMonitoredStations,
  removeStationFromLog,
  type SigintLogEntry,
  type StationLog,
} from "@/lib/sigintLogger";

/* ── Types ────────────────────────────────────────── */

interface Props {
  /** If provided, show logs for this specific station */
  stationLabel?: string;
  receiverUrl?: string;
  receiverType?: string;
  /** Close callback */
  onClose: () => void;
}

type ViewMode = "chart" | "table" | "all-stations";

/* ── Helpers ──────────────────────────────────────── */

function snrColor(snr: number): string {
  if (snr <= 3) return "#ef4444";
  if (snr <= 8) return "#f97316";
  if (snr <= 15) return "#eab308";
  if (snr <= 25) return "#22c55e";
  return "#10b981";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round(hours / 24 * 10) / 10}d`;
}

/* ── Component ────────────────────────────────────── */

export default function SigintLogViewer({ stationLabel, receiverUrl, receiverType, onClose }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>(stationLabel ? "chart" : "all-stations");
  const [selectedBand, setSelectedBand] = useState<string>("overall");

  // Get entries for the specific station
  const entries = useMemo(() => {
    if (!stationLabel || !receiverUrl) return [];
    return getStationLogs(stationLabel, receiverUrl);
  }, [stationLabel, receiverUrl]);

  const summary = useMemo(() => {
    if (!stationLabel || !receiverUrl) return null;
    return getLogSummary(stationLabel, receiverUrl);
  }, [stationLabel, receiverUrl]);

  // Collect all band keys from entries
  const bandKeys = useMemo(() => {
    const keys = new Set<string>();
    entries.forEach((e) => {
      Object.keys(e.bandSnr).forEach((k) => keys.add(k));
    });
    return Array.from(keys).sort();
  }, [entries]);

  // All monitored stations
  const allStations = useMemo(() => getAllMonitoredStations(), [viewMode]);

  const handleExportCsv = () => {
    if (!stationLabel || !receiverUrl) return;
    const csv = exportStationLogAsCsv(stationLabel, receiverUrl);
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sigint-${stationLabel.replace(/[^a-zA-Z0-9]/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    const json = exportLogsAsJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sigint-all-logs.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    if (!stationLabel || !receiverUrl) return;
    clearStationLogs(stationLabel, receiverUrl);
    // Force re-render
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 20 }}
      transition={{ type: "spring", damping: 25, stiffness: 250 }}
      className="absolute inset-4 z-50 glass-panel rounded-2xl overflow-hidden flex flex-col"
      style={{ maxWidth: "900px", maxHeight: "700px", margin: "auto" }}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center">
            <Activity className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white/90">
              {stationLabel ? "Signal Log" : "All Signal Logs"}
            </h2>
            {stationLabel && (
              <p className="text-[10px] font-mono text-white/40 mt-0.5 truncate max-w-[300px]">
                {stationLabel}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View mode tabs */}
          {stationLabel && entries.length > 0 && (
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode("chart")}
                className={`px-2.5 py-1 rounded-md text-[10px] font-mono transition-colors ${
                  viewMode === "chart" ? "bg-white/10 text-white/90" : "text-white/40 hover:text-white/60"
                }`}
              >
                <BarChart3 className="w-3 h-3 inline mr-1" />Chart
              </button>
              <button
                onClick={() => setViewMode("table")}
                className={`px-2.5 py-1 rounded-md text-[10px] font-mono transition-colors ${
                  viewMode === "table" ? "bg-white/10 text-white/90" : "text-white/40 hover:text-white/60"
                }`}
              >
                <Table className="w-3 h-3 inline mr-1" />Table
              </button>
              <button
                onClick={() => setViewMode("all-stations")}
                className={`px-2.5 py-1 rounded-md text-[10px] font-mono transition-colors ${
                  viewMode === "all-stations" ? "bg-white/10 text-white/90" : "text-white/40 hover:text-white/60"
                }`}
              >
                <Wifi className="w-3 h-3 inline mr-1" />All
              </button>
            </div>
          )}

          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-white/40 hover:text-white/70">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Summary Stats */}
        {stationLabel && summary && (
          <div className="px-5 py-3 border-b border-white/5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Entries" value={summary.totalEntries.toString()} icon={BarChart3} color="#06b6d4" />
              <StatCard label="Avg SNR" value={summary.avgSnr > 0 ? `${summary.avgSnr} dB` : "N/A"} icon={TrendingUp} color={snrColor(summary.avgSnr)} />
              <StatCard label="Uptime" value={`${summary.uptimePercent}%`} icon={Wifi} color={summary.uptimePercent > 80 ? "#22c55e" : "#f97316"} />
              <StatCard label="Time Span" value={formatDuration(summary.timeSpanHours)} icon={Clock} color="#a855f7" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
              <StatCard label="Max SNR" value={summary.maxSnr > 0 ? `${summary.maxSnr} dB` : "N/A"} icon={TrendingUp} color="#10b981" />
              <StatCard label="Min SNR" value={summary.minSnr > 0 ? `${summary.minSnr} dB` : "N/A"} icon={TrendingDown} color="#ef4444" />
              <StatCard label="Avg Users" value={summary.avgUsers >= 0 ? summary.avgUsers.toString() : "N/A"} icon={Users} color="#8b5cf6" />
              <StatCard label="Type" value={receiverType || "Unknown"} icon={Activity} color="#06b6d4" />
            </div>
          </div>
        )}

        {/* Chart View */}
        {viewMode === "chart" && stationLabel && entries.length > 0 && (
          <div className="px-5 py-4">
            {/* Band selector */}
            {bandKeys.length > 0 && (
              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                <span className="text-[9px] font-mono text-white/30 uppercase mr-1">Band:</span>
                <button
                  onClick={() => setSelectedBand("overall")}
                  className={`text-[9px] font-mono px-2 py-0.5 rounded transition-colors ${
                    selectedBand === "overall"
                      ? "bg-cyan-400/20 text-cyan-400 border border-cyan-400/30"
                      : "text-white/40 hover:text-white/60 border border-white/10"
                  }`}
                >
                  Overall
                </button>
                {bandKeys.map((bk) => (
                  <button
                    key={bk}
                    onClick={() => setSelectedBand(bk)}
                    className={`text-[9px] font-mono px-2 py-0.5 rounded transition-colors ${
                      selectedBand === bk
                        ? "bg-cyan-400/20 text-cyan-400 border border-cyan-400/30"
                        : "text-white/40 hover:text-white/60 border border-white/10"
                    }`}
                  >
                    {bk}
                  </button>
                ))}
              </div>
            )}

            {/* SVG Chart */}
            <SnrChart entries={entries} selectedBand={selectedBand} />

            {/* Users chart */}
            {entries.some((e) => e.users >= 0) && (
              <div className="mt-4">
                <p className="text-[9px] font-mono text-white/30 uppercase mb-2">Active Users Over Time</p>
                <UsersChart entries={entries} />
              </div>
            )}
          </div>
        )}

        {/* Table View */}
        {viewMode === "table" && stationLabel && entries.length > 0 && (
          <div className="px-5 py-4">
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-2 px-2 text-white/40 font-medium">Time</th>
                    <th className="text-center py-2 px-2 text-white/40 font-medium">Status</th>
                    <th className="text-right py-2 px-2 text-white/40 font-medium">SNR</th>
                    <th className="text-right py-2 px-2 text-white/40 font-medium">Users</th>
                    <th className="text-right py-2 px-2 text-white/40 font-medium">GPS</th>
                    <th className="text-center py-2 px-2 text-white/40 font-medium">ADC</th>
                  </tr>
                </thead>
                <tbody>
                  {[...entries].reverse().map((entry, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                      <td className="py-1.5 px-2 text-white/50">{formatDateTime(entry.ts)}</td>
                      <td className="py-1.5 px-2 text-center">
                        {entry.online ? (
                          <span className="inline-flex items-center gap-1 text-green-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />ON
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-400/70">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400/60" />OFF
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        {entry.snr >= 0 ? (
                          <span style={{ color: snrColor(entry.snr) }}>{entry.snr} dB</span>
                        ) : (
                          <span className="text-white/20">—</span>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-right text-white/50">
                        {entry.users >= 0 ? `${entry.users}/${entry.usersMax}` : "—"}
                      </td>
                      <td className="py-1.5 px-2 text-right text-white/50">
                        {entry.gps >= 0 ? entry.gps : "—"}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        {entry.adcOverload ? (
                          <AlertTriangle className="w-3 h-3 text-red-400 inline" />
                        ) : (
                          <span className="text-white/15">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* All Stations View */}
        {viewMode === "all-stations" && (
          <div className="px-5 py-4">
            {allStations.length === 0 ? (
              <div className="text-center py-12">
                <Activity className="w-8 h-8 text-white/10 mx-auto mb-3" />
                <p className="text-sm text-white/30">No stations logged yet</p>
                <p className="text-[10px] text-white/15 mt-1">
                  Select a station and its signal data will be automatically logged.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[10px] font-mono text-white/30 uppercase mb-3">
                  {allStations.length} monitored station{allStations.length !== 1 ? "s" : ""}
                </p>
                {allStations.map((station) => (
                  <AllStationRow
                    key={`${station.stationLabel}|||${station.receiverUrl}`}
                    station={station}
                    onRemove={() => {
                      removeStationFromLog(station.stationLabel, station.receiverUrl);
                      // Force re-render by toggling view
                      setViewMode("table");
                      setTimeout(() => setViewMode("all-stations"), 0);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state for specific station */}
        {stationLabel && entries.length === 0 && viewMode !== "all-stations" && (
          <div className="text-center py-12 px-5">
            <Activity className="w-8 h-8 text-white/10 mx-auto mb-3" />
            <p className="text-sm text-white/30">No log entries yet</p>
            <p className="text-[10px] text-white/15 mt-1">
              Signal data is recorded automatically every 30 seconds while the station is selected.
            </p>
          </div>
        )}
      </div>

      {/* Footer with actions */}
      <div className="px-5 py-3 border-t border-white/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {stationLabel && entries.length > 0 && (
            <>
              <button
                onClick={handleExportCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/8 border border-white/10 text-[10px] font-mono text-white/60 hover:text-white/80 transition-colors"
              >
                <FileSpreadsheet className="w-3 h-3" />CSV
              </button>
              <button
                onClick={handleExportJson}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/8 border border-white/10 text-[10px] font-mono text-white/60 hover:text-white/80 transition-colors"
              >
                <FileJson className="w-3 h-3" />JSON
              </button>
            </>
          )}
          {!stationLabel && allStations.length > 0 && (
            <button
              onClick={handleExportJson}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/8 border border-white/10 text-[10px] font-mono text-white/60 hover:text-white/80 transition-colors"
            >
              <Download className="w-3 h-3" />Export All
            </button>
          )}
        </div>

        {stationLabel && entries.length > 0 && (
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-[10px] font-mono text-red-400/70 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3 h-3" />Clear Log
          </button>
        )}
      </div>
    </motion.div>
  );
}

/* ── Sub-components ───────────────────────────────── */

function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: string; icon: typeof Activity; color: string;
}) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.03] border border-white/5">
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: color + "80" }} />
      <div className="min-w-0">
        <p className="text-[8px] font-mono text-white/30 uppercase">{label}</p>
        <p className="text-[11px] font-mono font-bold text-white/80">{value}</p>
      </div>
    </div>
  );
}

function AllStationRow({ station, onRemove }: { station: StationLog; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const summary = getLogSummary(station.stationLabel, station.receiverUrl);

  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-white/3 transition-colors"
      >
        <div className={`w-2 h-2 rounded-full shrink-0 ${
          station.receiverType === "KiwiSDR" ? "bg-green-400" :
          station.receiverType === "OpenWebRX" ? "bg-cyan-400" : "bg-primary"
        }`} />
        <div className="flex-1 min-w-0 text-left">
          <p className="text-[11px] text-white/80 truncate">{station.stationLabel}</p>
          <p className="text-[9px] font-mono text-white/30">
            {station.entries.length} entries · Last: {formatDateTime(station.lastSeen)}
          </p>
        </div>
        {summary && summary.avgSnr > 0 && (
          <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0"
            style={{ color: snrColor(summary.avgSnr), backgroundColor: snrColor(summary.avgSnr) + "15" }}
          >
            Avg {summary.avgSnr} dB
          </span>
        )}
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-white/20 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-white/20 shrink-0" />
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 border-t border-white/5 pt-2">
              {summary && (
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div className="text-center">
                    <p className="text-[8px] font-mono text-white/25 uppercase">Uptime</p>
                    <p className="text-[10px] font-mono text-white/60">{summary.uptimePercent}%</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[8px] font-mono text-white/25 uppercase">SNR Range</p>
                    <p className="text-[10px] font-mono text-white/60">{summary.minSnr}–{summary.maxSnr} dB</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[8px] font-mono text-white/25 uppercase">Span</p>
                    <p className="text-[10px] font-mono text-white/60">{formatDuration(summary.timeSpanHours)}</p>
                  </div>
                </div>
              )}

              {/* Mini sparkline */}
              {station.entries.length > 1 && (
                <MiniSparkline entries={station.entries} />
              )}

              <div className="flex justify-end mt-2">
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(); }}
                  className="text-[9px] font-mono text-red-400/50 hover:text-red-400 transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Charts ───────────────────────────────────────── */

function SnrChart({ entries, selectedBand }: { entries: SigintLogEntry[]; selectedBand: string }) {
  const chartW = 800;
  const chartH = 180;
  const padL = 40;
  const padR = 10;
  const padT = 10;
  const padB = 30;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const dataPoints = useMemo(() => {
    return entries.map((e) => {
      const val = selectedBand === "overall"
        ? e.snr
        : (e.bandSnr[selectedBand] ?? -1);
      return { ts: new Date(e.ts).getTime(), val };
    }).filter((d) => d.val >= 0);
  }, [entries, selectedBand]);

  if (dataPoints.length < 2) {
    return (
      <div className="text-center py-6">
        <p className="text-[10px] text-white/20">Not enough data points for chart (need 2+)</p>
      </div>
    );
  }

  const minTs = dataPoints[0].ts;
  const maxTs = dataPoints[dataPoints.length - 1].ts;
  const tsRange = maxTs - minTs || 1;

  const maxVal = Math.max(...dataPoints.map((d) => d.val), 5);
  const minVal = Math.min(...dataPoints.map((d) => d.val), 0);
  const valRange = maxVal - minVal || 1;

  const toX = (ts: number) => padL + ((ts - minTs) / tsRange) * innerW;
  const toY = (val: number) => padT + innerH - ((val - minVal) / valRange) * innerH;

  const pathD = dataPoints
    .map((d, i) => `${i === 0 ? "M" : "L"} ${toX(d.ts)} ${toY(d.val)}`)
    .join(" ");

  const areaD = pathD + ` L ${toX(dataPoints[dataPoints.length - 1].ts)} ${padT + innerH} L ${toX(dataPoints[0].ts)} ${padT + innerH} Z`;

  // Y-axis labels
  const ySteps = 5;
  const yLabels = Array.from({ length: ySteps + 1 }).map((_, i) => {
    const val = minVal + (valRange / ySteps) * i;
    return { val: Math.round(val), y: toY(val) };
  });

  // X-axis labels (4-6 time labels)
  const xSteps = Math.min(6, dataPoints.length);
  const xLabels = Array.from({ length: xSteps }).map((_, i) => {
    const ts = minTs + (tsRange / (xSteps - 1)) * i;
    return { label: formatTime(new Date(ts).toISOString()), x: toX(ts) };
  });

  return (
    <div>
      <p className="text-[9px] font-mono text-white/30 uppercase mb-2">
        SNR Over Time — {selectedBand === "overall" ? "Full Spectrum" : selectedBand}
      </p>
      <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {yLabels.map((yl, i) => (
          <g key={i}>
            <line x1={padL} y1={yl.y} x2={chartW - padR} y2={yl.y} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
            <text x={padL - 5} y={yl.y + 3} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize="9" fontFamily="monospace">
              {yl.val}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {xLabels.map((xl, i) => (
          <text key={i} x={xl.x} y={chartH - 5} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="9" fontFamily="monospace">
            {xl.label}
          </text>
        ))}

        {/* Gradient fill */}
        <defs>
          <linearGradient id="snrGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#snrGrad)" />

        {/* Line */}
        <path d={pathD} fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Data points */}
        {dataPoints.map((d, i) => (
          <circle
            key={i}
            cx={toX(d.ts)}
            cy={toY(d.val)}
            r="3"
            fill={snrColor(d.val)}
            stroke="rgba(0,0,0,0.5)"
            strokeWidth="1"
          >
            <title>{`${formatTime(new Date(d.ts).toISOString())}: ${d.val} dB`}</title>
          </circle>
        ))}

        {/* Y-axis label */}
        <text x="5" y={padT + innerH / 2} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="9" fontFamily="monospace"
          transform={`rotate(-90, 10, ${padT + innerH / 2})`}
        >
          SNR (dB)
        </text>
      </svg>
    </div>
  );
}

function UsersChart({ entries }: { entries: SigintLogEntry[] }) {
  const chartW = 800;
  const chartH = 100;
  const padL = 40;
  const padR = 10;
  const padT = 10;
  const padB = 25;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const dataPoints = entries
    .filter((e) => e.users >= 0)
    .map((e) => ({ ts: new Date(e.ts).getTime(), val: e.users, max: e.usersMax }));

  if (dataPoints.length < 2) return null;

  const minTs = dataPoints[0].ts;
  const maxTs = dataPoints[dataPoints.length - 1].ts;
  const tsRange = maxTs - minTs || 1;
  const maxVal = Math.max(...dataPoints.map((d) => d.max), 1);

  const toX = (ts: number) => padL + ((ts - minTs) / tsRange) * innerW;
  const toY = (val: number) => padT + innerH - (val / maxVal) * innerH;

  return (
    <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      {/* Max line */}
      {dataPoints.length > 0 && (
        <line
          x1={padL} y1={toY(dataPoints[0].max)}
          x2={chartW - padR} y2={toY(dataPoints[0].max)}
          stroke="rgba(239,68,68,0.2)" strokeWidth="1" strokeDasharray="4,4"
        />
      )}

      {/* Bars */}
      {dataPoints.map((d, i) => {
        const barW = Math.max(2, innerW / dataPoints.length - 1);
        return (
          <rect
            key={i}
            x={toX(d.ts) - barW / 2}
            y={toY(d.val)}
            width={barW}
            height={Math.max(0, padT + innerH - toY(d.val))}
            fill={d.val >= d.max ? "#ef4444" : "#8b5cf6"}
            opacity={0.6}
            rx="1"
          >
            <title>{`${formatTime(new Date(d.ts).toISOString())}: ${d.val}/${d.max} users`}</title>
          </rect>
        );
      })}

      {/* Y labels */}
      <text x={padL - 5} y={padT + 4} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize="9" fontFamily="monospace">
        {maxVal}
      </text>
      <text x={padL - 5} y={padT + innerH + 4} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize="9" fontFamily="monospace">
        0
      </text>
    </svg>
  );
}

function MiniSparkline({ entries }: { entries: SigintLogEntry[] }) {
  const snrEntries = entries.filter((e) => e.snr >= 0);
  if (snrEntries.length < 2) return null;

  const w = 200;
  const h = 30;
  const maxSnr = Math.max(...snrEntries.map((e) => e.snr), 5);

  const points = snrEntries.map((e, i) => {
    const x = (i / (snrEntries.length - 1)) * w;
    const y = h - (e.snr / maxSnr) * h;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-6" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke="#06b6d4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
