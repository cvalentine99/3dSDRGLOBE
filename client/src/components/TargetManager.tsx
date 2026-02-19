/**
 * TargetManager.tsx — Multi-target TDoA tracking panel
 *
 * Allows users to:
 * 1. View all saved TDoA target positions
 * 2. Toggle visibility of individual targets on the globe
 * 3. Edit target labels, colors, and notes
 * 4. Delete targets
 * 5. Save new targets from TDoA results
 *
 * Targets are persisted in the database and rendered as colored
 * markers on the 3D globe overlay.
 */
import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Target,
  Eye,
  EyeOff,
  Trash2,
  Edit3,
  Check,
  MapPin,
  Radio,
  Plus,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/* ── Types ────────────────────────────────────────── */

export interface SavedTarget {
  id: number;
  label: string;
  lat: string;
  lon: string;
  frequencyKhz: string | null;
  color: string;
  notes: string | null;
  sourceJobId: number | null;
  visible: boolean;
  createdAt: number;
}

interface TargetManagerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Callback to focus globe camera on a target */
  onFocusTarget?: (lat: number, lon: number) => void;
}

/* ── Color Palette ────────────────────────────────── */

const TARGET_COLORS = [
  "#ff6b6b", // red
  "#fbbf24", // amber
  "#4ade80", // green
  "#06b6d4", // cyan
  "#a78bfa", // violet
  "#f472b6", // pink
  "#fb923c", // orange
  "#38bdf8", // sky
] as const;

/* ── Component ────────────────────────────────────── */

export default function TargetManager({ isOpen, onClose, onFocusTarget }: TargetManagerProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editColor, setEditColor] = useState("#ff6b6b");
  const [editNotes, setEditNotes] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Manual add form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addLat, setAddLat] = useState("");
  const [addLon, setAddLon] = useState("");
  const [addFreq, setAddFreq] = useState("");
  const [addColor, setAddColor] = useState("#ff6b6b");
  const [addNotes, setAddNotes] = useState("");

  // Fetch all targets
  const targetsQuery = trpc.targets.list.useQuery(undefined, {
    enabled: isOpen,
    refetchInterval: 10000,
  });

  const utils = trpc.useUtils();

  // Mutations
  const toggleMutation = trpc.targets.toggleVisibility.useMutation({
    onSuccess: () => utils.targets.list.invalidate(),
  });

  const updateMutation = trpc.targets.update.useMutation({
    onSuccess: () => {
      utils.targets.list.invalidate();
      setEditingId(null);
      toast.success("Target updated");
    },
    onError: (err) => toast.error(`Update failed: ${err.message}`),
  });

  const deleteMutation = trpc.targets.delete.useMutation({
    onSuccess: () => {
      utils.targets.list.invalidate();
      toast.success("Target deleted");
    },
    onError: (err) => toast.error(`Delete failed: ${err.message}`),
  });

  const saveMutation = trpc.targets.save.useMutation({
    onSuccess: () => {
      utils.targets.list.invalidate();
      setShowAddForm(false);
      setAddLabel("");
      setAddLat("");
      setAddLon("");
      setAddFreq("");
      setAddColor("#ff6b6b");
      setAddNotes("");
      toast.success("Target saved");
    },
    onError: (err) => toast.error(`Save failed: ${err.message}`),
  });

  const handleToggle = useCallback(
    (id: number, currentVisible: boolean) => {
      toggleMutation.mutate({ id, visible: !currentVisible });
    },
    [toggleMutation]
  );

  const handleStartEdit = useCallback((target: SavedTarget) => {
    setEditingId(target.id);
    setEditLabel(target.label);
    setEditColor(target.color);
    setEditNotes(target.notes || "");
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId || !editLabel.trim()) return;
    updateMutation.mutate({
      id: editingId,
      label: editLabel.trim(),
      color: editColor,
      notes: editNotes.trim() || undefined,
    });
  }, [editingId, editLabel, editColor, editNotes, updateMutation]);

  const handleDelete = useCallback(
    (id: number) => {
      if (confirm("Delete this target?")) {
        deleteMutation.mutate({ id });
      }
    },
    [deleteMutation]
  );

  const handleAddManual = useCallback(() => {
    const lat = parseFloat(addLat);
    const lon = parseFloat(addLon);
    if (!addLabel.trim() || isNaN(lat) || isNaN(lon)) {
      toast.error("Label, latitude, and longitude are required");
      return;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      toast.error("Invalid coordinates");
      return;
    }
    saveMutation.mutate({
      label: addLabel.trim(),
      lat,
      lon,
      frequencyKhz: addFreq ? parseFloat(addFreq) : undefined,
      color: addColor,
      notes: addNotes.trim() || undefined,
    });
  }, [addLabel, addLat, addLon, addFreq, addColor, addNotes, saveMutation]);

  const targets = (targetsQuery.data || []) as SavedTarget[];
  const visibleCount = targets.filter((t) => t.visible).length;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: "-100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "-100%", opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="fixed top-0 left-0 bottom-0 w-[380px] max-w-[90vw] z-50 flex flex-col"
        >
          {/* Glass background */}
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xl border-r border-white/10" />

          {/* Content */}
          <div className="relative flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center">
                  <Target className="w-5 h-5 text-rose-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Saved Targets</h2>
                  <p className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                    {targets.length} targets · {visibleCount} visible
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAddForm(!showAddForm)}
                  title="Add target manually"
                  className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${
                    showAddForm
                      ? "bg-rose-500/20 border-rose-500/30 text-rose-400"
                      : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white/60"
                  }`}
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4 text-white/60" />
                </button>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 scrollbar-thin">
              {/* Manual Add Form */}
              <AnimatePresence>
                {showAddForm && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-lg bg-white/5 border border-white/10 p-4 space-y-3">
                      <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-rose-400" />
                        Add Target Manually
                      </h3>

                      <input
                        type="text"
                        placeholder="Label (e.g. Unknown TX)"
                        value={addLabel}
                        onChange={(e) => setAddLabel(e.target.value)}
                        className="w-full px-3 py-2 rounded-md bg-black/40 border border-white/10 text-white text-xs font-mono placeholder:text-white/30 focus:outline-none focus:border-rose-500/40"
                      />

                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          placeholder="Latitude"
                          value={addLat}
                          onChange={(e) => setAddLat(e.target.value)}
                          className="px-3 py-2 rounded-md bg-black/40 border border-white/10 text-white text-xs font-mono placeholder:text-white/30 focus:outline-none focus:border-rose-500/40"
                        />
                        <input
                          type="number"
                          placeholder="Longitude"
                          value={addLon}
                          onChange={(e) => setAddLon(e.target.value)}
                          className="px-3 py-2 rounded-md bg-black/40 border border-white/10 text-white text-xs font-mono placeholder:text-white/30 focus:outline-none focus:border-rose-500/40"
                        />
                      </div>

                      <input
                        type="number"
                        placeholder="Frequency (kHz) — optional"
                        value={addFreq}
                        onChange={(e) => setAddFreq(e.target.value)}
                        className="w-full px-3 py-2 rounded-md bg-black/40 border border-white/10 text-white text-xs font-mono placeholder:text-white/30 focus:outline-none focus:border-rose-500/40"
                      />

                      <textarea
                        placeholder="Notes — optional"
                        value={addNotes}
                        onChange={(e) => setAddNotes(e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 rounded-md bg-black/40 border border-white/10 text-white text-xs font-mono placeholder:text-white/30 focus:outline-none focus:border-rose-500/40 resize-none"
                      />

                      {/* Color picker */}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-white/40 uppercase tracking-wider">Color:</span>
                        <div className="flex gap-1.5">
                          {TARGET_COLORS.map((c) => (
                            <button
                              key={c}
                              onClick={() => setAddColor(c)}
                              className={`w-5 h-5 rounded-full border-2 transition-all ${
                                addColor === c
                                  ? "border-white scale-110"
                                  : "border-transparent hover:border-white/40"
                              }`}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                      </div>

                      <button
                        onClick={handleAddManual}
                        disabled={saveMutation.isPending}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-medium hover:bg-rose-500/30 disabled:opacity-40 transition-colors"
                      >
                        {saveMutation.isPending ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Plus className="w-3.5 h-3.5" />
                        )}
                        Save Target
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Target List */}
              {targetsQuery.isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
                </div>
              ) : targets.length === 0 ? (
                <div className="rounded-lg bg-white/5 border border-dashed border-white/10 p-8 text-center">
                  <Target className="w-8 h-8 text-white/15 mx-auto mb-3" />
                  <p className="text-xs text-white/40 mb-1">No saved targets yet</p>
                  <p className="text-[10px] text-white/25">
                    Complete a TDoA run and save the result, or add a target manually
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {targets.map((target) => {
                    const isEditing = editingId === target.id;
                    const isExpanded = expandedId === target.id;
                    const lat = parseFloat(target.lat);
                    const lon = parseFloat(target.lon);

                    return (
                      <motion.div
                        key={target.id}
                        layout
                        className={`rounded-lg border transition-colors ${
                          target.visible
                            ? "bg-white/5 border-white/10"
                            : "bg-white/[0.02] border-white/5 opacity-60"
                        }`}
                      >
                        {/* Main row */}
                        <div className="flex items-center gap-3 px-3 py-2.5">
                          {/* Color dot */}
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: target.color }}
                          />

                          {/* Label + coords */}
                          <div
                            className="flex-1 min-w-0 cursor-pointer"
                            onClick={() => {
                              setExpandedId(isExpanded ? null : target.id);
                            }}
                          >
                            {isEditing ? (
                              <input
                                type="text"
                                value={editLabel}
                                onChange={(e) => setEditLabel(e.target.value)}
                                className="w-full px-2 py-1 rounded bg-black/40 border border-white/10 text-white text-xs font-mono focus:outline-none focus:border-rose-500/40"
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <>
                                <p className="text-xs font-medium text-white truncate">
                                  {target.label}
                                </p>
                                <p className="text-[10px] font-mono text-white/40">
                                  {lat.toFixed(3)}°, {lon.toFixed(3)}°
                                  {target.frequencyKhz && (
                                    <span className="ml-2 text-amber-400/60">
                                      {parseFloat(target.frequencyKhz)} kHz
                                    </span>
                                  )}
                                </p>
                              </>
                            )}
                          </div>

                          {/* Action buttons */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {isEditing ? (
                              <button
                                onClick={handleSaveEdit}
                                disabled={updateMutation.isPending}
                                className="w-7 h-7 rounded flex items-center justify-center text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                                title="Save changes"
                              >
                                {updateMutation.isPending ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Check className="w-3.5 h-3.5" />
                                )}
                              </button>
                            ) : (
                              <>
                                {/* Focus on globe */}
                                <button
                                  onClick={() => onFocusTarget?.(lat, lon)}
                                  className="w-7 h-7 rounded flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
                                  title="Focus on globe"
                                >
                                  <MapPin className="w-3.5 h-3.5" />
                                </button>

                                {/* Toggle visibility */}
                                <button
                                  onClick={() => handleToggle(target.id, target.visible)}
                                  className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
                                    target.visible
                                      ? "text-white/60 hover:text-white/80 hover:bg-white/5"
                                      : "text-white/20 hover:text-white/40 hover:bg-white/5"
                                  }`}
                                  title={target.visible ? "Hide on globe" : "Show on globe"}
                                >
                                  {target.visible ? (
                                    <Eye className="w-3.5 h-3.5" />
                                  ) : (
                                    <EyeOff className="w-3.5 h-3.5" />
                                  )}
                                </button>

                                {/* Edit */}
                                <button
                                  onClick={() => handleStartEdit(target)}
                                  className="w-7 h-7 rounded flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
                                  title="Edit target"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>

                                {/* Delete */}
                                <button
                                  onClick={() => handleDelete(target.id)}
                                  className="w-7 h-7 rounded flex items-center justify-center text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                  title="Delete target"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}

                            {/* Expand/collapse */}
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : target.id)}
                              className="w-7 h-7 rounded flex items-center justify-center text-white/20 hover:text-white/40 transition-colors"
                            >
                              {isExpanded ? (
                                <ChevronUp className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Expanded details */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="px-3 pb-3 pt-1 border-t border-white/5 space-y-2">
                                {/* Color picker (when editing) */}
                                {isEditing && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-white/40 uppercase tracking-wider">
                                      Color:
                                    </span>
                                    <div className="flex gap-1.5">
                                      {TARGET_COLORS.map((c) => (
                                        <button
                                          key={c}
                                          onClick={() => setEditColor(c)}
                                          className={`w-4 h-4 rounded-full border-2 transition-all ${
                                            editColor === c
                                              ? "border-white scale-110"
                                              : "border-transparent hover:border-white/40"
                                          }`}
                                          style={{ backgroundColor: c }}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Notes */}
                                {isEditing ? (
                                  <textarea
                                    value={editNotes}
                                    onChange={(e) => setEditNotes(e.target.value)}
                                    placeholder="Notes..."
                                    rows={2}
                                    className="w-full px-2 py-1.5 rounded bg-black/40 border border-white/10 text-white text-[11px] font-mono placeholder:text-white/20 focus:outline-none focus:border-rose-500/40 resize-none"
                                  />
                                ) : target.notes ? (
                                  <p className="text-[11px] text-white/40 italic">{target.notes}</p>
                                ) : null}

                                {/* Metadata */}
                                <div className="flex items-center gap-3 text-[10px] font-mono text-white/30">
                                  <span>ID: {target.id}</span>
                                  {target.sourceJobId && (
                                    <span className="flex items-center gap-1">
                                      <Radio className="w-3 h-3" />
                                      Job #{target.sourceJobId}
                                    </span>
                                  )}
                                  <span>
                                    {new Date(target.createdAt).toLocaleDateString()}
                                  </span>
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
