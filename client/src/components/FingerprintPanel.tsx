/**
 * FingerprintPanel.tsx — Signal fingerprinting and pattern matching UI
 *
 * Allows users to:
 * - Extract fingerprints from recordings
 * - View stored fingerprints for targets
 * - Find matching targets based on signal similarity
 * - Auto-link new TDoA results to existing targets
 */
import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Fingerprint,
  Search,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Trash2,
  Zap,
  Target,
  BarChart3,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { extractFingerprint, type SignalFingerprint } from "@/lib/fingerprintExtractor";
import { toast } from "sonner";

interface FingerprintPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Currently selected target ID for fingerprint operations */
  targetId?: number;
  /** Recording URL to fingerprint */
  recordingUrl?: string;
  recordingId?: number;
  historyEntryId?: number;
  frequencyKhz?: number;
  mode?: string;
}

export default function FingerprintPanel({
  isOpen,
  onClose,
  targetId,
  recordingUrl,
  recordingId,
  historyEntryId,
  frequencyKhz,
  mode,
}: FingerprintPanelProps) {
  const [extracting, setExtracting] = useState(false);
  const [extractedFp, setExtractedFp] = useState<SignalFingerprint | null>(null);
  const [matching, setMatching] = useState(false);
  const [expandedFpId, setExpandedFpId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  // Get fingerprints for the current target
  const fingerprintsQuery = trpc.fingerprints.byTarget.useQuery(
    { targetId: targetId ?? 0 },
    { enabled: isOpen && !!targetId }
  );

  // Find matches mutation
  const findMatchesQuery = trpc.fingerprints.findMatches.useQuery(
    {
      featureVector: extractedFp?.featureVector ?? [],
      frequencyKhz,
      threshold: 0.7,
      limit: 10,
    },
    { enabled: matching && !!extractedFp }
  );

  const createFpMut = trpc.fingerprints.create.useMutation({
    onSuccess: () => {
      utils.fingerprints.byTarget.invalidate();
      toast.success("Fingerprint saved");
    },
    onError: (err) => {
      toast.error(`Failed to save: ${err.message}`);
    },
  });

  const deleteFpMut = trpc.fingerprints.delete.useMutation({
    onSuccess: () => {
      utils.fingerprints.byTarget.invalidate();
      toast.success("Fingerprint deleted");
    },
  });

  const handleExtract = useCallback(async () => {
    if (!recordingUrl) {
      toast.error("No recording URL available");
      return;
    }
    setExtracting(true);
    setExtractedFp(null);
    setMatching(false);
    try {
      const fp = await extractFingerprint(recordingUrl);
      setExtractedFp(fp);
      toast.success("Fingerprint extracted");
    } catch (err: any) {
      toast.error(`Extraction failed: ${err.message}`);
    } finally {
      setExtracting(false);
    }
  }, [recordingUrl]);

  const handleSaveFingerprint = useCallback(() => {
    if (!extractedFp || !targetId || !recordingId) {
      toast.error("Missing target or recording");
      return;
    }
    createFpMut.mutate({
      targetId,
      recordingId,
      historyEntryId,
      frequencyKhz,
      mode,
      spectralPeaks: extractedFp.spectralPeaks,
      bandwidthHz: extractedFp.bandwidthHz,
      dominantFreqHz: extractedFp.dominantFreqHz,
      spectralCentroid: extractedFp.spectralCentroid,
      spectralFlatness: extractedFp.spectralFlatness,
      rmsLevel: extractedFp.rmsLevel,
      featureVector: extractedFp.featureVector,
    });
  }, [extractedFp, targetId, recordingId, historyEntryId, frequencyKhz, mode, createFpMut]);

  const handleFindMatches = useCallback(() => {
    if (!extractedFp) {
      toast.error("Extract a fingerprint first");
      return;
    }
    setMatching(true);
  }, [extractedFp]);

  const fingerprints = fingerprintsQuery.data ?? [];
  const matches = findMatchesQuery.data ?? [];

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="w-[520px] max-h-[80vh] bg-gray-900/98 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-2xl shadow-purple-500/10 flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Fingerprint className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-semibold text-white tracking-wide uppercase">
                Signal Fingerprint
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-white/40 hover:text-white rounded-lg transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Extract section */}
            <div className="bg-purple-500/5 border border-purple-500/15 rounded-lg p-3">
              <h3 className="text-xs font-semibold text-purple-300 mb-2 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5" />
                Extract Fingerprint
              </h3>
              {recordingUrl ? (
                <div className="space-y-2">
                  <div className="text-[10px] text-white/40 font-mono truncate">
                    {recordingUrl.split("/").pop()}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleExtract}
                      disabled={extracting}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-md text-[11px] font-medium transition-colors disabled:opacity-50"
                    >
                      {extracting ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <Fingerprint className="w-3 h-3" />
                          Extract
                        </>
                      )}
                    </button>
                    {extractedFp && (
                      <>
                        <button
                          onClick={handleSaveFingerprint}
                          disabled={!targetId || createFpMut.isPending}
                          className="flex items-center gap-1 px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-300 rounded-md text-[11px] font-medium transition-colors disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          Save
                        </button>
                        <button
                          onClick={handleFindMatches}
                          className="flex items-center gap-1 px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 rounded-md text-[11px] font-medium transition-colors"
                        >
                          <Search className="w-3 h-3" />
                          Find Matches
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-white/30">
                  No recording selected. Record audio from a TDoA job first.
                </p>
              )}
            </div>

            {/* Extracted fingerprint details */}
            {extractedFp && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                className="bg-white/[0.03] border border-white/5 rounded-lg p-3"
              >
                <h3 className="text-xs font-semibold text-white/70 mb-2 flex items-center gap-1.5">
                  <BarChart3 className="w-3.5 h-3.5" />
                  Extracted Features
                </h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-white/40">Dominant Freq</span>
                    <span className="text-white/70 font-mono">
                      {extractedFp.dominantFreqHz.toFixed(1)} Hz
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-white/40">Bandwidth</span>
                    <span className="text-white/70 font-mono">
                      {extractedFp.bandwidthHz.toFixed(1)} Hz
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-white/40">Centroid</span>
                    <span className="text-white/70 font-mono">
                      {extractedFp.spectralCentroid.toFixed(1)} Hz
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-white/40">Flatness</span>
                    <span className="text-white/70 font-mono">
                      {extractedFp.spectralFlatness.toFixed(4)}
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-white/40">RMS Level</span>
                    <span className="text-white/70 font-mono">
                      {extractedFp.rmsLevel.toFixed(1)} dB
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-white/40">Peaks</span>
                    <span className="text-white/70 font-mono">
                      {extractedFp.spectralPeaks.length}
                    </span>
                  </div>
                </div>
                {extractedFp.spectralPeaks.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-white/5">
                    <div className="text-[10px] text-white/40 mb-1">Top Spectral Peaks:</div>
                    <div className="flex flex-wrap gap-1">
                      {extractedFp.spectralPeaks.slice(0, 6).map((freq, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 bg-purple-500/10 border border-purple-500/20 rounded text-[9px] text-purple-300 font-mono"
                        >
                          {freq.toFixed(0)} Hz
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-2 pt-2 border-t border-white/5">
                  <div className="text-[10px] text-white/40 mb-1">
                    Feature Vector ({extractedFp.featureVector.length}D):
                  </div>
                  <div className="flex gap-px h-6">
                    {extractedFp.featureVector.map((v, i) => (
                      <div
                        key={i}
                        className="flex-1 bg-purple-500 rounded-sm"
                        style={{
                          opacity: Math.max(0.1, Math.abs(v)),
                          height: `${Math.max(10, Math.abs(v) * 100)}%`,
                          alignSelf: "flex-end",
                        }}
                        title={`dim[${i}]: ${v.toFixed(4)}`}
                      />
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Match results */}
            {matching && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                className="bg-cyan-500/5 border border-cyan-500/15 rounded-lg p-3"
              >
                <h3 className="text-xs font-semibold text-cyan-300 mb-2 flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5" />
                  Matching Targets
                </h3>
                {findMatchesQuery.isLoading ? (
                  <div className="flex items-center gap-2 py-3 justify-center text-white/40">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-xs">Searching...</span>
                  </div>
                ) : matches.length === 0 ? (
                  <div className="flex flex-col items-center py-4 text-white/30">
                    <AlertCircle className="w-6 h-6 mb-1" />
                    <p className="text-xs">No matching fingerprints found</p>
                    <p className="text-[10px] mt-0.5">
                      Try lowering the threshold or adding more fingerprints
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {matches.map((match, i) => (
                      <div
                        key={match.fingerprintId}
                        className="flex items-center gap-2 px-2 py-1.5 bg-white/[0.03] rounded-lg"
                      >
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            match.similarity >= 0.95
                              ? "bg-green-500/20 text-green-400"
                              : match.similarity >= 0.85
                              ? "bg-cyan-500/20 text-cyan-400"
                              : "bg-yellow-500/20 text-yellow-400"
                          }`}
                        >
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <Target className="w-3 h-3 text-white/40" />
                            <span className="text-[11px] text-white/80 font-medium truncate">
                              {match.targetLabel}
                            </span>
                            <span className="text-[9px] text-white/30 px-1 py-0.5 bg-white/5 rounded">
                              {match.targetCategory}
                            </span>
                          </div>
                          {match.frequencyKhz && (
                            <span className="text-[9px] text-white/30 font-mono">
                              {match.frequencyKhz} kHz {match.mode && `· ${match.mode}`}
                            </span>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div
                            className={`text-xs font-bold font-mono ${
                              match.similarity >= 0.95
                                ? "text-green-400"
                                : match.similarity >= 0.85
                                ? "text-cyan-400"
                                : "text-yellow-400"
                            }`}
                          >
                            {(match.similarity * 100).toFixed(1)}%
                          </div>
                          <div className="text-[9px] text-white/30">similarity</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {/* Stored fingerprints for this target */}
            {targetId && (
              <div>
                <h3 className="text-xs font-semibold text-white/50 mb-2 flex items-center gap-1.5">
                  <Fingerprint className="w-3.5 h-3.5" />
                  Stored Fingerprints ({fingerprints.length})
                </h3>
                {fingerprints.length === 0 ? (
                  <p className="text-[11px] text-white/30 text-center py-3">
                    No fingerprints stored for this target yet
                  </p>
                ) : (
                  <div className="space-y-1">
                    {fingerprints.map((fp) => {
                      const isExpanded = expandedFpId === fp.id;
                      return (
                        <div
                          key={fp.id}
                          className="bg-white/[0.03] border border-white/5 rounded-lg overflow-hidden"
                        >
                          <div
                            className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-white/5 transition-colors"
                            onClick={() => setExpandedFpId(isExpanded ? null : fp.id)}
                          >
                            <Fingerprint className="w-3 h-3 text-purple-400 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 text-[10px]">
                                <span className="text-white/60 font-mono">
                                  {fp.frequencyKhz ? `${fp.frequencyKhz} kHz` : "—"}
                                </span>
                                {fp.mode && (
                                  <span className="text-white/30">{fp.mode}</span>
                                )}
                                <span className="text-white/20">·</span>
                                <span className="text-white/30">
                                  {new Date(Number(fp.createdAt)).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm("Delete this fingerprint?")) {
                                  deleteFpMut.mutate({ id: fp.id });
                                }
                              }}
                              className="p-1 text-white/20 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                            {isExpanded ? (
                              <ChevronUp className="w-3 h-3 text-white/30" />
                            ) : (
                              <ChevronDown className="w-3 h-3 text-white/30" />
                            )}
                          </div>
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="border-t border-white/5 px-2 py-2"
                              >
                                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                                  <div className="flex justify-between">
                                    <span className="text-white/30">Dominant</span>
                                    <span className="text-white/60 font-mono">
                                      {fp.dominantFreqHz?.toFixed(1) ?? "—"} Hz
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-white/30">Bandwidth</span>
                                    <span className="text-white/60 font-mono">
                                      {fp.bandwidthHz?.toFixed(1) ?? "—"} Hz
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-white/30">Centroid</span>
                                    <span className="text-white/60 font-mono">
                                      {fp.spectralCentroid?.toFixed(1) ?? "—"} Hz
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-white/30">Flatness</span>
                                    <span className="text-white/60 font-mono">
                                      {fp.spectralFlatness?.toFixed(4) ?? "—"}
                                    </span>
                                  </div>
                                </div>
                                {Array.isArray(fp.featureVector) ? (
                                  <div className="mt-1.5 pt-1.5 border-t border-white/5">
                                    <div className="text-[9px] text-white/30 mb-0.5">
                                      Feature Vector:
                                    </div>
                                    <div className="flex gap-px h-4">
                                      {(fp.featureVector as number[]).map((v: number, i: number) => (
                                        <div
                                          key={i}
                                          className="flex-1 bg-purple-500 rounded-sm"
                                          style={{
                                            opacity: Math.max(0.1, Math.abs(v)),
                                            height: `${Math.max(10, Math.abs(v) * 100)}%`,
                                            alignSelf: "flex-end",
                                          }}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-white/5 text-[10px] text-white/30 text-center">
            Signal fingerprints enable automatic target identification across TDoA sessions
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
