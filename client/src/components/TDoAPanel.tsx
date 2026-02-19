/**
 * TDoAPanel.tsx — TDoA Triangulation Control Panel
 *
 * Allows users to:
 * 1. Browse/select GPS-active KiwiSDR hosts for TDoA
 * 2. Set frequency, passband, and sample time
 * 3. Optionally set a known reference location
 * 4. Submit TDoA jobs and monitor progress
 * 5. View results with likely position
 */
import { useState, useCallback, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Crosshair,
  Radio,
  Play,
  Square,
  RotateCcw,
  MapPin,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  ChevronDown,
  ChevronUp,
  Search,
  Signal,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/* ── Types ────────────────────────────────────────── */

interface GpsHost {
  i: number;
  id: string;
  h: string;
  p: number;
  lat: number;
  lon: number;
  lo: number;
  fm: number;
  u: number;
  um: number;
  tc: number;
  snr: number;
  v: string;
  a: string;
  n: string;
}

interface RefTransmitter {
  r: string;
  id: string;
  t: string;
  f: number;
  p: number;
  z: number;
  lat: number;
  lon: number;
}

type JobStatus = "idle" | "pending" | "sampling" | "computing" | "complete" | "error";

interface HostStatus {
  host: string;
  status: "sampling" | "ok" | "failed" | "busy" | "no_gps";
}

interface TdoaResult {
  likelyLat: number;
  likelyLon: number;
  jobId: string;
}

/* ── Props ────────────────────────────────────────── */

interface TDoAPanelProps {
  isOpen: boolean;
  onClose: () => void;
  selectedHosts: GpsHost[];
  onToggleHost: (host: GpsHost) => void;
  onClearHosts: () => void;
  onResult?: (result: TdoaResult) => void;
  onJobStatusChange?: (status: JobStatus) => void;
}

const REF_CATEGORIES: Record<string, string> = {
  v: "VLF/LF",
  m: "Military",
  r: "Radar",
  a: "Aero",
  M: "Marine",
  b: "Broadcast",
  u: "Utility",
  t: "Time/Freq",
};

const SAMPLE_TIMES = [15, 30, 45, 60] as const;

/* ── Component ────────────────────────────────────── */

export default function TDoAPanel({
  isOpen,
  onClose,
  selectedHosts,
  onToggleHost,
  onClearHosts,
  onResult,
  onJobStatusChange,
}: TDoAPanelProps) {
  // Form state
  const [frequencyKhz, setFrequencyKhz] = useState<string>("10000");
  const [passbandHz, setPassbandHz] = useState<string>("1000");
  const [sampleTime, setSampleTime] = useState<number>(30);
  const [knownLat, setKnownLat] = useState<string>("");
  const [knownLon, setKnownLon] = useState<string>("");
  const [knownName, setKnownName] = useState<string>("");

  // Host browser state
  const [hostSearch, setHostSearch] = useState("");
  const [hostListOpen, setHostListOpen] = useState(true);
  const [refSearch, setRefSearch] = useState("");
  const [refsOpen, setRefsOpen] = useState(false);

  // Job state
  const [jobStatus, setJobStatus] = useState<JobStatus>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [hostStatuses, setHostStatuses] = useState<HostStatus[]>([]);
  const [result, setResult] = useState<TdoaResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  // Fetch GPS hosts
  const gpsHostsQuery = trpc.tdoa.getGpsHosts.useQuery(undefined, {
    enabled: isOpen,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch reference transmitters
  const refsQuery = trpc.tdoa.getRefs.useQuery(undefined, {
    enabled: isOpen && refsOpen,
    staleTime: 30 * 60 * 1000,
  });

  // Submit mutation
  const submitMutation = trpc.tdoa.submitJob.useMutation({
    onSuccess: (data) => {
      setJobId(data.jobId);
      setJobStatus("sampling");
      onJobStatusChange?.("sampling");
      toast.success("TDoA job submitted — sampling in progress");
    },
    onError: (err) => {
      setJobStatus("error");
      setErrorMessage(err.message);
      onJobStatusChange?.("error");
      toast.error(`TDoA submit failed: ${err.message}`);
    },
  });

  // Poll progress
  const progressQuery = trpc.tdoa.pollProgress.useQuery(
    { jobId: jobId! },
    {
      enabled: !!jobId && (jobStatus === "sampling" || jobStatus === "computing"),
      refetchInterval: 2000,
    }
  );

  // Update state from progress polling
  useEffect(() => {
    if (!progressQuery.data) return;
    const job = progressQuery.data;

    if (job.status === "computing" && jobStatus === "sampling") {
      setJobStatus("computing");
      onJobStatusChange?.("computing");
    }

    if (job.status === "complete") {
      setJobStatus("complete");
      onJobStatusChange?.("complete");
      if (job.result?.likely_position) {
        const res: TdoaResult = {
          likelyLat: job.result.likely_position.lat,
          likelyLon: job.result.likely_position.lng,
          jobId: job.id,
        };
        setResult(res);
        onResult?.(res);
        toast.success(
          `TDoA complete — position: ${job.result.likely_position.lat.toFixed(3)}°, ${job.result.likely_position.lng.toFixed(3)}°`
        );
      }
    }

    if (job.status === "error") {
      setJobStatus("error");
      setErrorMessage(job.error || "Unknown error");
      onJobStatusChange?.("error");
      toast.error(`TDoA failed: ${job.error}`);
    }

    // Update host statuses
    if (job.hostStatuses) {
      setHostStatuses(
        Object.entries(job.hostStatuses).map(([host, status]) => ({
          host,
          status: status as HostStatus["status"],
        }))
      );
    }

    setPollCount((c) => c + 1);
  }, [progressQuery.data]);

  // Cancel mutation
  const cancelMutation = trpc.tdoa.cancelJob.useMutation({
    onSuccess: () => {
      setJobStatus("idle");
      setJobId(null);
      onJobStatusChange?.("idle");
      toast.info("TDoA job cancelled");
    },
  });

  // Filter hosts by search
  const filteredHosts = useMemo(() => {
    if (!gpsHostsQuery.data) return [];
    const q = hostSearch.toLowerCase();
    if (!q) return gpsHostsQuery.data;
    return gpsHostsQuery.data.filter(
      (h) =>
        h.n.toLowerCase().includes(q) ||
        h.h.toLowerCase().includes(q) ||
        h.id.toLowerCase().includes(q) ||
        h.a.toLowerCase().includes(q)
    );
  }, [gpsHostsQuery.data, hostSearch]);

  // Filter refs by search
  const filteredRefs = useMemo(() => {
    if (!refsQuery.data) return [];
    const q = refSearch.toLowerCase();
    if (!q) return refsQuery.data.slice(0, 100);
    return refsQuery.data.filter(
      (r) => r.id.toLowerCase().includes(q) || String(r.f).includes(q)
    );
  }, [refsQuery.data, refSearch]);

  // Check if a host is selected
  const isHostSelected = useCallback(
    (host: GpsHost) => selectedHosts.some((h) => h.h === host.h && h.p === host.p),
    [selectedHosts]
  );

  // Submit TDoA job
  const handleSubmit = useCallback(() => {
    if (selectedHosts.length < 2) {
      toast.error("Select at least 2 GPS-active KiwiSDR receivers");
      return;
    }
    if (selectedHosts.length > 6) {
      toast.error("Maximum 6 receivers allowed");
      return;
    }

    const freq = parseFloat(frequencyKhz);
    if (isNaN(freq) || freq <= 0) {
      toast.error("Enter a valid frequency in kHz");
      return;
    }

    const pb = parseInt(passbandHz);
    if (isNaN(pb) || pb <= 0) {
      toast.error("Enter a valid passband in Hz");
      return;
    }

    // Compute map bounds from selected hosts with padding
    const lats = selectedHosts.map((h) => h.lat);
    const lons = selectedHosts.map((h) => h.lon);
    const latPad = Math.max(5, (Math.max(...lats) - Math.min(...lats)) * 0.3);
    const lonPad = Math.max(5, (Math.max(...lons) - Math.min(...lons)) * 0.3);

    const mapBounds = {
      north: Math.min(90, Math.max(...lats) + latPad),
      south: Math.max(-90, Math.min(...lats) - latPad),
      east: Math.min(180, Math.max(...lons) + lonPad),
      west: Math.max(-180, Math.min(...lons) - lonPad),
    };

    const knownLocation =
      knownLat && knownLon
        ? {
            lat: parseFloat(knownLat),
            lon: parseFloat(knownLon),
            name: knownName || "Reference",
          }
        : undefined;

    setJobStatus("pending");
    setErrorMessage(null);
    setResult(null);
    setHostStatuses([]);
    setPollCount(0);
    onJobStatusChange?.("pending");

    submitMutation.mutate({
      hosts: selectedHosts.map((h) => ({
        h: h.h,
        p: h.p,
        id: h.id,
        lat: h.lat,
        lon: h.lon,
      })),
      frequencyKhz: freq,
      passbandHz: pb,
      sampleTime,
      mapBounds,
      knownLocation,
    });
  }, [
    selectedHosts,
    frequencyKhz,
    passbandHz,
    sampleTime,
    knownLat,
    knownLon,
    knownName,
    submitMutation,
    onJobStatusChange,
  ]);

  // Apply reference transmitter
  const applyRef = useCallback((ref: RefTransmitter) => {
    setFrequencyKhz(String(ref.f));
    if (ref.p) setPassbandHz(String(ref.p));
    if (ref.lat && ref.lon) {
      setKnownLat(String(ref.lat));
      setKnownLon(String(ref.lon));
      setKnownName(ref.id);
    }
    setRefsOpen(false);
    toast.info(`Applied: ${ref.id} — ${ref.f} kHz`);
  }, []);

  const isRunning =
    jobStatus === "pending" || jobStatus === "sampling" || jobStatus === "computing";

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: "100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="fixed top-0 right-0 bottom-0 w-[420px] max-w-[95vw] z-50 flex flex-col"
        >
          {/* Glass background */}
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xl border-l border-white/10" />

          {/* Content */}
          <div className="relative flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
                  <Crosshair className="w-5 h-5 text-violet-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">TDoA Triangulation</h2>
                  <p className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                    Time Difference of Arrival
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4 text-white/60" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 scrollbar-thin">
              {/* ── Selected Hosts ───────────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-violet-400" />
                    Selected Receivers ({selectedHosts.length}/6)
                  </h3>
                  {selectedHosts.length > 0 && (
                    <button
                      onClick={onClearHosts}
                      className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                {selectedHosts.length === 0 ? (
                  <div className="rounded-lg bg-white/5 border border-dashed border-white/10 p-4 text-center">
                    <MapPin className="w-5 h-5 text-white/20 mx-auto mb-2" />
                    <p className="text-[11px] text-white/40">
                      Select 2–6 GPS-active KiwiSDR receivers from the list below or click on the
                      globe
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {selectedHosts.map((host) => {
                      const hs = hostStatuses.find((s) => s.host === host.h);
                      return (
                        <div
                          key={`${host.h}:${host.p}`}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-medium text-white/90 truncate">
                              {host.n || host.h}
                            </p>
                            <p className="text-[9px] font-mono text-white/40">
                              {host.h}:{host.p} · {host.lat.toFixed(2)}°, {host.lon.toFixed(2)}°
                            </p>
                          </div>
                          {hs && (
                            <div className="shrink-0">
                              {hs.status === "sampling" && (
                                <Loader2 className="w-3.5 h-3.5 text-yellow-400 animate-spin" />
                              )}
                              {hs.status === "ok" && (
                                <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                              )}
                              {hs.status === "failed" && (
                                <XCircle className="w-3.5 h-3.5 text-red-400" />
                              )}
                              {hs.status === "busy" && (
                                <Clock className="w-3.5 h-3.5 text-orange-400" />
                              )}
                              {hs.status === "no_gps" && (
                                <XCircle className="w-3.5 h-3.5 text-red-400" />
                              )}
                            </div>
                          )}
                          <button
                            onClick={() => onToggleHost(host)}
                            className="shrink-0 w-5 h-5 rounded bg-white/5 flex items-center justify-center hover:bg-red-500/20 transition-colors"
                            disabled={isRunning}
                          >
                            <X className="w-3 h-3 text-white/40 hover:text-red-400" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Host Browser ──────────────────────────── */}
              <div>
                <button
                  onClick={() => setHostListOpen(!hostListOpen)}
                  className="flex items-center justify-between w-full mb-2"
                >
                  <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider flex items-center gap-1.5">
                    <Signal className="w-3.5 h-3.5 text-cyan-400" />
                    GPS Hosts ({gpsHostsQuery.data?.length ?? "..."})
                  </h3>
                  {hostListOpen ? (
                    <ChevronUp className="w-4 h-4 text-white/40" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-white/40" />
                  )}
                </button>

                <AnimatePresence>
                  {hostListOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      {/* Search */}
                      <div className="relative mb-2">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                        <input
                          type="text"
                          value={hostSearch}
                          onChange={(e) => setHostSearch(e.target.value)}
                          placeholder="Search hosts..."
                          className="w-full pl-8 pr-3 py-1.5 text-[11px] bg-white/5 border border-white/10 rounded-lg text-white/80 placeholder-white/30 focus:outline-none focus:border-violet-500/40"
                        />
                      </div>

                      {/* Host list */}
                      <div className="max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.02] scrollbar-thin">
                        {gpsHostsQuery.isLoading ? (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
                          </div>
                        ) : filteredHosts.length === 0 ? (
                          <div className="py-4 text-center text-[11px] text-white/30">
                            No GPS hosts found
                          </div>
                        ) : (
                          filteredHosts.slice(0, 100).map((host) => {
                            const selected = isHostSelected(host);
                            const available = host.tc > 0 && host.u < host.um;
                            return (
                              <button
                                key={`${host.h}:${host.p}`}
                                onClick={() => onToggleHost(host)}
                                disabled={isRunning || (!selected && selectedHosts.length >= 6)}
                                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left border-b border-white/5 last:border-0 transition-colors ${
                                  selected
                                    ? "bg-violet-500/15 hover:bg-violet-500/20"
                                    : available
                                      ? "hover:bg-white/5"
                                      : "opacity-50"
                                }`}
                              >
                                <div
                                  className={`w-2 h-2 rounded-full shrink-0 ${
                                    selected
                                      ? "bg-violet-400"
                                      : available
                                        ? "bg-green-400"
                                        : "bg-red-400/50"
                                  }`}
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-[10px] font-medium text-white/80 truncate">
                                    {host.n || host.h}
                                  </p>
                                  <p className="text-[9px] font-mono text-white/35">
                                    {host.h}:{host.p} · SNR:{host.snr} · {host.u}/{host.um} users ·
                                    TDoA:{host.tc}ch
                                  </p>
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ── Frequency Settings ────────────────────── */}
              <div>
                <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  Frequency & Sampling
                </h3>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-white/50 mb-1 block">Frequency (kHz)</label>
                    <input
                      type="number"
                      value={frequencyKhz}
                      onChange={(e) => setFrequencyKhz(e.target.value)}
                      className="w-full px-3 py-1.5 text-[11px] bg-white/5 border border-white/10 rounded-lg text-white/80 focus:outline-none focus:border-violet-500/40"
                      disabled={isRunning}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-white/50 mb-1 block">Passband (Hz)</label>
                    <input
                      type="number"
                      value={passbandHz}
                      onChange={(e) => setPassbandHz(e.target.value)}
                      className="w-full px-3 py-1.5 text-[11px] bg-white/5 border border-white/10 rounded-lg text-white/80 focus:outline-none focus:border-violet-500/40"
                      disabled={isRunning}
                    />
                  </div>
                </div>

                {/* Sample time */}
                <div className="mt-2">
                  <label className="text-[10px] text-white/50 mb-1 block">Sample Time</label>
                  <div className="flex gap-1.5">
                    {SAMPLE_TIMES.map((t) => (
                      <button
                        key={t}
                        onClick={() => setSampleTime(t)}
                        disabled={isRunning}
                        className={`flex-1 py-1.5 text-[11px] rounded-lg border transition-colors ${
                          sampleTime === t
                            ? "bg-violet-500/20 border-violet-500/40 text-violet-300"
                            : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10"
                        }`}
                      >
                        {t}s
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reference transmitter quick-select */}
                <button
                  onClick={() => setRefsOpen(!refsOpen)}
                  className="mt-2 w-full flex items-center justify-between px-3 py-1.5 text-[10px] text-white/50 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <span>Load from reference transmitter...</span>
                  {refsOpen ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>

                <AnimatePresence>
                  {refsOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden mt-1"
                    >
                      <div className="relative mb-1">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30" />
                        <input
                          type="text"
                          value={refSearch}
                          onChange={(e) => setRefSearch(e.target.value)}
                          placeholder="Search by callsign or frequency..."
                          className="w-full pl-7 pr-3 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white/80 placeholder-white/30 focus:outline-none focus:border-violet-500/40"
                        />
                      </div>
                      <div className="max-h-32 overflow-y-auto rounded border border-white/10 bg-white/[0.02] scrollbar-thin">
                        {refsQuery.isLoading ? (
                          <div className="flex items-center justify-center py-3">
                            <Loader2 className="w-4 h-4 text-white/30 animate-spin" />
                          </div>
                        ) : (
                          filteredRefs.map((ref, i) => (
                            <button
                              key={`${ref.id}-${ref.f}-${i}`}
                              onClick={() => applyRef(ref)}
                              className="w-full flex items-center gap-2 px-2 py-1 text-left border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors"
                            >
                              <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-white/5 text-white/40">
                                {REF_CATEGORIES[ref.r] || ref.r}
                              </span>
                              <span className="text-[10px] text-white/70 font-medium">
                                {ref.id}
                              </span>
                              <span className="text-[10px] font-mono text-white/40 ml-auto">
                                {ref.f} kHz
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ── Known Location (optional) ──────────────── */}
              <div>
                <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-green-400" />
                  Known Location{" "}
                  <span className="text-white/30 font-normal lowercase">(optional)</span>
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-white/50 mb-1 block">Lat</label>
                    <input
                      type="number"
                      value={knownLat}
                      onChange={(e) => setKnownLat(e.target.value)}
                      placeholder="48.85"
                      className="w-full px-2 py-1.5 text-[11px] bg-white/5 border border-white/10 rounded-lg text-white/80 placeholder-white/20 focus:outline-none focus:border-green-500/40"
                      disabled={isRunning}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-white/50 mb-1 block">Lon</label>
                    <input
                      type="number"
                      value={knownLon}
                      onChange={(e) => setKnownLon(e.target.value)}
                      placeholder="2.35"
                      className="w-full px-2 py-1.5 text-[11px] bg-white/5 border border-white/10 rounded-lg text-white/80 placeholder-white/20 focus:outline-none focus:border-green-500/40"
                      disabled={isRunning}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-white/50 mb-1 block">Name</label>
                    <input
                      type="text"
                      value={knownName}
                      onChange={(e) => setKnownName(e.target.value)}
                      placeholder="Paris"
                      className="w-full px-2 py-1.5 text-[11px] bg-white/5 border border-white/10 rounded-lg text-white/80 placeholder-white/20 focus:outline-none focus:border-green-500/40"
                      disabled={isRunning}
                    />
                  </div>
                </div>
              </div>

              {/* ── Progress Display ──────────────────────── */}
              {isRunning && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg bg-violet-500/10 border border-violet-500/20 p-4"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
                    <span className="text-xs font-medium text-violet-300">
                      {jobStatus === "pending" && "Submitting..."}
                      {jobStatus === "sampling" && "Sampling IQ data..."}
                      {jobStatus === "computing" && "Running TDoA algorithm..."}
                    </span>
                    <span className="text-[10px] font-mono text-white/30 ml-auto">
                      {pollCount > 0 && `${pollCount * 2}s`}
                    </span>
                  </div>

                  {hostStatuses.length > 0 && (
                    <div className="space-y-1">
                      {hostStatuses.map((hs) => (
                        <div key={hs.host} className="flex items-center gap-2">
                          {hs.status === "sampling" && (
                            <Loader2 className="w-3 h-3 text-yellow-400 animate-spin" />
                          )}
                          {hs.status === "ok" && (
                            <CheckCircle2 className="w-3 h-3 text-green-400" />
                          )}
                          {hs.status === "failed" && (
                            <XCircle className="w-3 h-3 text-red-400" />
                          )}
                          {hs.status === "busy" && (
                            <Clock className="w-3 h-3 text-orange-400" />
                          )}
                          {hs.status === "no_gps" && (
                            <XCircle className="w-3 h-3 text-red-400" />
                          )}
                          <span className="text-[10px] font-mono text-white/60">{hs.host}</span>
                          <span className="text-[9px] text-white/30 ml-auto capitalize">
                            {hs.status.replace("_", " ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* ── Result Display ────────────────────────── */}
              {result && jobStatus === "complete" && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg bg-green-500/10 border border-green-500/20 p-4"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                    <span className="text-xs font-semibold text-green-300">Position Found</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-[10px] text-white/40">Latitude</p>
                      <p className="text-sm font-mono text-white/90">
                        {result.likelyLat.toFixed(4)}°
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-white/40">Longitude</p>
                      <p className="text-sm font-mono text-white/90">
                        {result.likelyLon.toFixed(4)}°
                      </p>
                    </div>
                    <a
                      href={`https://www.google.com/maps?q=${result.likelyLat},${result.likelyLon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto text-[10px] text-violet-400 hover:text-violet-300 underline"
                    >
                      Open in Maps
                    </a>
                  </div>
                </motion.div>
              )}

              {/* ── Error Display ────────────────────────── */}
              {errorMessage && jobStatus === "error" && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg bg-red-500/10 border border-red-500/20 p-4"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <XCircle className="w-4 h-4 text-red-400" />
                    <span className="text-xs font-semibold text-red-300">Error</span>
                  </div>
                  <p className="text-[11px] text-white/60">{errorMessage}</p>
                </motion.div>
              )}
            </div>

            {/* ── Bottom Actions ──────────────────────── */}
            <div className="px-5 py-3 border-t border-white/10 flex gap-2">
              {isRunning ? (
                <button
                  onClick={() => jobId && cancelMutation.mutate({ jobId })}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/15 border border-red-500/25 text-red-300 text-xs font-medium hover:bg-red-500/25 transition-colors"
                >
                  <Square className="w-3.5 h-3.5" />
                  Cancel
                </button>
              ) : (
                <>
                  {jobStatus === "complete" && (
                    <button
                      onClick={() => {
                        setJobStatus("idle");
                        setJobId(null);
                        setResult(null);
                        setHostStatuses([]);
                        onJobStatusChange?.("idle");
                      }}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white/60 text-xs font-medium hover:bg-white/10 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reset
                    </button>
                  )}
                  <button
                    onClick={handleSubmit}
                    disabled={selectedHosts.length < 2}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-300 text-xs font-medium hover:bg-violet-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Run TDoA ({selectedHosts.length} hosts)
                  </button>
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
