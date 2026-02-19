/**
 * TDoABatchQueue.tsx — Batch TDoA scheduling and comparison panel
 *
 * Allows users to:
 * 1. Queue multiple TDoA runs at different frequencies
 * 2. Execute them sequentially
 * 3. Compare results across bands in a unified view
 */
import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Trash2,
  Play,
  Square,
  Loader2,
  CheckCircle2,
  XCircle,
  BarChart3,
  MapPin,
  Layers,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/* ── Types ────────────────────────────────────────── */

interface BatchItem {
  id: string;
  frequencyKhz: number;
  passbandHz: number;
  sampleTime: number;
  label: string;
  status: "queued" | "running" | "complete" | "error";
  jobId?: string;
  result?: {
    likelyLat: number;
    likelyLon: number;
  };
  error?: string;
}

interface TDoABatchQueueProps {
  selectedHosts: {
    h: string;
    p: number;
    id: string;
    lat: number;
    lon: number;
  }[];
  onShowResult?: (result: {
    likelyLat: number;
    likelyLon: number;
    hosts: { lat: number; lon: number; h: string }[];
    contours: any[];
    jobId: string;
  }) => void;
  disabled?: boolean;
}

/* ── Preset frequencies for quick batch setup ────── */

const BATCH_PRESETS = [
  { label: "WWV Multi-Band", items: [
    { freq: 5000, pb: 1000, label: "WWV 5 MHz" },
    { freq: 10000, pb: 1000, label: "WWV 10 MHz" },
    { freq: 15000, pb: 1000, label: "WWV 15 MHz" },
  ]},
  { label: "Time Signals", items: [
    { freq: 10000, pb: 1000, label: "WWV 10 MHz" },
    { freq: 7850, pb: 1000, label: "CHU 7.85 MHz" },
    { freq: 9996, pb: 1000, label: "RWM 9.996 MHz" },
  ]},
  { label: "HF Broadcast Bands", items: [
    { freq: 6000, pb: 5000, label: "49m Band" },
    { freq: 9500, pb: 5000, label: "31m Band" },
    { freq: 11700, pb: 5000, label: "25m Band" },
  ]},
] as const;

let batchIdCounter = 0;
function nextBatchId(): string {
  return `batch-${Date.now()}-${++batchIdCounter}`;
}

/* ── Component ────────────────────────────────────── */

export default function TDoABatchQueue({
  selectedHosts,
  onShowResult,
  disabled = false,
}: TDoABatchQueueProps) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [newFreq, setNewFreq] = useState("10000");
  const [newPb, setNewPb] = useState("1000");
  const [newSample, setNewSample] = useState(30);
  const [newLabel, setNewLabel] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);

  const submitMutation = trpc.tdoa.submitJob.useMutation();

  // Add a single item to the queue
  const addItem = useCallback(() => {
    const freq = parseFloat(newFreq);
    if (isNaN(freq) || freq <= 0) {
      toast.error("Enter a valid frequency");
      return;
    }
    const label = newLabel || `${freq} kHz`;
    setItems((prev) => [
      ...prev,
      {
        id: nextBatchId(),
        frequencyKhz: freq,
        passbandHz: parseInt(newPb) || 1000,
        sampleTime: newSample,
        label,
        status: "queued",
      },
    ]);
    setNewLabel("");
    setShowAdd(false);
    toast.success(`Added "${label}" to batch queue`);
  }, [newFreq, newPb, newSample, newLabel]);

  // Load a preset batch
  const loadPreset = useCallback((preset: typeof BATCH_PRESETS[number]) => {
    const newItems: BatchItem[] = preset.items.map((item) => ({
      id: nextBatchId(),
      frequencyKhz: item.freq,
      passbandHz: item.pb,
      sampleTime: 30,
      label: item.label,
      status: "queued" as const,
    }));
    setItems((prev) => [...prev, ...newItems]);
    setPresetsOpen(false);
    toast.success(`Loaded "${preset.label}" preset (${preset.items.length} frequencies)`);
  }, []);

  // Remove an item
  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  // Run the batch sequentially
  const runBatch = useCallback(async () => {
    if (selectedHosts.length < 2) {
      toast.error("Select at least 2 hosts before running batch");
      return;
    }

    const queuedItems = items.filter((i) => i.status === "queued");
    if (queuedItems.length === 0) {
      toast.error("No queued items to run");
      return;
    }

    setIsRunning(true);

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      if (item.status !== "queued") continue;

      setCurrentIdx(idx);
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: "running" } : i))
      );

      try {
        const hosts = selectedHosts.map((h) => ({
          h: h.h,
          p: h.p,
          id: h.id,
          lat: h.lat,
          lon: h.lon,
        }));

        const result = await submitMutation.mutateAsync({
          hosts,
          frequencyKhz: item.frequencyKhz,
          passbandHz: item.passbandHz,
          sampleTime: item.sampleTime,
          mapBounds: { north: 90, south: -90, east: 180, west: -180 },
        });

        // Poll for completion
        const jobId = result.jobId;
        let attempts = 0;
        const maxAttempts = 120; // 4 minutes max per job
        let completed = false;

        while (attempts < maxAttempts && !completed) {
          await new Promise((r) => setTimeout(r, 2000));
          attempts++;

          try {
            const resp = await fetch(`/api/trpc/tdoa.pollProgress?batch=1&input=${encodeURIComponent(JSON.stringify({ json: { jobId } }))}`);
            const data = await resp.json();
            const jobData = data?.result?.data?.json;

            if (jobData?.status === "complete" && jobData?.result?.likely_position) {
              setItems((prev) =>
                prev.map((i) =>
                  i.id === item.id
                    ? {
                        ...i,
                        status: "complete",
                        jobId,
                        result: {
                          likelyLat: jobData.result.likely_position.lat,
                          likelyLon: jobData.result.likely_position.lng,
                        },
                      }
                    : i
                )
              );
              completed = true;
              toast.success(`Batch: "${item.label}" complete`);
            } else if (jobData?.status === "error") {
              throw new Error(jobData.error || "Job failed");
            }
          } catch (pollErr: any) {
            if (pollErr.message?.includes("Job failed") || pollErr.message?.includes("error")) {
              throw pollErr;
            }
            // Network error during poll — retry
          }
        }

        if (!completed) {
          setItems((prev) =>
            prev.map((i) =>
              i.id === item.id
                ? { ...i, status: "error", error: "Timed out after 4 minutes" }
                : i
            )
          );
        }
      } catch (err: any) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? { ...i, status: "error", error: err.message || "Unknown error" }
              : i
          )
        );
        toast.error(`Batch: "${item.label}" failed — ${err.message}`);
      }

      // Brief pause between jobs to avoid overwhelming the TDoA server
      await new Promise((r) => setTimeout(r, 3000));
    }

    setIsRunning(false);
    setCurrentIdx(-1);
    setShowComparison(true);
    toast.success("Batch complete — view comparison results");

    // Browser notification for background tabs
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      const completedCount = items.filter((i) => i.status === "complete").length;
      new Notification("TDoA Batch Complete", {
        body: `${completedCount}/${items.length} runs completed successfully`,
        icon: "/favicon.ico",
        tag: "tdoa-batch-done",
      });
    }
  }, [items, selectedHosts, submitMutation]);

  // Cancel the batch
  const cancelBatch = useCallback(() => {
    setIsRunning(false);
    setCurrentIdx(-1);
    setItems((prev) =>
      prev.map((i) => (i.status === "running" ? { ...i, status: "error", error: "Cancelled" } : i))
    );
    toast.info("Batch cancelled");
  }, []);

  // Completed items for comparison
  const completedItems = useMemo(
    () => items.filter((i) => i.status === "complete" && i.result),
    [items]
  );

  // Calculate spread (distance between positions)
  const positionSpread = useMemo(() => {
    if (completedItems.length < 2) return null;
    let maxDist = 0;
    for (let i = 0; i < completedItems.length; i++) {
      for (let j = i + 1; j < completedItems.length; j++) {
        const a = completedItems[i].result!;
        const b = completedItems[j].result!;
        const dLat = a.likelyLat - b.likelyLat;
        const dLon = a.likelyLon - b.likelyLon;
        const dist = Math.sqrt(dLat * dLat + dLon * dLon) * 111; // rough km
        if (dist > maxDist) maxDist = dist;
      }
    }
    return maxDist;
  }, [completedItems]);

  // Average position
  const avgPosition = useMemo(() => {
    if (completedItems.length === 0) return null;
    const sumLat = completedItems.reduce((s, i) => s + i.result!.likelyLat, 0);
    const sumLon = completedItems.reduce((s, i) => s + i.result!.likelyLon, 0);
    return {
      lat: sumLat / completedItems.length,
      lon: sumLon / completedItems.length,
    };
  }, [completedItems]);

  const queuedCount = items.filter((i) => i.status === "queued").length;

  return (
    <div className="space-y-3">
      {/* Queue Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold text-white/70 uppercase tracking-wider flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-violet-400" />
          Batch Queue ({items.length})
        </h4>
        <div className="flex items-center gap-2">
          {/* Presets dropdown */}
          <div className="relative">
            <button
              onClick={() => setPresetsOpen(!presetsOpen)}
              disabled={isRunning || disabled}
              className="text-[9px] text-violet-400 hover:text-violet-300 disabled:opacity-40 transition-colors"
            >
              Presets {presetsOpen ? "▲" : "▼"}
            </button>
            <AnimatePresence>
              {presetsOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="absolute right-0 top-5 z-50 w-48 rounded-lg bg-black/90 border border-white/15 shadow-xl"
                >
                  {BATCH_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => loadPreset(preset)}
                      className="w-full text-left px-3 py-2 text-[10px] text-white/70 hover:bg-white/10 transition-colors border-b border-white/5 last:border-0"
                    >
                      <span className="font-medium">{preset.label}</span>
                      <span className="text-white/30 ml-1">({preset.items.length})</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <button
            onClick={() => setShowAdd(!showAdd)}
            disabled={isRunning || disabled}
            className="flex items-center gap-1 text-[9px] text-violet-400 hover:text-violet-300 disabled:opacity-40 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </div>
      </div>

      {/* Add Item Form */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-lg bg-white/5 border border-white/10 p-3 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[9px] text-white/40 block mb-0.5">Freq (kHz)</label>
                  <input
                    type="number"
                    value={newFreq}
                    onChange={(e) => setNewFreq(e.target.value)}
                    className="w-full px-2 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white/80 focus:outline-none focus:border-violet-500/40"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-white/40 block mb-0.5">PB (Hz)</label>
                  <input
                    type="number"
                    value={newPb}
                    onChange={(e) => setNewPb(e.target.value)}
                    className="w-full px-2 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white/80 focus:outline-none focus:border-violet-500/40"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-white/40 block mb-0.5">Time (s)</label>
                  <select
                    value={newSample}
                    onChange={(e) => setNewSample(Number(e.target.value))}
                    className="w-full px-2 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white/80 focus:outline-none focus:border-violet-500/40"
                  >
                    <option value={15}>15s</option>
                    <option value={30}>30s</option>
                    <option value={45}>45s</option>
                    <option value={60}>60s</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[9px] text-white/40 block mb-0.5">Label (optional)</label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={`${newFreq} kHz`}
                  className="w-full px-2 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white/80 placeholder-white/20 focus:outline-none focus:border-violet-500/40"
                />
              </div>
              <button
                onClick={addItem}
                className="w-full py-1.5 text-[10px] font-medium text-violet-300 bg-violet-500/15 border border-violet-500/25 rounded hover:bg-violet-500/25 transition-colors"
              >
                Add to Queue
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Queue Items */}
      {items.length > 0 && (
        <div className="space-y-1">
          {items.map((item, idx) => (
            <div
              key={item.id}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors ${
                item.status === "running"
                  ? "bg-violet-500/10 border-violet-500/25"
                  : item.status === "complete"
                    ? "bg-green-500/10 border-green-500/20"
                    : item.status === "error"
                      ? "bg-red-500/10 border-red-500/20"
                      : "bg-white/5 border-white/10"
              }`}
            >
              {/* Status icon */}
              <div className="shrink-0">
                {item.status === "queued" && (
                  <span className="text-[10px] font-mono text-white/30">#{idx + 1}</span>
                )}
                {item.status === "running" && (
                  <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin" />
                )}
                {item.status === "complete" && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                )}
                {item.status === "error" && (
                  <XCircle className="w-3.5 h-3.5 text-red-400" />
                )}
              </div>

              {/* Item info */}
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium text-white/80 truncate">{item.label}</p>
                <p className="text-[9px] font-mono text-white/35">
                  {item.frequencyKhz} kHz · PB {item.passbandHz} Hz · {item.sampleTime}s
                  {item.result && (
                    <span className="text-green-400/70 ml-1">
                      → {item.result.likelyLat.toFixed(2)}°, {item.result.likelyLon.toFixed(2)}°
                    </span>
                  )}
                  {item.error && (
                    <span className="text-red-400/70 ml-1">— {item.error}</span>
                  )}
                </p>
              </div>

              {/* Actions */}
              {item.status === "queued" && !isRunning && (
                <button
                  onClick={() => removeItem(item.id)}
                  className="shrink-0 w-5 h-5 rounded bg-white/5 flex items-center justify-center hover:bg-red-500/20 transition-colors"
                >
                  <Trash2 className="w-3 h-3 text-white/40 hover:text-red-400" />
                </button>
              )}
              {item.status === "complete" && item.result && onShowResult && (
                <button
                  onClick={() =>
                    onShowResult({
                      likelyLat: item.result!.likelyLat,
                      likelyLon: item.result!.likelyLon,
                      hosts: selectedHosts.map((h) => ({ lat: h.lat, lon: h.lon, h: h.h })),
                      contours: [],
                      jobId: item.jobId || item.id,
                    })
                  }
                  className="shrink-0 text-[9px] text-violet-400 hover:text-violet-300"
                >
                  <MapPin className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Batch Actions */}
      {items.length > 0 && (
        <div className="flex gap-2">
          {isRunning ? (
            <button
              onClick={cancelBatch}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-medium text-red-300 bg-red-500/15 border border-red-500/25 rounded-lg hover:bg-red-500/25 transition-colors"
            >
              <Square className="w-3 h-3" />
              Cancel Batch
            </button>
          ) : (
            <>
              <button
                onClick={runBatch}
                disabled={queuedCount === 0 || selectedHosts.length < 2 || disabled}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-medium text-violet-300 bg-violet-500/15 border border-violet-500/25 rounded-lg hover:bg-violet-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Play className="w-3 h-3" />
                Run Batch ({queuedCount})
              </button>
              {completedItems.length >= 2 && (
                <button
                  onClick={() => setShowComparison(!showComparison)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 text-[10px] font-medium text-amber-300 bg-amber-500/15 border border-amber-500/25 rounded-lg hover:bg-amber-500/25 transition-colors"
                >
                  <BarChart3 className="w-3 h-3" />
                  Compare
                </button>
              )}
              <button
                onClick={() => {
                  setItems([]);
                  setShowComparison(false);
                }}
                className="flex items-center justify-center px-3 py-2 text-[10px] text-white/40 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors"
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}

      {/* Comparison View */}
      <AnimatePresence>
        {showComparison && completedItems.length >= 2 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="w-4 h-4 text-amber-400" />
                <span className="text-[11px] font-semibold text-amber-300">
                  Cross-Band Comparison
                </span>
              </div>

              {/* Position table */}
              <div className="rounded border border-white/10 overflow-hidden mb-2">
                <table className="w-full text-[9px]">
                  <thead>
                    <tr className="bg-white/5">
                      <th className="text-left px-2 py-1 text-white/50 font-medium">Frequency</th>
                      <th className="text-right px-2 py-1 text-white/50 font-medium">Lat</th>
                      <th className="text-right px-2 py-1 text-white/50 font-medium">Lon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completedItems.map((item) => (
                      <tr key={item.id} className="border-t border-white/5">
                        <td className="px-2 py-1 text-white/70 font-mono">{item.label}</td>
                        <td className="px-2 py-1 text-right text-white/60 font-mono">
                          {item.result!.likelyLat.toFixed(4)}°
                        </td>
                        <td className="px-2 py-1 text-right text-white/60 font-mono">
                          {item.result!.likelyLon.toFixed(4)}°
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary stats */}
              <div className="grid grid-cols-2 gap-2">
                {avgPosition && (
                  <div className="rounded bg-white/5 p-2">
                    <p className="text-[8px] text-white/40 uppercase tracking-wider mb-0.5">
                      Average Position
                    </p>
                    <p className="text-[10px] font-mono text-white/80">
                      {avgPosition.lat.toFixed(4)}°, {avgPosition.lon.toFixed(4)}°
                    </p>
                  </div>
                )}
                {positionSpread !== null && (
                  <div className="rounded bg-white/5 p-2">
                    <p className="text-[8px] text-white/40 uppercase tracking-wider mb-0.5">
                      Max Spread
                    </p>
                    <p className="text-[10px] font-mono text-white/80">
                      {positionSpread.toFixed(1)} km
                      <span className="text-white/40 ml-1">
                        {positionSpread < 50
                          ? "(excellent)"
                          : positionSpread < 200
                            ? "(good)"
                            : "(wide)"}
                      </span>
                    </p>
                  </div>
                )}
              </div>

              {/* Show average on globe */}
              {avgPosition && onShowResult && (
                <button
                  onClick={() =>
                    onShowResult({
                      likelyLat: avgPosition.lat,
                      likelyLon: avgPosition.lon,
                      hosts: selectedHosts.map((h) => ({ lat: h.lat, lon: h.lon, h: h.h })),
                      contours: [],
                      jobId: "batch-avg",
                    })
                  }
                  className="w-full mt-2 py-1.5 text-[10px] font-medium text-amber-300 bg-amber-500/15 border border-amber-500/25 rounded hover:bg-amber-500/25 transition-colors flex items-center justify-center gap-1.5"
                >
                  <MapPin className="w-3 h-3" />
                  Show Average Position on Globe
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state */}
      {items.length === 0 && (
        <div className="rounded-lg bg-white/[0.02] border border-dashed border-white/10 p-3 text-center">
          <Layers className="w-4 h-4 text-white/15 mx-auto mb-1" />
          <p className="text-[10px] text-white/30">
            Queue multiple frequencies to compare TDoA results across bands
          </p>
          <p className="text-[9px] text-white/20 mt-0.5">
            Use presets or add custom frequencies
          </p>
        </div>
      )}
    </div>
  );
}
