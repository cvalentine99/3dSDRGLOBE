/*
 * SignalStrength.tsx — Real-time signal strength indicator
 * Design: Dark atmospheric "Ether" theme
 * Fetches live data from KiwiSDR /status and /snr endpoints.
 * For non-KiwiSDR receivers, performs a reachability check.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, Wifi, WifiOff, Users, Radio, Signal,
  RefreshCw, AlertTriangle, Antenna, Clock, History
} from "lucide-react";
import { logSignalData, getStationLogs } from "@/lib/sigintLogger";
import { checkAlerts, type AlertEvent } from "@/lib/alertService";
import { toast } from "sonner";

/* ── Types ────────────────────────────────────────── */

interface StatusData {
  status: "active" | "inactive" | "unknown";
  offline: boolean;
  name: string;
  users: number;
  usersMax: number;
  snrOverall: number; // 0-30 MHz composite SNR
  snrBands: SnrBand[];
  antenna: string;
  version: string;
  uptime: number; // seconds
  gpsGood: number;
  adcOverload: boolean;
  antConnected: boolean;
}

interface SnrBand {
  lo: number;   // kHz
  hi: number;   // kHz
  snr: number;  // dB
  min: number;
  max: number;
  p50: number;
  p95: number;
  label?: string;
}

interface Props {
  receiverUrl: string;
  receiverType: string; // "KiwiSDR" | "OpenWebRX" | "WebSDR"
  stationLabel?: string;
  onOpenLog?: () => void;
}

/* ── Helpers ──────────────────────────────────────── */

const BAND_LABELS: Record<string, string> = {
  "0-30000": "Full Spectrum",
  "1800-30000": "HF (1.8-30 MHz)",
  "0-1800": "LF/MF (0-1.8 MHz)",
  "1800-10000": "Lower HF",
  "10000-20000": "Mid HF",
  "20000-30000": "Upper HF",
  "136-138": "2200m",
  "472-479": "630m",
  "1800-2000": "160m",
  "3500-3900": "80m",
  "5250-5450": "60m",
  "7000-7300": "40m",
  "10100-10157": "30m",
  "14000-14350": "20m",
  "18068-18168": "17m",
  "21000-21450": "15m",
  "24890-24990": "12m",
  "28000-29700": "10m",
  "530-1602": "MW Broadcast",
};

function getBandLabel(lo: number, hi: number): string {
  const key = `${lo}-${hi}`;
  return BAND_LABELS[key] || `${(lo / 1000).toFixed(1)}-${(hi / 1000).toFixed(1)} MHz`;
}

function snrToLevel(snr: number): number {
  // Map SNR (0-40 dB) to 0-5 bars
  if (snr <= 0) return 0;
  if (snr <= 5) return 1;
  if (snr <= 10) return 2;
  if (snr <= 18) return 3;
  if (snr <= 28) return 4;
  return 5;
}

function snrToColor(snr: number): string {
  if (snr <= 3) return "#ef4444";   // red
  if (snr <= 8) return "#f97316";   // orange
  if (snr <= 15) return "#eab308";  // yellow
  if (snr <= 25) return "#22c55e";  // green
  return "#10b981";                  // emerald
}

function snrToLabel(snr: number): string {
  if (snr <= 3) return "Very Weak";
  if (snr <= 8) return "Weak";
  if (snr <= 15) return "Moderate";
  if (snr <= 25) return "Good";
  return "Excellent";
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function parseStatusText(text: string): Partial<StatusData> {
  const lines = text.split("\n");
  const kv: Record<string, string> = {};
  for (const line of lines) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      kv[line.substring(0, eq).trim()] = line.substring(eq + 1).trim();
    }
  }

  const snrParts = (kv.snr || "").split(",");
  const snrOverall = snrParts.length > 0 ? parseInt(snrParts[0], 10) : 0;

  return {
    status: kv.status === "active" ? "active" : "inactive",
    offline: kv.offline === "yes",
    name: kv.name || "",
    users: parseInt(kv.users || "0", 10),
    usersMax: parseInt(kv.users_max || "4", 10),
    snrOverall: isNaN(snrOverall) ? 0 : snrOverall,
    antenna: kv.antenna || "",
    version: kv.sw_version || "",
    uptime: parseInt(kv.uptime || "0", 10),
    gpsGood: parseInt(kv.gps_good || "0", 10),
    adcOverload: kv.adc_ov === "1",
    antConnected: kv.ant_connected === "1",
  };
}

/* ── Component ────────────────────────────────────── */

export default function SignalStrength({ receiverUrl, receiverType, stationLabel, onOpenLog }: Props) {
  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [snrBands, setSnrBands] = useState<SnrBand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [expanded, setExpanded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const baseUrl = receiverUrl.replace(/\/$/, "");
  const isKiwi = receiverType === "KiwiSDR";

  const fetchData = useCallback(async () => {
    try {
      setError(null);

      if (isKiwi) {
        // Fetch /status
        const statusRes = await fetch(`${baseUrl}/status`, {
          signal: AbortSignal.timeout(6000),
        });
        if (!statusRes.ok) throw new Error("Status unavailable");
        const statusText = await statusRes.text();
        const parsed = parseStatusText(statusText);

        // Fetch /snr
        let bands: SnrBand[] = [];
        try {
          const snrRes = await fetch(`${baseUrl}/snr`, {
            signal: AbortSignal.timeout(6000),
          });
          if (snrRes.ok) {
            const snrJson = await snrRes.json();
            if (Array.isArray(snrJson) && snrJson.length > 0) {
              const latest = snrJson[snrJson.length - 1];
              if (latest.snr && Array.isArray(latest.snr)) {
                bands = latest.snr.map((b: any) => ({
                  lo: b.lo,
                  hi: b.hi,
                  snr: b.snr || 0,
                  min: b.min || 0,
                  max: b.max || 0,
                  p50: b.p50 || 0,
                  p95: b.p95 || 0,
                  label: getBandLabel(b.lo, b.hi),
                }));
              }
            }
          }
        } catch {
          // SNR endpoint may not always be available
        }

        const fullStatus: StatusData = {
          status: parsed.status || "unknown",
          offline: parsed.offline || false,
          name: parsed.name || "",
          users: parsed.users || 0,
          usersMax: parsed.usersMax || 4,
          snrOverall: parsed.snrOverall || 0,
          snrBands: bands,
          antenna: parsed.antenna || "",
          version: parsed.version || "",
          uptime: parsed.uptime || 0,
          gpsGood: parsed.gpsGood || 0,
          adcOverload: parsed.adcOverload || false,
          antConnected: parsed.antConnected ?? true,
        };
        setStatusData(fullStatus);
        setSnrBands(bands);

        // Auto-log signal data
        if (stationLabel) {
          const bandSnr: Record<string, number> = {};
          bands.forEach((b) => {
            if (b.label) bandSnr[b.label] = b.snr;
          });
          logSignalData(stationLabel, receiverUrl, receiverType, {
            online: !fullStatus.offline && fullStatus.status === "active",
            snr: fullStatus.snrOverall,
            users: fullStatus.users,
            usersMax: fullStatus.usersMax,
            adcOverload: fullStatus.adcOverload,
            gps: fullStatus.gpsGood,
            uptime: fullStatus.uptime,
            bandSnr,
          });

          // Check alert thresholds and fire toast notifications
          const alerts = checkAlerts(stationLabel, receiverUrl, {
            online: !fullStatus.offline && fullStatus.status === "active",
            snr: fullStatus.snrOverall,
            adcOverload: fullStatus.adcOverload,
          });
          alerts.forEach((alert) => {
            if (alert.severity === "critical") {
              toast.error(alert.message, {
                description: `${new Date(alert.ts).toLocaleTimeString()} — ${alert.type.replace("_", " ").toUpperCase()}`,
                duration: 8000,
                style: {
                  background: "rgba(20, 10, 10, 0.95)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  color: "#fca5a5",
                  backdropFilter: "blur(12px)",
                },
              });
            } else {
              toast.warning(alert.message, {
                description: `${new Date(alert.ts).toLocaleTimeString()} — ${alert.type.replace("_", " ").toUpperCase()}`,
                duration: 6000,
                style: {
                  background: "rgba(20, 15, 5, 0.95)",
                  border: "1px solid rgba(245, 158, 11, 0.3)",
                  color: "#fcd34d",
                  backdropFilter: "blur(12px)",
                },
              });
            }
          });
        }
      } else {
        // For OpenWebRX / WebSDR: just check reachability
        try {
          const res = await fetch(baseUrl, {
            mode: "no-cors",
            signal: AbortSignal.timeout(6000),
          });
          setStatusData({
            status: "active",
            offline: false,
            name: "",
            users: -1,
            usersMax: -1,
            snrOverall: -1,
            snrBands: [],
            antenna: "",
            version: "",
            uptime: -1,
            gpsGood: -1,
            adcOverload: false,
            antConnected: true,
          });
        } catch {
          setStatusData({
            status: "unknown",
            offline: true,
            name: "",
            users: -1,
            usersMax: -1,
            snrOverall: -1,
            snrBands: [],
            antenna: "",
            version: "",
            uptime: -1,
            gpsGood: -1,
            adcOverload: false,
            antConnected: true,
          });
        }
        setSnrBands([]);
      }

      setLastFetch(new Date());
    } catch (e: any) {
      setError(e.message || "Connection failed");
      setStatusData(null);
      setSnrBands([]);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, isKiwi, stationLabel, receiverUrl, receiverType]);

  useEffect(() => {
    setLoading(true);
    setStatusData(null);
    setSnrBands([]);
    setError(null);
    setExpanded(false);
    fetchData();

    // Auto-refresh every 30 seconds
    intervalRef.current = setInterval(fetchData, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  /* ── Render ─────────────────────────────────────── */

  return (
    <div className="mt-3 rounded-lg border border-white/8 bg-white/[0.03] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/5 transition-colors"
      >
        <Activity className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-white/60 flex-1 text-left">
          Signal Intelligence
        </span>

        {loading ? (
          <RefreshCw className="w-3 h-3 text-white/30 animate-spin" />
        ) : error ? (
          <span className="flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-amber-400/70" />
            <span className="text-[9px] font-mono text-amber-400/70">Unreachable</span>
          </span>
        ) : statusData ? (
          <span className="flex items-center gap-2">
            {/* Online indicator */}
            {!statusData.offline && statusData.status === "active" ? (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[9px] font-mono text-green-400">ONLINE</span>
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400/60" />
                <span className="text-[9px] font-mono text-red-400/70">OFFLINE</span>
              </span>
            )}

            {/* SNR badge for KiwiSDR */}
            {isKiwi && statusData.snrOverall > 0 && (
              <span
                className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
                style={{
                  color: snrToColor(statusData.snrOverall),
                  backgroundColor: snrToColor(statusData.snrOverall) + "20",
                }}
              >
                {statusData.snrOverall} dB
              </span>
            )}
          </span>
        ) : null}

        <ChevronIcon expanded={expanded} />
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
            <div className="px-3 pb-3 space-y-3 border-t border-white/5 pt-2.5">
              {loading && (
                <div className="flex items-center justify-center py-4">
                  <RefreshCw className="w-4 h-4 text-white/20 animate-spin" />
                  <span className="text-[10px] text-white/30 ml-2">Probing receiver...</span>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 py-3 px-2 rounded bg-red-500/10 border border-red-500/20">
                  <WifiOff className="w-4 h-4 text-red-400/70 shrink-0" />
                  <div>
                    <p className="text-[10px] text-red-400/80 font-medium">Connection Failed</p>
                    <p className="text-[9px] text-red-400/50 mt-0.5">{error}</p>
                    <p className="text-[9px] text-white/30 mt-1">
                      Receiver may be offline, behind a firewall, or blocking cross-origin requests.
                    </p>
                  </div>
                </div>
              )}

              {!loading && !error && statusData && (
                <>
                  {/* ── Signal Meter ── */}
                  {isKiwi && statusData.snrOverall > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[9px] font-mono text-white/40 uppercase tracking-wider">
                          Overall SNR
                        </span>
                        <span
                          className="text-[10px] font-mono font-bold"
                          style={{ color: snrToColor(statusData.snrOverall) }}
                        >
                          {snrToLabel(statusData.snrOverall)}
                        </span>
                      </div>

                      {/* Animated bar meter */}
                      <div className="flex items-end gap-[3px] h-8">
                        {Array.from({ length: 10 }).map((_, i) => {
                          const threshold = (i + 1) * 3; // 3dB per bar
                          const active = statusData.snrOverall >= threshold;
                          const color = snrToColor(threshold);
                          return (
                            <motion.div
                              key={i}
                              className="flex-1 rounded-sm"
                              initial={{ height: 4 }}
                              animate={{
                                height: 4 + (i + 1) * 2.4,
                                backgroundColor: active ? color : "rgba(255,255,255,0.06)",
                              }}
                              transition={{ delay: i * 0.04, duration: 0.3 }}
                            />
                          );
                        })}
                      </div>

                      <div className="flex justify-between mt-1">
                        <span className="text-[8px] font-mono text-white/20">0 dB</span>
                        <span
                          className="text-[10px] font-mono font-bold"
                          style={{ color: snrToColor(statusData.snrOverall) }}
                        >
                          {statusData.snrOverall} dB SNR
                        </span>
                        <span className="text-[8px] font-mono text-white/20">30+ dB</span>
                      </div>
                    </div>
                  )}

                  {/* ── Status Grid ── */}
                  <div className="grid grid-cols-2 gap-2">
                    {/* Users */}
                    {isKiwi && statusData.users >= 0 && (
                      <StatusCard
                        icon={Users}
                        label="Active Users"
                        value={`${statusData.users} / ${statusData.usersMax}`}
                        color={statusData.users >= statusData.usersMax ? "#ef4444" : "#22c55e"}
                      />
                    )}

                    {/* Antenna */}
                    {isKiwi && statusData.antenna && (
                      <StatusCard
                        icon={Antenna}
                        label="Antenna"
                        value={statusData.antenna.length > 30
                          ? statusData.antenna.substring(0, 30) + "..."
                          : statusData.antenna}
                        color={statusData.antConnected ? "#22c55e" : "#ef4444"}
                      />
                    )}

                    {/* Uptime */}
                    {isKiwi && statusData.uptime > 0 && (
                      <StatusCard
                        icon={Clock}
                        label="Uptime"
                        value={formatUptime(statusData.uptime)}
                        color="#06b6d4"
                      />
                    )}

                    {/* Version */}
                    {isKiwi && statusData.version && (
                      <StatusCard
                        icon={Radio}
                        label="Firmware"
                        value={statusData.version.replace("KiwiSDR_", "")}
                        color="#a855f7"
                      />
                    )}

                    {/* GPS */}
                    {isKiwi && statusData.gpsGood >= 0 && (
                      <StatusCard
                        icon={Signal}
                        label="GPS Sats"
                        value={`${statusData.gpsGood} locked`}
                        color={statusData.gpsGood > 5 ? "#22c55e" : "#f59e0b"}
                      />
                    )}

                    {/* ADC Overload */}
                    {isKiwi && statusData.adcOverload && (
                      <StatusCard
                        icon={AlertTriangle}
                        label="ADC"
                        value="Overload!"
                        color="#ef4444"
                      />
                    )}
                  </div>

                  {/* ── SNR by Band ── */}
                  {snrBands.length > 0 && (
                    <div>
                      <p className="text-[9px] font-mono text-white/40 uppercase tracking-wider mb-2">
                        SNR by Band
                      </p>
                      <div className="space-y-1.5">
                        {snrBands
                          .filter((b) => {
                            // Show only the interesting bands, skip the wide composites
                            const key = `${b.lo}-${b.hi}`;
                            return key !== "0-30000" && key !== "1800-30000" && key !== "0-1800"
                              && key !== "1800-10000" && key !== "10000-20000" && key !== "20000-30000";
                          })
                          .map((band, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-[9px] font-mono text-white/40 w-24 shrink-0 truncate">
                                {band.label}
                              </span>
                              <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                                <motion.div
                                  className="h-full rounded-full"
                                  initial={{ width: 0 }}
                                  animate={{
                                    width: `${Math.min(100, (band.snr / 35) * 100)}%`,
                                    backgroundColor: snrToColor(band.snr),
                                  }}
                                  transition={{ delay: i * 0.03, duration: 0.4 }}
                                />
                              </div>
                              <span
                                className="text-[9px] font-mono font-bold w-8 text-right shrink-0"
                                style={{ color: snrToColor(band.snr) }}
                              >
                                {band.snr}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Non-KiwiSDR notice */}
                  {!isKiwi && (
                    <div className="flex items-start gap-2 py-2 px-2 rounded bg-white/5 border border-white/5">
                      <Wifi className="w-3.5 h-3.5 text-cyan-400/50 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[10px] text-white/60">
                          {receiverType} receivers don't expose a public status API.
                        </p>
                        <p className="text-[9px] text-white/30 mt-0.5">
                          Detailed SNR data is available for KiwiSDR receivers only.
                          Open the receiver to check live signal conditions.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Last updated + View Log */}
                  {lastFetch && (
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[8px] font-mono text-white/20">
                        Updated {lastFetch.toLocaleTimeString()}
                        {stationLabel && (() => {
                          const logs = getStationLogs(stationLabel, receiverUrl);
                          return logs.length > 0 ? ` · ${logs.length} logged` : "";
                        })()}
                      </span>
                      <div className="flex items-center gap-2">
                        {onOpenLog && stationLabel && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenLog();
                            }}
                            className="flex items-center gap-1 text-[8px] font-mono text-purple-400/50 hover:text-purple-400/80 transition-colors"
                          >
                            <History className="w-2.5 h-2.5" />
                            View Log
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setLoading(true);
                            fetchData();
                          }}
                          className="flex items-center gap-1 text-[8px] font-mono text-cyan-400/50 hover:text-cyan-400/80 transition-colors"
                        >
                          <RefreshCw className="w-2.5 h-2.5" />
                          Refresh
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Sub-components ───────────────────────────────── */

function StatusCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-start gap-2 p-2 rounded bg-white/[0.03] border border-white/5">
      <Icon className="w-3 h-3 shrink-0 mt-0.5" style={{ color: color + "80" }} />
      <div className="min-w-0">
        <p className="text-[8px] font-mono text-white/30 uppercase tracking-wider">{label}</p>
        <p className="text-[10px] font-mono text-white/70 truncate" title={value}>
          {value}
        </p>
      </div>
    </div>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <motion.svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className="text-white/30 shrink-0"
      animate={{ rotate: expanded ? 180 : 0 }}
      transition={{ duration: 0.2 }}
    >
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </motion.svg>
  );
}
