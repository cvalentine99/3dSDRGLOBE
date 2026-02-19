/**
 * TDoAHistory.tsx — TDoA Job History Panel
 *
 * Allows users to:
 * 1. Browse past TDoA triangulation runs from the database
 * 2. View job details (frequency, hosts, results)
 * 3. Replay a past result on the globe overlay
 * 4. Delete old jobs
 */
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  History,
  Trash2,
  MapPin,
  Radio,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  RotateCcw,
  Link2,
  Check,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import RecordingPlayback from "./RecordingPlayback";

/* ── Types ────────────────────────────────────────── */

interface TdoaJobRow {
  id: number;
  frequencyKhz: string;
  passbandHz: number;
  sampleTime: number;
  hosts: any;
  knownLocation: any;
  mapBounds: any;
  tdoaKey: string | null;
  status: "pending" | "sampling" | "computing" | "complete" | "error";
  likelyLat: string | null;
  likelyLon: string | null;
  resultData: any;
  contourData: any;
  heatmapKey: string | null;
  errorMessage: string | null;
  createdAt: number;
  completedAt: number | null;
}

interface TDoAHistoryProps {
  isOpen: boolean;
  onReplay?: (job: {
    likelyLat: number;
    likelyLon: number;
    hosts: { lat: number; lon: number; h: string }[];
    contours: any[];
    jobId: string;
    heatmapUrl?: string;
    heatmapBounds?: { north: number; south: number; east: number; west: number };
  }) => void;
}

/** Small share-link button for individual jobs */
function ShareButton({ jobId }: { jobId: number }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    const url = `${window.location.origin}/tdoa/${jobId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast.success("Share link copied!");
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10 text-white/40 text-[10px] hover:bg-violet-500/15 hover:border-violet-500/20 hover:text-violet-300 transition-colors"
      title="Copy shareable link"
    >
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Link2 className="w-3 h-3" />}
      {copied ? "Copied" : "Share"}
    </button>
  );
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  complete: { icon: CheckCircle2, color: "text-green-400", label: "Complete" },
  error: { icon: XCircle, color: "text-red-400", label: "Failed" },
  pending: { icon: Loader2, color: "text-yellow-400", label: "Pending" },
  sampling: { icon: Loader2, color: "text-yellow-400", label: "Sampling" },
  computing: { icon: Loader2, color: "text-violet-400", label: "Computing" },
};

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatFrequency(khz: string): string {
  const f = parseFloat(khz);
  if (f >= 1000) return `${(f / 1000).toFixed(3)} MHz`;
  return `${f} kHz`;
}

/* ── Component ────────────────────────────────────── */

export default function TDoAHistory({ isOpen, onReplay }: TDoAHistoryProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Fetch job history from database
  const historyQuery = trpc.tdoa.jobHistory.useQuery(
    { limit: 50 },
    {
      enabled: isOpen,
      staleTime: 30 * 1000,
      refetchInterval: isOpen ? 30000 : false,
    }
  );

  // Delete mutation
  const deleteMutation = trpc.tdoa.deleteJob.useMutation({
    onSuccess: () => {
      historyQuery.refetch();
      toast.success("Job deleted from history");
    },
    onError: (err) => {
      toast.error(`Delete failed: ${err.message}`);
    },
  });

  const jobs = useMemo(() => {
    return (historyQuery.data || []) as TdoaJobRow[];
  }, [historyQuery.data]);

  const handleReplay = (job: TdoaJobRow) => {
    if (!job.likelyLat || !job.likelyLon) {
      toast.error("No position data to replay");
      return;
    }
    const hosts = Array.isArray(job.hosts) ? job.hosts : [];
    const contours = Array.isArray(job.contourData) ? job.contourData : [];
    const bounds = job.mapBounds as { north: number; south: number; east: number; west: number } | null;
    const heatmapUrl = job.heatmapKey
      ? `/api/tdoa-heatmap/${job.heatmapKey}`
      : undefined;
    onReplay?.({
      likelyLat: parseFloat(job.likelyLat),
      likelyLon: parseFloat(job.likelyLon),
      hosts: hosts.map((h: any) => ({ lat: h.lat, lon: h.lon, h: h.h })),
      contours,
      jobId: String(job.id),
      heatmapUrl,
      heatmapBounds: bounds || undefined,
    });
    toast.success("Replaying TDoA result on globe");
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate({ id });
  };

  if (!isOpen) return null;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider flex items-center gap-1.5">
          <History className="w-3.5 h-3.5 text-violet-400" />
          Job History ({jobs.length})
        </h3>
        {historyQuery.isRefetching && (
          <Loader2 className="w-3 h-3 text-white/30 animate-spin" />
        )}
      </div>

      {/* Loading state */}
      {historyQuery.isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!historyQuery.isLoading && jobs.length === 0 && (
        <div className="rounded-lg bg-white/5 border border-dashed border-white/10 p-6 text-center">
          <History className="w-6 h-6 text-white/15 mx-auto mb-2" />
          <p className="text-[11px] text-white/40">No TDoA jobs recorded yet</p>
          <p className="text-[10px] text-white/25 mt-1">
            Submit a triangulation job to see it here
          </p>
        </div>
      )}

      {/* Job list */}
      <div className="space-y-2 max-h-[50vh] overflow-y-auto scrollbar-thin pr-1">
        <AnimatePresence initial={false}>
          {jobs.map((job) => {
            const statusCfg = STATUS_CONFIG[job.status] || STATUS_CONFIG.error;
            const StatusIcon = statusCfg.icon;
            const isExpanded = expandedId === job.id;
            const hosts = Array.isArray(job.hosts) ? job.hosts : [];
            const hasResult = job.status === "complete" && job.likelyLat && job.likelyLon;

            return (
              <motion.div
                key={job.id}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="rounded-lg bg-white/[0.03] border border-white/8 overflow-hidden"
              >
                {/* Job summary row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : job.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
                >
                  <StatusIcon
                    className={`w-3.5 h-3.5 shrink-0 ${statusCfg.color} ${
                      job.status === "sampling" || job.status === "computing"
                        ? "animate-spin"
                        : ""
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono font-medium text-white/85">
                        {formatFrequency(job.frequencyKhz)}
                      </span>
                      <span className="text-[9px] text-white/30">·</span>
                      <span className="text-[9px] text-white/40">
                        {hosts.length} hosts
                      </span>
                      <span className="text-[9px] text-white/30">·</span>
                      <span className="text-[9px] text-white/40">
                        {job.sampleTime}s
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Clock className="w-2.5 h-2.5 text-white/25" />
                      <span className="text-[9px] text-white/35">
                        {formatTimestamp(job.createdAt)}
                      </span>
                      {hasResult && (
                        <>
                          <MapPin className="w-2.5 h-2.5 text-green-400/60 ml-1" />
                          <span className="text-[9px] font-mono text-green-400/60">
                            {parseFloat(job.likelyLat!).toFixed(2)}°,{" "}
                            {parseFloat(job.likelyLon!).toFixed(2)}°
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5 text-white/30 shrink-0" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-white/30 shrink-0" />
                  )}
                </button>

                {/* Expanded details */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 pb-3 pt-1 border-t border-white/5 space-y-2.5">
                        {/* Hosts list */}
                        <div>
                          <p className="text-[9px] text-white/40 uppercase tracking-wider mb-1">
                            Receivers
                          </p>
                          <div className="space-y-0.5">
                            {hosts.map((h: any, i: number) => (
                              <div
                                key={i}
                                className="flex items-center gap-1.5 text-[9px]"
                              >
                                <Radio className="w-2.5 h-2.5 text-violet-400/50" />
                                <span className="font-mono text-white/50 truncate">
                                  {h.h || h.id}
                                </span>
                                <span className="text-white/25 ml-auto">
                                  {h.lat?.toFixed(1)}°, {h.lon?.toFixed(1)}°
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Known location */}
                        {job.knownLocation && (
                          <div>
                            <p className="text-[9px] text-white/40 uppercase tracking-wider mb-1">
                              Known Location
                            </p>
                            <p className="text-[10px] font-mono text-white/50">
                              {(job.knownLocation as any).name} ({(job.knownLocation as any).lat?.toFixed(2)}°,{" "}
                              {(job.knownLocation as any).lon?.toFixed(2)}°)
                            </p>
                          </div>
                        )}

                        {/* Result */}
                        {hasResult && (
                          <div className="rounded bg-green-500/10 border border-green-500/15 px-2.5 py-2">
                            <p className="text-[9px] text-green-400/70 uppercase tracking-wider mb-1">
                              Estimated Position
                            </p>
                            <div className="flex items-center gap-3">
                              <div>
                                <p className="text-[9px] text-white/35">Lat</p>
                                <p className="text-[11px] font-mono text-white/80">
                                  {parseFloat(job.likelyLat!).toFixed(4)}°
                                </p>
                              </div>
                              <div>
                                <p className="text-[9px] text-white/35">Lon</p>
                                <p className="text-[11px] font-mono text-white/80">
                                  {parseFloat(job.likelyLon!).toFixed(4)}°
                                </p>
                              </div>
                              <a
                                href={`https://www.google.com/maps?q=${job.likelyLat},${job.likelyLon}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-auto text-[9px] text-violet-400/70 hover:text-violet-300 flex items-center gap-0.5"
                              >
                                <ExternalLink className="w-2.5 h-2.5" />
                                Maps
                              </a>
                            </div>
                          </div>
                        )}

                        {/* Audio Recordings */}
                        {job.status === "complete" && (
                          <RecordingPlayback jobId={job.id} />
                        )}

                        {/* Error message */}
                        {job.status === "error" && job.errorMessage && (
                          <div className="rounded bg-red-500/10 border border-red-500/15 px-2.5 py-2">
                            <p className="text-[9px] text-red-400/70 uppercase tracking-wider mb-0.5">
                              Error
                            </p>
                            <p className="text-[10px] text-white/50 break-words">
                              {job.errorMessage}
                            </p>
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex gap-2 pt-1">
                          {hasResult && (
                            <button
                              onClick={() => handleReplay(job)}
                              className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-violet-500/15 border border-violet-500/20 text-violet-300 text-[10px] font-medium hover:bg-violet-500/25 transition-colors"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Replay on Globe
                            </button>
                          )}
                          <ShareButton jobId={job.id} />
                          <button
                            onClick={() => handleDelete(job.id)}
                            disabled={deleteMutation.isPending}
                            className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10 text-white/40 text-[10px] hover:bg-red-500/15 hover:border-red-500/20 hover:text-red-300 transition-colors"
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
        </AnimatePresence>
      </div>
    </div>
  );
}
