/**
 * TDoACompare.tsx — TDoA Result Comparison View
 *
 * Allows users to:
 * 1. Select two TDoA jobs from history to compare
 * 2. View side-by-side position, frequency, and host data
 * 3. See position drift distance and bearing between results
 * 4. Overlay both results on the globe simultaneously
 */
import { useState, useMemo } from "react";
import { haversineKm, bearingDeg } from "@shared/geo";
import { motion, AnimatePresence } from "framer-motion";
import {
  GitCompare,
  MapPin,
  Radio,
  Clock,
  ArrowRight,
  Navigation,
  Ruler,
  ChevronDown,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

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
  status: string;
  likelyLat: string | null;
  likelyLon: string | null;
  resultData: any;
  contourData: any;
  heatmapKey: string | null;
  errorMessage: string | null;
  createdAt: number;
  completedAt: number | null;
}

interface TDoACompareProps {
  onOverlay: (jobs: TdoaJobRow[]) => void;
}

/* ── Helpers ──────────────────────────────────────── */

// haversineKm and bearingDeg imported from shared/geo.ts
const bearing = bearingDeg;

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ── Component ────────────────────────────────────── */

export default function TDoACompare({ onOverlay }: TDoACompareProps) {
  const [jobA, setJobA] = useState<TdoaJobRow | null>(null);
  const [jobB, setJobB] = useState<TdoaJobRow | null>(null);
  const [selectingSlot, setSelectingSlot] = useState<"A" | "B" | null>(null);

  const { data: history = [] } = trpc.tdoa.jobHistory.useQuery({ limit: 50 });

  // Filter to only completed jobs with results
  const completedJobs = useMemo(
    () =>
      (history as TdoaJobRow[]).filter(
        (j) => j.status === "complete" && j.likelyLat && j.likelyLon
      ),
    [history]
  );

  // Compute comparison metrics
  const comparison = useMemo(() => {
    if (!jobA?.likelyLat || !jobA?.likelyLon || !jobB?.likelyLat || !jobB?.likelyLon)
      return null;

    const latA = parseFloat(jobA.likelyLat);
    const lonA = parseFloat(jobA.likelyLon);
    const latB = parseFloat(jobB.likelyLat);
    const lonB = parseFloat(jobB.likelyLon);

    const distance = haversineKm(latA, lonA, latB, lonB);
    const brg = bearing(latA, lonA, latB, lonB);
    const midLat = (latA + latB) / 2;
    const midLon = (lonA + lonB) / 2;

    return { distance, bearing: brg, midLat, midLon };
  }, [jobA, jobB]);

  const handleSelect = (job: TdoaJobRow) => {
    if (selectingSlot === "A") {
      setJobA(job);
      // If same job selected for both, clear B
      if (jobB?.id === job.id) setJobB(null);
    } else if (selectingSlot === "B") {
      setJobB(job);
      if (jobA?.id === job.id) setJobA(null);
    }
    setSelectingSlot(null);
  };

  const handleOverlay = () => {
    const jobs = [jobA, jobB].filter(Boolean) as TdoaJobRow[];
    if (jobs.length === 2) onOverlay(jobs);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Job selector slots */}
      <div className="px-3 pt-3 pb-2 space-y-2">
        {/* Slot A */}
        <JobSlot
          label="A"
          color="violet"
          job={jobA}
          isSelecting={selectingSlot === "A"}
          onToggleSelect={() =>
            setSelectingSlot(selectingSlot === "A" ? null : "A")
          }
          onClear={() => setJobA(null)}
        />

        {/* VS divider */}
        <div className="flex items-center gap-2 px-2">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[9px] font-mono text-white/30 uppercase">vs</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Slot B */}
        <JobSlot
          label="B"
          color="cyan"
          job={jobB}
          isSelecting={selectingSlot === "B"}
          onToggleSelect={() =>
            setSelectingSlot(selectingSlot === "B" ? null : "B")
          }
          onClear={() => setJobB(null)}
        />
      </div>

      {/* Job picker dropdown */}
      <AnimatePresence>
        {selectingSlot && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-white/5 overflow-hidden"
          >
            <div className="px-3 py-2 max-h-40 overflow-y-auto scrollbar-thin">
              <p className="text-[9px] text-white/40 uppercase tracking-wider mb-1.5">
                Select Job for Slot {selectingSlot}
              </p>
              {completedJobs.length === 0 ? (
                <p className="text-[10px] text-white/30 py-2 text-center">
                  No completed jobs available
                </p>
              ) : (
                <div className="space-y-1">
                  {completedJobs.map((job) => {
                    const isSelected =
                      (selectingSlot === "A" && jobA?.id === job.id) ||
                      (selectingSlot === "B" && jobB?.id === job.id);
                    const isOtherSlot =
                      (selectingSlot === "A" && jobB?.id === job.id) ||
                      (selectingSlot === "B" && jobA?.id === job.id);
                    return (
                      <button
                        key={job.id}
                        onClick={() => handleSelect(job)}
                        disabled={isSelected}
                        className={`w-full text-left px-2.5 py-1.5 rounded-md text-[10px] transition-colors ${
                          isSelected
                            ? "bg-violet-500/20 border border-violet-500/30 text-violet-300"
                            : isOtherSlot
                            ? "bg-white/5 border border-white/10 text-white/30"
                            : "bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 hover:text-white/80"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono">
                            #{job.id} — {parseFloat(job.frequencyKhz).toLocaleString()} kHz
                          </span>
                          <span className="text-white/30">
                            {formatTimestamp(job.createdAt)}
                          </span>
                        </div>
                        <div className="text-[9px] text-white/30 mt-0.5">
                          {parseFloat(job.likelyLat!).toFixed(2)}°,{" "}
                          {parseFloat(job.likelyLon!).toFixed(2)}°
                          {isOtherSlot && (
                            <span className="ml-1 text-white/20">
                              (in other slot)
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Comparison results */}
      {jobA && jobB && comparison && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex-1 overflow-y-auto scrollbar-thin border-t border-white/5"
        >
          <div className="px-3 py-3 space-y-3">
            {/* Position drift */}
            <div className="rounded-lg bg-white/5 border border-white/10 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Ruler className="w-3 h-3 text-amber-400" />
                <span className="text-[9px] text-amber-400/70 uppercase tracking-wider font-medium">
                  Position Drift
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-[9px] text-white/35">Distance</p>
                  <p className="text-lg font-mono text-white/90">
                    {comparison.distance < 1
                      ? `${(comparison.distance * 1000).toFixed(0)} m`
                      : `${comparison.distance.toFixed(1)} km`}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] text-white/35">Bearing</p>
                  <p className="text-lg font-mono text-white/90">
                    {comparison.bearing.toFixed(1)}°
                  </p>
                </div>
                <Navigation
                  className="w-5 h-5 text-amber-400/50 ml-auto"
                  style={{
                    transform: `rotate(${comparison.bearing}deg)`,
                  }}
                />
              </div>
            </div>

            {/* Side-by-side positions */}
            <div className="grid grid-cols-2 gap-2">
              <PositionCard
                label="Job A"
                color="violet"
                job={jobA}
              />
              <PositionCard
                label="Job B"
                color="cyan"
                job={jobB}
              />
            </div>

            {/* Frequency comparison */}
            <div className="rounded-lg bg-white/5 border border-white/10 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Radio className="w-3 h-3 text-white/50" />
                <span className="text-[9px] text-white/40 uppercase tracking-wider font-medium">
                  Frequency Comparison
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <span className="text-violet-400/70">A:</span>{" "}
                  <span className="font-mono text-white/70">
                    {parseFloat(jobA.frequencyKhz).toLocaleString()} kHz
                  </span>
                </div>
                <div>
                  <span className="text-cyan-400/70">B:</span>{" "}
                  <span className="font-mono text-white/70">
                    {parseFloat(jobB.frequencyKhz).toLocaleString()} kHz
                  </span>
                </div>
              </div>
              {jobA.frequencyKhz === jobB.frequencyKhz ? (
                <p className="text-[9px] text-green-400/60 mt-1.5">
                  Same frequency — drift shows temporal variation
                </p>
              ) : (
                <p className="text-[9px] text-amber-400/60 mt-1.5">
                  Different frequencies — drift shows cross-band variation
                </p>
              )}
            </div>

            {/* Host overlap */}
            <div className="rounded-lg bg-white/5 border border-white/10 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <MapPin className="w-3 h-3 text-white/50" />
                <span className="text-[9px] text-white/40 uppercase tracking-wider font-medium">
                  Receiver Overlap
                </span>
              </div>
              <HostOverlap hostsA={jobA.hosts} hostsB={jobB.hosts} />
            </div>

            {/* Overlay on globe button */}
            <button
              onClick={handleOverlay}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-300 text-[11px] font-medium hover:bg-violet-500/30 transition-colors"
            >
              <GitCompare className="w-4 h-4" />
              Overlay Both on Globe
            </button>
          </div>
        </motion.div>
      )}

      {/* Empty state */}
      {(!jobA || !jobB) && !selectingSlot && (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center">
            <GitCompare className="w-8 h-8 text-white/15 mx-auto mb-2" />
            <p className="text-[11px] text-white/30">
              Select two completed TDoA jobs to compare their results
            </p>
            <p className="text-[9px] text-white/20 mt-1">
              {completedJobs.length} completed job{completedJobs.length !== 1 ? "s" : ""}{" "}
              available
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ───────────────────────────────── */

function JobSlot({
  label,
  color,
  job,
  isSelecting,
  onToggleSelect,
  onClear,
}: {
  label: string;
  color: string;
  job: TdoaJobRow | null;
  isSelecting: boolean;
  onToggleSelect: () => void;
  onClear: () => void;
}) {
  const colorClasses = color === "violet"
    ? { bg: "bg-violet-500/10", border: "border-violet-500/20", text: "text-violet-400", badge: "bg-violet-500" }
    : { bg: "bg-cyan-500/10", border: "border-cyan-500/20", text: "text-cyan-400", badge: "bg-cyan-500" };

  return (
    <div
      className={`rounded-lg ${colorClasses.bg} border ${colorClasses.border} p-2.5 transition-colors`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-4 h-4 rounded-full ${colorClasses.badge} text-[9px] text-white font-bold flex items-center justify-center`}
          >
            {label}
          </span>
          {job ? (
            <span className="text-[10px] font-mono text-white/70">
              Job #{job.id}
            </span>
          ) : (
            <span className="text-[10px] text-white/30">Not selected</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {job && (
            <button
              onClick={onClear}
              className="p-0.5 rounded hover:bg-white/10 text-white/30 hover:text-white/60 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={onToggleSelect}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] transition-colors ${
              isSelecting
                ? `${colorClasses.bg} ${colorClasses.text}`
                : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60"
            }`}
          >
            <ChevronDown
              className={`w-2.5 h-2.5 transition-transform ${
                isSelecting ? "rotate-180" : ""
              }`}
            />
            {job ? "Change" : "Select"}
          </button>
        </div>
      </div>
      {job && (
        <div className="flex items-center gap-3 text-[9px]">
          <span className="font-mono text-white/50">
            {parseFloat(job.frequencyKhz).toLocaleString()} kHz
          </span>
          {job.likelyLat && job.likelyLon && (
            <span className="font-mono text-white/40">
              {parseFloat(job.likelyLat).toFixed(2)}°,{" "}
              {parseFloat(job.likelyLon).toFixed(2)}°
            </span>
          )}
          <span className="text-white/25 ml-auto">
            {formatTimestamp(job.createdAt)}
          </span>
        </div>
      )}
    </div>
  );
}

function PositionCard({
  label,
  color,
  job,
}: {
  label: string;
  color: string;
  job: TdoaJobRow;
}) {
  const colorClass = color === "violet" ? "text-violet-400" : "text-cyan-400";
  const borderClass =
    color === "violet" ? "border-violet-500/15" : "border-cyan-500/15";

  return (
    <div className={`rounded-lg bg-white/5 border ${borderClass} p-2.5`}>
      <p className={`text-[9px] ${colorClass} uppercase tracking-wider mb-1`}>
        {label}
      </p>
      <div className="space-y-1">
        <div>
          <p className="text-[8px] text-white/30">Lat</p>
          <p className="text-[11px] font-mono text-white/80">
            {parseFloat(job.likelyLat!).toFixed(4)}°
          </p>
        </div>
        <div>
          <p className="text-[8px] text-white/30">Lon</p>
          <p className="text-[11px] font-mono text-white/80">
            {parseFloat(job.likelyLon!).toFixed(4)}°
          </p>
        </div>
      </div>
    </div>
  );
}

function HostOverlap({ hostsA, hostsB }: { hostsA: any; hostsB: any }) {
  const aHosts = (hostsA as any[]) || [];
  const bHosts = (hostsB as any[]) || [];
  const aNames = new Set(aHosts.map((h: any) => h.h || h.id));
  const bNames = new Set(bHosts.map((h: any) => h.h || h.id));
  const shared = Array.from(aNames).filter((n) => bNames.has(n));
  const onlyA = Array.from(aNames).filter((n) => !bNames.has(n));
  const onlyB = Array.from(bNames).filter((n) => !aNames.has(n));

  return (
    <div className="space-y-1 text-[9px]">
      {shared.length > 0 && (
        <div>
          <span className="text-white/30">Shared: </span>
          <span className="font-mono text-green-400/60">{shared.join(", ")}</span>
        </div>
      )}
      {onlyA.length > 0 && (
        <div>
          <span className="text-white/30">Only A: </span>
          <span className="font-mono text-violet-400/60">{onlyA.join(", ")}</span>
        </div>
      )}
      {onlyB.length > 0 && (
        <div>
          <span className="text-white/30">Only B: </span>
          <span className="font-mono text-cyan-400/60">{onlyB.join(", ")}</span>
        </div>
      )}
      {shared.length === 0 && (
        <p className="text-white/20">No shared receivers between runs</p>
      )}
    </div>
  );
}
