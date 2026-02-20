/**
 * TargetManager.tsx — Multi-target TDoA tracking panel
 *
 * Features:
 * 1. View all saved TDoA target positions
 * 2. Category tagging with LLM auto-classification
 * 3. Filter targets by category
 * 4. Toggle visibility of individual targets on the globe
 * 5. Edit target labels, colors, categories, and notes
 * 6. Delete targets
 * 7. Position history timeline with drift metrics
 * 8. Position prediction with confidence ellipse
 * 9. CSV/KML export and import
 * 10. Add new targets from TDoA results or manually
 */
import { useState, useCallback, useMemo, useRef } from "react";
import { haversineKm, bearingDeg as calcBearing } from "@shared/geo";
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
  Filter,
  Tag,
  Clock,
  TrendingUp,
  Navigation,
  GitBranch,
  Download,
  Upload,
  Brain,
  Crosshair,
  FileText,
  Globe2,
  ArrowRight,
  Sparkles,
  AlertCircle,
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
  category: string;
  notes: string | null;
  sourceJobId: number | null;
  visible: boolean;
  createdAt: number;
}

interface TargetManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onFocusTarget?: (lat: number, lon: number) => void;
}

/* ── Category Config ─────────────────────────────── */

export const CATEGORY_CONFIG: Record<
  string,
  { label: string; icon: string; color: string; defaultColor: string }
> = {
  time_signal: { label: "Time Signal", icon: "⏱", color: "#06b6d4", defaultColor: "#06b6d4" },
  broadcast: { label: "Broadcast", icon: "📻", color: "#4ade80", defaultColor: "#4ade80" },
  utility: { label: "Utility", icon: "⚡", color: "#fbbf24", defaultColor: "#fbbf24" },
  military: { label: "Military", icon: "🎖", color: "#ef4444", defaultColor: "#ef4444" },
  amateur: { label: "Amateur", icon: "📡", color: "#a78bfa", defaultColor: "#a78bfa" },
  unknown: { label: "Unknown", icon: "❓", color: "#94a3b8", defaultColor: "#94a3b8" },
  custom: { label: "Custom", icon: "🏷", color: "#f472b6", defaultColor: "#f472b6" },
};

export const CATEGORIES = Object.keys(CATEGORY_CONFIG);

/* ── Color Palette ────────────────────────────────── */

const TARGET_COLORS = [
  "#ff6b6b", "#fbbf24", "#4ade80", "#06b6d4",
  "#a78bfa", "#f472b6", "#fb923c", "#38bdf8",
] as const;

/* ── Component ────────────────────────────────────── */

export default function TargetManager({ isOpen, onClose, onFocusTarget }: TargetManagerProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editColor, setEditColor] = useState("#ff6b6b");
  const [editCategory, setEditCategory] = useState("unknown");
  const [editNotes, setEditNotes] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [historyTargetId, setHistoryTargetId] = useState<number | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [classifyingId, setClassifyingId] = useState<number | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importFormat, setImportFormat] = useState<"csv" | "kml">("csv");
  const [importData, setImportData] = useState("");
  const [predictionTargetId, setPredictionTargetId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manual add form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addLat, setAddLat] = useState("");
  const [addLon, setAddLon] = useState("");
  const [addFreq, setAddFreq] = useState("");
  const [addColor, setAddColor] = useState("#ff6b6b");
  const [addCategory, setAddCategory] = useState("unknown");
  const [addNotes, setAddNotes] = useState("");

  // Fetch all targets
  const targetsQuery = trpc.targets.list.useQuery(undefined, {
    enabled: isOpen,
    refetchInterval: 10000,
  });

  // Fetch history for expanded target
  const historyQuery = trpc.targets.getHistory.useQuery(
    { targetId: historyTargetId! },
    { enabled: historyTargetId !== null }
  );

  // Fetch prediction for target
  const predictionQuery = trpc.targets.predict.useQuery(
    { targetId: predictionTargetId! },
    { enabled: predictionTargetId !== null }
  );

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
      setAddLabel(""); setAddLat(""); setAddLon(""); setAddFreq("");
      setAddColor("#ff6b6b"); setAddCategory("unknown"); setAddNotes("");
      toast.success("Target saved");
    },
    onError: (err) => toast.error(`Save failed: ${err.message}`),
  });

  const classifyMutation = trpc.targets.classify.useMutation({
    onSuccess: (result, variables) => {
      if (result.category && classifyingId) {
        updateMutation.mutate({
          id: classifyingId,
          category: result.category as any,
          notes: `[AI] ${result.reasoning}${result.knownStation ? ` — ${result.knownStation}` : ""}${result.suggestedLabel ? ` (suggested: ${result.suggestedLabel})` : ""}`,
        });
        toast.success(
          `Classified as ${CATEGORY_CONFIG[result.category]?.label || result.category} (${Math.round(result.confidence * 100)}% confidence)`
        );
      }
      setClassifyingId(null);
    },
    onError: (err) => {
      toast.error(`Classification failed: ${err.message}`);
      setClassifyingId(null);
    },
  });

  const importCsvMutation = trpc.targets.importCsv.useMutation({
    onSuccess: (result) => {
      utils.targets.list.invalidate();
      toast.success(`Imported ${result.imported} targets`);
      if (result.errors.length > 0) {
        toast.warning(`${result.errors.length} rows had errors`);
      }
      setShowImport(false);
      setImportData("");
    },
    onError: (err) => toast.error(`Import failed: ${err.message}`),
  });

  const importKmlMutation = trpc.targets.importKml.useMutation({
    onSuccess: (result) => {
      utils.targets.list.invalidate();
      toast.success(`Imported ${result.imported} targets from KML`);
      if (result.errors.length > 0) {
        toast.warning(`${result.errors.length} placemarks had errors`);
      }
      setShowImport(false);
      setImportData("");
    },
    onError: (err) => toast.error(`KML import failed: ${err.message}`),
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
    setEditCategory(target.category);
    setEditNotes(target.notes || "");
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId || !editLabel.trim()) return;
    updateMutation.mutate({
      id: editingId,
      label: editLabel.trim(),
      color: editColor,
      category: editCategory as any,
      notes: editNotes.trim() || undefined,
    });
  }, [editingId, editLabel, editColor, editCategory, editNotes, updateMutation]);

  const handleDelete = useCallback(
    (id: number) => {
      if (confirm("Delete this target and its position history?")) {
        deleteMutation.mutate({ id });
      }
    },
    [deleteMutation]
  );

  const handleClassify = useCallback(
    (target: SavedTarget) => {
      setClassifyingId(target.id);
      classifyMutation.mutate({
        targetId: target.id,
        frequencyKhz: target.frequencyKhz ? parseFloat(target.frequencyKhz) : undefined,
        lat: parseFloat(target.lat),
        lon: parseFloat(target.lon),
        label: target.label,
        notes: target.notes ?? undefined,
      });
    },
    [classifyMutation]
  );

  const handleExportCsv = useCallback(async () => {
    try {
      const result = await utils.targets.exportCsv.fetch();
      if (!result.csv) {
        toast.error("No targets to export");
        return;
      }
      const blob = new Blob([result.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `radio-globe-targets-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV exported");
    } catch (err) {
      toast.error("Export failed");
    }
  }, [utils]);

  const handleExportKml = useCallback(async () => {
    try {
      const result = await utils.targets.exportKml.fetch();
      if (!result.kml) {
        toast.error("No targets to export");
        return;
      }
      const blob = new Blob([result.kml], { type: "application/vnd.google-earth.kml+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `radio-globe-targets-${new Date().toISOString().slice(0, 10)}.kml`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("KML exported — open in Google Earth");
    } catch (err) {
      toast.error("Export failed");
    }
  }, [utils]);

  const handleImport = useCallback(() => {
    if (!importData.trim()) {
      toast.error("Paste or upload file data first");
      return;
    }
    if (importFormat === "csv") {
      importCsvMutation.mutate({ csvData: importData });
    } else {
      importKmlMutation.mutate({ kmlData: importData });
    }
  }, [importData, importFormat, importCsvMutation, importKmlMutation]);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        setImportData(text);
        // Auto-detect format
        if (file.name.endsWith(".kml") || text.includes("<kml")) {
          setImportFormat("kml");
        } else {
          setImportFormat("csv");
        }
      };
      reader.readAsText(file);
    },
    []
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
      category: addCategory as any,
      notes: addNotes.trim() || undefined,
    });
  }, [addLabel, addLat, addLon, addFreq, addColor, addCategory, addNotes, saveMutation]);

  const targets = (targetsQuery.data || []) as SavedTarget[];
  const visibleCount = targets.filter((t) => t.visible).length;

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of targets) {
      counts[t.category] = (counts[t.category] || 0) + 1;
    }
    return counts;
  }, [targets]);

  // Filtered targets
  const filteredTargets = useMemo(() => {
    if (!filterCategory) return targets;
    return targets.filter((t) => t.category === filterCategory);
  }, [targets, filterCategory]);

  // History data
  const historyEntries = (historyQuery.data || []) as Array<{
    id: number;
    targetId: number;
    jobId: number;
    lat: string;
    lon: string;
    frequencyKhz: string | null;
    hostCount: number | null;
    notes: string | null;
    observedAt: number;
  }>;

  // Prediction data
  const prediction = predictionQuery.data;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: "-100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "-100%", opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="fixed top-0 left-0 bottom-0 w-[420px] max-w-[90vw] z-50 flex flex-col"
        >
          {/* Glass background */}
          <div className="absolute inset-0 bg-background/90 backdrop-blur-xl border-r border-border" />

          {/* Content */}
          <div className="relative flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center">
                  <Target className="w-5 h-5 text-rose-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Saved Targets</h2>
                  <p className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider">
                    {filteredTargets.length} targets · {visibleCount} visible
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Export dropdown */}
                <div className="relative group">
                  <button
                    title="Export targets"
                    className="w-8 h-8 rounded-lg bg-foreground/5 border border-border flex items-center justify-center text-muted-foreground/70 hover:bg-foreground/10 hover:text-muted-foreground transition-colors"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <div className="absolute right-0 top-full mt-1 w-36 bg-background/95 border border-border rounded-lg overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 shadow-xl">
                    <button
                      onClick={handleExportCsv}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Export CSV
                    </button>
                    <button
                      onClick={handleExportKml}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors"
                    >
                      <Globe2 className="w-3.5 h-3.5" />
                      Export KML
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => setShowImport(!showImport)}
                  title="Import targets"
                  className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${
                    showImport
                      ? "bg-cyan-500/20 border-cyan-500/30 text-cyan-400"
                      : "bg-foreground/5 border-border text-muted-foreground/70 hover:bg-foreground/10 hover:text-muted-foreground"
                  }`}
                >
                  <Upload className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowAddForm(!showAddForm)}
                  title="Add target manually"
                  className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${
                    showAddForm
                      ? "bg-rose-500/20 border-rose-500/30 text-rose-400"
                      : "bg-foreground/5 border-border text-muted-foreground/70 hover:bg-foreground/10 hover:text-muted-foreground"
                  }`}
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-lg bg-foreground/5 border border-border flex items-center justify-center hover:bg-foreground/10 transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>

            {/* Category Filter Bar */}
            <div className="px-5 py-2.5 border-b border-border flex items-center gap-1.5 overflow-x-auto scrollbar-thin">
              <button
                onClick={() => setFilterCategory(null)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium whitespace-nowrap transition-colors ${
                  !filterCategory
                    ? "bg-foreground/15 text-foreground border border-border"
                    : "bg-foreground/5 text-muted-foreground/70 border border-transparent hover:bg-foreground/10 hover:text-muted-foreground"
                }`}
              >
                <Filter className="w-3 h-3" />
                All ({targets.length})
              </button>
              {CATEGORIES.map((cat) => {
                const config = CATEGORY_CONFIG[cat];
                const count = categoryCounts[cat] || 0;
                if (count === 0 && filterCategory !== cat) return null;
                return (
                  <button
                    key={cat}
                    onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium whitespace-nowrap transition-colors ${
                      filterCategory === cat
                        ? "bg-foreground/15 text-foreground border border-border"
                        : "bg-foreground/5 text-muted-foreground/70 border border-transparent hover:bg-foreground/10 hover:text-muted-foreground"
                    }`}
                  >
                    <span>{config.icon}</span>
                    {config.label} ({count})
                  </button>
                );
              })}
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 scrollbar-thin">
              {/* Import Panel */}
              <AnimatePresence>
                {showImport && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-lg bg-cyan-500/5 border border-cyan-500/15 p-4 space-y-3">
                      <h3 className="text-xs font-semibold text-foreground/80 uppercase tracking-wider flex items-center gap-1.5">
                        <Upload className="w-3.5 h-3.5 text-cyan-400" />
                        Import Targets
                      </h3>

                      {/* Format toggle */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setImportFormat("csv")}
                          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-[11px] font-medium transition-colors ${
                            importFormat === "csv"
                              ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                              : "bg-foreground/5 text-muted-foreground/70 border border-border hover:bg-foreground/10"
                          }`}
                        >
                          <FileText className="w-3.5 h-3.5" />
                          CSV
                        </button>
                        <button
                          onClick={() => setImportFormat("kml")}
                          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-[11px] font-medium transition-colors ${
                            importFormat === "kml"
                              ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                              : "bg-foreground/5 text-muted-foreground/70 border border-border hover:bg-foreground/10"
                          }`}
                        >
                          <Globe2 className="w-3.5 h-3.5" />
                          KML
                        </button>
                      </div>

                      {/* File upload */}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={importFormat === "csv" ? ".csv,.txt" : ".kml,.xml"}
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-border text-muted-foreground/70 text-xs hover:bg-foreground/5 hover:text-muted-foreground transition-colors"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        Choose {importFormat.toUpperCase()} file
                      </button>

                      {/* Or paste */}
                      <textarea
                        value={importData}
                        onChange={(e) => setImportData(e.target.value)}
                        placeholder={
                          importFormat === "csv"
                            ? "Or paste CSV data here...\nlabel,latitude,longitude,frequency_khz,category\nWWV,40.6814,-105.0422,10000,time_signal"
                            : "Or paste KML data here..."
                        }
                        rows={4}
                        className="w-full px-3 py-2 rounded-md bg-background/60 border border-border text-foreground text-[11px] font-mono placeholder:text-muted-foreground/30 focus:outline-none focus:border-cyan-500/40 resize-none"
                      />

                      {importData && (
                        <p className="text-[10px] text-muted-foreground/50">
                          {importData.split("\n").length} lines loaded
                        </p>
                      )}

                      <button
                        onClick={handleImport}
                        disabled={importCsvMutation.isPending || importKmlMutation.isPending || !importData.trim()}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs font-medium hover:bg-cyan-500/30 disabled:opacity-40 transition-colors"
                      >
                        {(importCsvMutation.isPending || importKmlMutation.isPending) ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Upload className="w-3.5 h-3.5" />
                        )}
                        Import {importFormat.toUpperCase()}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Manual Add Form */}
              <AnimatePresence>
                {showAddForm && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-lg bg-foreground/5 border border-border p-4 space-y-3">
                      <h3 className="text-xs font-semibold text-foreground/80 uppercase tracking-wider flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-rose-400" />
                        Add Target Manually
                      </h3>

                      <input
                        type="text"
                        placeholder="Label (e.g. Unknown TX)"
                        value={addLabel}
                        onChange={(e) => setAddLabel(e.target.value)}
                        className="w-full px-3 py-2 rounded-md bg-background/60 border border-border text-foreground text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-rose-500/40"
                      />

                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          placeholder="Latitude"
                          value={addLat}
                          onChange={(e) => setAddLat(e.target.value)}
                          className="px-3 py-2 rounded-md bg-background/60 border border-border text-foreground text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-rose-500/40"
                        />
                        <input
                          type="number"
                          placeholder="Longitude"
                          value={addLon}
                          onChange={(e) => setAddLon(e.target.value)}
                          className="px-3 py-2 rounded-md bg-background/60 border border-border text-foreground text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-rose-500/40"
                        />
                      </div>

                      <input
                        type="number"
                        placeholder="Frequency (kHz) — optional"
                        value={addFreq}
                        onChange={(e) => setAddFreq(e.target.value)}
                        className="w-full px-3 py-2 rounded-md bg-background/60 border border-border text-foreground text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-rose-500/40"
                      />

                      {/* Category selector */}
                      <div>
                        <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider block mb-1.5">Category:</span>
                        <div className="flex flex-wrap gap-1.5">
                          {CATEGORIES.map((cat) => {
                            const config = CATEGORY_CONFIG[cat];
                            return (
                              <button
                                key={cat}
                                onClick={() => setAddCategory(cat)}
                                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                                  addCategory === cat
                                    ? "bg-foreground/15 text-foreground border border-border"
                                    : "bg-foreground/5 text-muted-foreground/70 border border-border hover:bg-foreground/10"
                                }`}
                              >
                                <span>{config.icon}</span>
                                {config.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <textarea
                        placeholder="Notes — optional"
                        value={addNotes}
                        onChange={(e) => setAddNotes(e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 rounded-md bg-background/60 border border-border text-foreground text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-rose-500/40 resize-none"
                      />

                      {/* Color picker */}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Color:</span>
                        <div className="flex gap-1.5">
                          {TARGET_COLORS.map((c) => (
                            <button
                              key={c}
                              onClick={() => setAddColor(c)}
                              className={`w-5 h-5 rounded-full border-2 transition-all ${
                                addColor === c
                                  ? "border-border scale-110"
                                  : "border-transparent hover:border-border"
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
                  <Loader2 className="w-5 h-5 text-muted-foreground/50 animate-spin" />
                </div>
              ) : filteredTargets.length === 0 ? (
                <div className="rounded-lg bg-foreground/5 border border-dashed border-border p-8 text-center">
                  <Target className="w-8 h-8 text-foreground/15 mx-auto mb-3" />
                  <p className="text-xs text-muted-foreground/70 mb-1">
                    {filterCategory ? "No targets in this category" : "No saved targets yet"}
                  </p>
                  <p className="text-[10px] text-foreground/25">
                    Complete a TDoA run and save the result, or add/import targets
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredTargets.map((target) => {
                    const isEditing = editingId === target.id;
                    const isExpanded = expandedId === target.id;
                    const showingHistory = historyTargetId === target.id;
                    const isClassifying = classifyingId === target.id;
                    const showingPrediction = predictionTargetId === target.id;
                    const lat = parseFloat(target.lat);
                    const lon = parseFloat(target.lon);
                    const catConfig = CATEGORY_CONFIG[target.category] || CATEGORY_CONFIG.unknown;

                    return (
                      <motion.div
                        key={target.id}
                        layout
                        className={`rounded-lg border transition-colors ${
                          target.visible
                            ? "bg-foreground/5 border-border"
                            : "bg-foreground/[0.02] border-border opacity-60"
                        }`}
                      >
                        {/* Main row */}
                        <div className="flex items-center gap-3 px-3 py-2.5">
                          {/* Color dot + category icon */}
                          <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: target.color }}
                            />
                            <span className="text-[8px]" title={catConfig.label}>
                              {catConfig.icon}
                            </span>
                          </div>

                          {/* Label + coords */}
                          <div
                            className="flex-1 min-w-0 cursor-pointer"
                            onClick={() => setExpandedId(isExpanded ? null : target.id)}
                          >
                            {isEditing ? (
                              <input
                                type="text"
                                value={editLabel}
                                onChange={(e) => setEditLabel(e.target.value)}
                                className="w-full px-2 py-1 rounded bg-background/60 border border-border text-foreground text-xs font-mono focus:outline-none focus:border-rose-500/40"
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <>
                                <p className="text-xs font-medium text-foreground truncate">
                                  {target.label}
                                </p>
                                <p className="text-[10px] font-mono text-muted-foreground/70">
                                  {lat.toFixed(3)}°, {lon.toFixed(3)}°
                                  {target.frequencyKhz && (
                                    <span className="ml-2 text-amber-400/60">
                                      {parseFloat(target.frequencyKhz)} kHz
                                    </span>
                                  )}
                                  <span className="ml-2" style={{ color: catConfig.color + "80" }}>
                                    {catConfig.label}
                                  </span>
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
                                <button
                                  onClick={() => handleClassify(target)}
                                  disabled={isClassifying}
                                  className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
                                    isClassifying
                                      ? "text-amber-400 bg-amber-500/15"
                                      : "text-muted-foreground/50 hover:text-amber-400 hover:bg-amber-500/10"
                                  }`}
                                  title="Auto-classify with AI"
                                >
                                  {isClassifying ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Brain className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <button
                                  onClick={() => onFocusTarget?.(lat, lon)}
                                  className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/5 transition-colors"
                                  title="Focus on globe"
                                >
                                  <MapPin className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleToggle(target.id, target.visible)}
                                  className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
                                    target.visible
                                      ? "text-muted-foreground hover:text-foreground/80 hover:bg-foreground/5"
                                      : "text-muted-foreground/30 hover:text-muted-foreground/70 hover:bg-foreground/5"
                                  }`}
                                  title={target.visible ? "Hide on globe" : "Show on globe"}
                                >
                                  {target.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                </button>
                                <button
                                  onClick={() => {
                                    setHistoryTargetId(showingHistory ? null : target.id);
                                    setPredictionTargetId(showingHistory ? null : target.id);
                                    if (!showingHistory) setExpandedId(target.id);
                                  }}
                                  className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
                                    showingHistory
                                      ? "text-violet-400 bg-violet-500/15"
                                      : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/5"
                                  }`}
                                  title="Position history & prediction"
                                >
                                  <GitBranch className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleStartEdit(target)}
                                  className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/5 transition-colors"
                                  title="Edit target"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDelete(target.id)}
                                  className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                  title="Delete target"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : target.id)}
                              className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground/30 hover:text-muted-foreground/70 transition-colors"
                            >
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
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
                              <div className="px-3 pb-3 pt-1 border-t border-border space-y-2">
                                {/* Category picker (when editing) */}
                                {isEditing && (
                                  <div>
                                    <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider block mb-1">
                                      Category:
                                    </span>
                                    <div className="flex flex-wrap gap-1">
                                      {CATEGORIES.map((cat) => {
                                        const config = CATEGORY_CONFIG[cat];
                                        return (
                                          <button
                                            key={cat}
                                            onClick={() => setEditCategory(cat)}
                                            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${
                                              editCategory === cat
                                                ? "bg-foreground/15 text-foreground border border-border"
                                                : "bg-foreground/5 text-muted-foreground/70 border border-border hover:bg-foreground/10"
                                            }`}
                                          >
                                            <span>{config.icon}</span>
                                            {config.label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* Color picker (when editing) */}
                                {isEditing && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Color:</span>
                                    <div className="flex gap-1.5">
                                      {TARGET_COLORS.map((c) => (
                                        <button
                                          key={c}
                                          onClick={() => setEditColor(c)}
                                          className={`w-4 h-4 rounded-full border-2 transition-all ${
                                            editColor === c
                                              ? "border-border scale-110"
                                              : "border-transparent hover:border-border"
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
                                    className="w-full px-2 py-1.5 rounded bg-background/60 border border-border text-foreground text-[11px] font-mono placeholder:text-muted-foreground/30 focus:outline-none focus:border-rose-500/40 resize-none"
                                  />
                                ) : target.notes ? (
                                  <p className="text-[11px] text-muted-foreground/70 italic">{target.notes}</p>
                                ) : null}

                                {/* Metadata */}
                                <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground/50">
                                  <span>ID: {target.id}</span>
                                  {target.sourceJobId && (
                                    <span className="flex items-center gap-1">
                                      <Radio className="w-3 h-3" />
                                      Job #{target.sourceJobId}
                                    </span>
                                  )}
                                  <span>{new Date(target.createdAt).toLocaleDateString()}</span>
                                </div>

                                {/* Position History Timeline */}
                                {showingHistory && (
                                  <div className="mt-2 pt-2 border-t border-border">
                                    <h4 className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                                      <TrendingUp className="w-3 h-3" />
                                      Position History
                                    </h4>
                                    {historyQuery.isLoading ? (
                                      <div className="flex items-center gap-2 py-3">
                                        <Loader2 className="w-3.5 h-3.5 text-muted-foreground/50 animate-spin" />
                                        <span className="text-[10px] text-muted-foreground/50">Loading history...</span>
                                      </div>
                                    ) : historyEntries.length === 0 ? (
                                      <p className="text-[10px] text-foreground/25 py-2">
                                        No position history yet. Run more TDoA jobs and link them to this target.
                                      </p>
                                    ) : (
                                      <div className="space-y-1">
                                        {historyEntries.map((entry, idx) => {
                                          const entryLat = parseFloat(entry.lat);
                                          const entryLon = parseFloat(entry.lon);
                                          let driftKm: number | null = null;
                                          let bearingDeg: number | null = null;
                                          if (idx > 0) {
                                            const prev = historyEntries[idx - 1];
                                            const prevLat = parseFloat(prev.lat);
                                            const prevLon = parseFloat(prev.lon);
                                            driftKm = haversineDistance(prevLat, prevLon, entryLat, entryLon);
                                            bearingDeg = calculateBearing(prevLat, prevLon, entryLat, entryLon);
                                          }
                                          return (
                                            <div
                                              key={entry.id}
                                              className="flex items-start gap-2 px-2 py-1.5 rounded bg-foreground/[0.03] border border-border"
                                            >
                                              <div className="flex flex-col items-center pt-1">
                                                <div
                                                  className="w-2 h-2 rounded-full"
                                                  style={{ backgroundColor: target.color }}
                                                />
                                                {idx < historyEntries.length - 1 && (
                                                  <div className="w-px h-4 bg-foreground/10 mt-0.5" />
                                                )}
                                              </div>
                                              <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                  <span className="text-[10px] font-mono text-muted-foreground">
                                                    {entryLat.toFixed(4)}°, {entryLon.toFixed(4)}°
                                                  </span>
                                                  {driftKm !== null && (
                                                    <span className="text-[9px] font-mono text-amber-400/60 flex items-center gap-0.5">
                                                      <Navigation className="w-2.5 h-2.5" style={{ transform: `rotate(${bearingDeg || 0}deg)` }} />
                                                      {driftKm.toFixed(1)} km
                                                    </span>
                                                  )}
                                                </div>
                                                <div className="flex items-center gap-2 text-[9px] text-muted-foreground/50">
                                                  <span>Job #{entry.jobId}</span>
                                                  {entry.frequencyKhz && (
                                                    <span>{parseFloat(entry.frequencyKhz)} kHz</span>
                                                  )}
                                                  <span>{new Date(entry.observedAt).toLocaleString()}</span>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                        {/* Drift summary */}
                                        {historyEntries.length >= 2 && (
                                          <div className="rounded bg-violet-500/10 border border-violet-500/15 px-2.5 py-2 mt-1.5">
                                            <p className="text-[9px] text-violet-400/70 uppercase tracking-wider mb-0.5">
                                              Drift Summary
                                            </p>
                                            <DriftSummary entries={historyEntries} />
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* Position Prediction */}
                                    {showingPrediction && prediction && (
                                      <PredictionCard prediction={prediction} onFocus={onFocusTarget} />
                                    )}
                                    {showingPrediction && predictionQuery.isLoading && (
                                      <div className="flex items-center gap-2 py-2 mt-2">
                                        <Loader2 className="w-3.5 h-3.5 text-emerald-400/50 animate-spin" />
                                        <span className="text-[10px] text-muted-foreground/50">Computing prediction...</span>
                                      </div>
                                    )}
                                    {showingPrediction && !predictionQuery.isLoading && !prediction && historyEntries.length >= 2 && (
                                      <div className="rounded bg-foreground/5 border border-border px-2.5 py-2 mt-2">
                                        <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1.5">
                                          <AlertCircle className="w-3 h-3" />
                                          Need at least 2 position observations for prediction
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                )}
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

/* ── Prediction Card Sub-Component ─────────────────── */

function PredictionCard({
  prediction,
  onFocus,
}: {
  prediction: {
    predictedLat: number;
    predictedLon: number;
    predictedAt: number;
    ellipseMajor: number;
    ellipseMinor: number;
    ellipseRotation: number;
    rSquaredLat: number;
    rSquaredLon: number;
    velocityKmh: number;
    bearingDeg: number;
    modelType: string;
    historyCount: number;
    avgIntervalHours: number;
  };
  onFocus?: (lat: number, lon: number) => void;
}) {
  const avgR2 = (prediction.rSquaredLat + prediction.rSquaredLon) / 2;
  const confidenceLabel =
    avgR2 > 0.8 ? "High" : avgR2 > 0.5 ? "Medium" : "Low";
  const confidenceColor =
    avgR2 > 0.8 ? "text-emerald-400" : avgR2 > 0.5 ? "text-amber-400" : "text-red-400";

  return (
    <div className="rounded bg-emerald-500/10 border border-emerald-500/15 px-3 py-2.5 mt-2 space-y-2">
      <div className="flex items-center justify-between">
        <h5 className="text-[10px] font-mono text-emerald-400/70 uppercase tracking-wider flex items-center gap-1.5">
          <Crosshair className="w-3 h-3" />
          Position Prediction
        </h5>
        <span className={`text-[9px] font-mono ${confidenceColor}`}>
          {confidenceLabel} confidence ({Math.round(avgR2 * 100)}%)
        </span>
      </div>

      {/* Predicted position */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <p className="text-[11px] font-mono text-foreground/70">
            {prediction.predictedLat.toFixed(4)}°, {prediction.predictedLon.toFixed(4)}°
          </p>
          <p className="text-[9px] text-muted-foreground/50">
            Predicted for {new Date(prediction.predictedAt).toLocaleString()}
          </p>
        </div>
        {onFocus && (
          <button
            onClick={() => onFocus(prediction.predictedLat, prediction.predictedLon)}
            className="w-7 h-7 rounded flex items-center justify-center text-emerald-400/60 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            title="Focus on predicted position"
          >
            <Crosshair className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[9px] font-mono">
        <div>
          <span className="text-muted-foreground/50">Model: </span>
          <span className="text-muted-foreground">{prediction.modelType}</span>
        </div>
        <div>
          <span className="text-muted-foreground/50">Velocity: </span>
          <span className="text-muted-foreground">{prediction.velocityKmh.toFixed(1)} km/h</span>
        </div>
        <div>
          <span className="text-muted-foreground/50">Bearing: </span>
          <span className="text-muted-foreground">{prediction.bearingDeg.toFixed(0)}°</span>
        </div>
        <div>
          <span className="text-muted-foreground/50">Ellipse: </span>
          <span className="text-muted-foreground">
            {prediction.ellipseMajor.toFixed(2)}° × {prediction.ellipseMinor.toFixed(2)}°
          </span>
        </div>
        <div>
          <span className="text-muted-foreground/50">R² lat: </span>
          <span className="text-muted-foreground">{prediction.rSquaredLat.toFixed(3)}</span>
        </div>
        <div>
          <span className="text-muted-foreground/50">R² lon: </span>
          <span className="text-muted-foreground">{prediction.rSquaredLon.toFixed(3)}</span>
        </div>
        <div>
          <span className="text-muted-foreground/50">Observations: </span>
          <span className="text-muted-foreground">{prediction.historyCount}</span>
        </div>
        <div>
          <span className="text-muted-foreground/50">Avg interval: </span>
          <span className="text-muted-foreground">
            {prediction.avgIntervalHours < 1
              ? `${Math.round(prediction.avgIntervalHours * 60)} min`
              : `${prediction.avgIntervalHours.toFixed(1)} hrs`}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Drift Summary Sub-Component ─────────────────── */

function DriftSummary({ entries }: { entries: Array<{ lat: string; lon: string; observedAt: number }> }) {
  if (entries.length < 2) return null;

  const first = entries[0];
  const last = entries[entries.length - 1];
  const totalDrift = haversineDistance(
    parseFloat(first.lat), parseFloat(first.lon),
    parseFloat(last.lat), parseFloat(last.lon)
  );
  const timeSpanHrs = (last.observedAt - first.observedAt) / 3600000;

  let maxDrift = 0;
  for (let i = 1; i < entries.length; i++) {
    const d = haversineDistance(
      parseFloat(entries[i - 1].lat), parseFloat(entries[i - 1].lon),
      parseFloat(entries[i].lat), parseFloat(entries[i].lon)
    );
    if (d > maxDrift) maxDrift = d;
  }

  return (
    <div className="flex items-center gap-4 text-[10px] font-mono">
      <div>
        <span className="text-muted-foreground/50">Total: </span>
        <span className="text-muted-foreground">{totalDrift.toFixed(1)} km</span>
      </div>
      <div>
        <span className="text-muted-foreground/50">Max step: </span>
        <span className="text-muted-foreground">{maxDrift.toFixed(1)} km</span>
      </div>
      <div>
        <span className="text-muted-foreground/50">Over: </span>
        <span className="text-muted-foreground">
          {timeSpanHrs < 1 ? `${Math.round(timeSpanHrs * 60)} min` : `${timeSpanHrs.toFixed(1)} hrs`}
        </span>
      </div>
      <div>
        <span className="text-muted-foreground/50">Obs: </span>
        <span className="text-muted-foreground">{entries.length}</span>
      </div>
    </div>
  );
}

/* ── Geo Helpers ───────────────────────────────────── */

// haversineDistance and calculateBearing imported from shared/geo.ts
const haversineDistance = haversineKm;
const calculateBearing = calcBearing;