/**
 * TDoAResult.tsx — Shareable TDoA job result page
 * Loads a specific job from the database and displays it with globe overlay
 */
import { useState, useMemo, useRef, useEffect, Component, type ReactNode } from "react";
import { useRoute, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import Globe, { type TdoaOverlayData } from "@/components/Globe";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Crosshair,
  MapPin,
  Clock,
  Radio,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  AlertTriangle,
} from "lucide-react";

const SPACE_BG =
  "https://private-us-east-1.manuscdn.com/sessionFile/vNaLpF1RBh0KpESEYFZ0O6/sandbox/jetyLTlTEnk4uuIRFGjEIW-img-1_1770744518000_na1fn_c3BhY2UtYmc.jpg?x-oss-process=image/resize,w_1920,h_1920/format,webp/quality,q_80&Expires=1798761600&Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvdk5hTHBGMVJCaDBLcEVTRVlGWjBPNi9zYW5kYm94L2pldHlMVGxURW5rNHV1SVJGR2pFSVctaW1nLTFfMTc3MDc0NDUxODAwMF9uYTFmbl9jM0JoWTJVdFltYy5qcGc~eC1vc3MtcHJvY2Vzcz1pbWFnZS9yZXNpemUsd18xOTIwLGhfMTkyMC9mb3JtYXQsd2VicC9xdWFsaXR5LHFfODAiLCJDb25kaXRpb24iOnsiRGF0ZUxlc3NUaGFuIjp7IkFXUzpFcG9jaFRpbWUiOjE3OTg3NjE2MDB9fX1dfQ__&Signature=BPXM9FJtJnVf6wJkSRGMYwJfKEBhGmVh-FxDjjMhmMk5F3Ij~6yJpFXxJBNqFqDSqBPGT4MRh7~Nh4XbSy6q6gVsZXiPVSBqJmNMhqvVpSYFNbpqFnUBNYKdGBJNHYSMnvdC8qYP~Wd3CJKM9GJfYK5LNMqFnUBNYKdGBJNHYS&Key-Pair-Id=K1Y3GG1BVAGK5Y";

/** Error boundary for WebGL crashes */
class GlobeErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: string | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-background/90">
          <p className="text-red-400 text-sm">Globe failed to load: {this.state.error}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function TDoAResult() {
  const [, params] = useRoute("/tdoa/:jobId");
  const jobId = params?.jobId ? parseInt(params.jobId, 10) : NaN;
  const [copied, setCopied] = useState(false);

  const { data: job, isLoading, error } = trpc.tdoa.getJobById.useQuery(
    { id: jobId },
    { enabled: !isNaN(jobId) }
  );

  // Build TDoA overlay data for the globe
  const tdoaOverlay = useMemo<TdoaOverlayData>(() => {
    if (!job || !job.likelyLat || !job.likelyLon) return { visible: false };

    const hosts = (job.hosts as any[]) || [];
    const contours = (job.contourData as any[]) || [];
    const heatmapKey = (job as any).heatmapKey as string | null;

    return {
      visible: true,
      hosts: hosts.map((h: any) => ({
        lat: h.lat,
        lon: h.lon,
        hostname: h.h || h.id || "",
        selected: true,
        status: "ok" as const,
      })),
      targetLat: parseFloat(job.likelyLat),
      targetLon: parseFloat(job.likelyLon),
      contours,
      heatmapUrl: heatmapKey
        ? `/api/tdoa-heatmap/${heatmapKey}/TDoA_map_for_map.png`
        : undefined,
      heatmapBounds: job.mapBounds as any,
    };
  }, [job]);

  const handleCopyLink = () => {
    const url = `${window.location.origin}/tdoa/${jobId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="relative w-screen h-screen overflow-hidden bg-background flex items-center justify-center">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-40 pointer-events-none"
          style={{ backgroundImage: `url(${SPACE_BG})` }}
        />
        <div className="relative z-10 flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
          <p className="text-sm text-muted-foreground font-mono">Loading TDoA result...</p>
        </div>
      </div>
    );
  }

  // Error or not found
  if (isNaN(jobId) || error || !job) {
    return (
      <div className="relative w-screen h-screen overflow-hidden bg-background flex items-center justify-center">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-40 pointer-events-none"
          style={{ backgroundImage: `url(${SPACE_BG})` }}
        />
        <div className="relative z-10 flex flex-col items-center gap-4 max-w-md text-center px-6">
          <div className="w-16 h-16 rounded-full bg-red-500/15 border border-red-500/25 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">TDoA Job Not Found</h2>
          <p className="text-sm text-muted-foreground">
            {isNaN(jobId)
              ? "Invalid job ID in the URL."
              : "This TDoA job may have been deleted or doesn't exist."}
          </p>
          <Link
            href="/"
            className="mt-2 flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-300 text-sm hover:bg-violet-500/30 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Globe
          </Link>
        </div>
      </div>
    );
  }

  const hosts = (job.hosts as any[]) || [];
  const hasResult = !!job.likelyLat && !!job.likelyLon;
  const createdDate = new Date(job.createdAt).toLocaleString();
  const completedDate = job.completedAt
    ? new Date(job.completedAt).toLocaleString()
    : null;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-background">
      {/* Space background */}
      <div
        className="absolute inset-0 bg-cover bg-center opacity-40 pointer-events-none"
        style={{ backgroundImage: `url(${SPACE_BG})` }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.7) 100%)",
        }}
      />

      {/* Globe */}
      <GlobeErrorBoundary>
        <Globe ionosondes={[]} tdoaOverlay={tdoaOverlay} />
      </GlobeErrorBoundary>

      {/* Top bar */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between"
      >
        <Link
          href="/"
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background/70 backdrop-blur-md border border-border text-foreground/70 text-sm hover:bg-background/80 hover:text-foreground transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Back to Globe</span>
        </Link>

        <div className="flex items-center gap-2">
          <div className="px-3 py-2 rounded-lg bg-violet-500/15 backdrop-blur-md border border-violet-500/25">
            <div className="flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-violet-400" />
              <span className="text-[11px] font-mono text-violet-300 uppercase tracking-wider">
                TDoA Result #{jobId}
              </span>
            </div>
          </div>

          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-background/70 backdrop-blur-md border border-border text-foreground/70 text-sm hover:bg-background/80 hover:text-foreground transition-all"
            title="Copy shareable link"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-green-400" />
                <span className="text-green-400 text-[10px]">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span className="text-[10px] hidden sm:inline">Share</span>
              </>
            )}
          </button>
        </div>
      </motion.div>

      {/* Result info panel */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="absolute bottom-6 left-4 z-20 w-80 max-w-[calc(100vw-2rem)]"
      >
        <div className="rounded-xl bg-background/80 backdrop-blur-xl border border-border overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-border bg-violet-500/5">
            <div className="flex items-center gap-2 mb-1">
              <div
                className={`w-2 h-2 rounded-full ${
                  job.status === "complete"
                    ? "bg-green-400"
                    : job.status === "error"
                    ? "bg-red-400"
                    : "bg-yellow-400"
                }`}
              />
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {job.status}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Radio className="w-3.5 h-3.5 text-violet-400" />
              <span className="text-sm font-mono text-foreground/90">
                {parseFloat(job.frequencyKhz).toLocaleString()} kHz
              </span>
              <span className="text-[10px] text-muted-foreground/50">
                / {job.passbandHz} Hz PB
              </span>
            </div>
          </div>

          {/* Position */}
          {hasResult && (
            <div className="px-4 py-3 border-b border-border">
              <div className="flex items-center gap-1.5 mb-2">
                <MapPin className="w-3 h-3 text-green-400" />
                <span className="text-[9px] text-green-400/70 uppercase tracking-wider font-medium">
                  Estimated Position
                </span>
              </div>
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-[9px] text-muted-foreground/70">Latitude</p>
                  <p className="text-sm font-mono text-foreground/90">
                    {parseFloat(job.likelyLat!).toFixed(4)}°
                  </p>
                </div>
                <div>
                  <p className="text-[9px] text-muted-foreground/70">Longitude</p>
                  <p className="text-sm font-mono text-foreground/90">
                    {parseFloat(job.likelyLon!).toFixed(4)}°
                  </p>
                </div>
                <a
                  href={`https://www.google.com/maps?q=${job.likelyLat},${job.likelyLon}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto flex items-center gap-1 text-[10px] text-violet-400/70 hover:text-violet-300 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  Maps
                </a>
              </div>
            </div>
          )}

          {/* Hosts */}
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[9px] text-muted-foreground/70 uppercase tracking-wider mb-1.5">
              Receivers ({hosts.length})
            </p>
            <div className="space-y-1">
              {hosts.map((h: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-violet-400/60" />
                  <span className="truncate">{h.h || h.id}</span>
                  <span className="text-muted-foreground/50 ml-auto">
                    {h.lat?.toFixed(1)}°, {h.lon?.toFixed(1)}°
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Timestamps */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
              <Clock className="w-3 h-3" />
              <span>Started: {createdDate}</span>
            </div>
            {completedDate && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 mt-0.5">
                <Clock className="w-3 h-3" />
                <span>Completed: {completedDate}</span>
              </div>
            )}
          </div>

          {/* Error message */}
          {job.status === "error" && job.errorMessage && (
            <div className="px-4 py-3 border-t border-red-500/10 bg-red-500/5">
              <p className="text-[10px] text-red-400/80">{job.errorMessage}</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
