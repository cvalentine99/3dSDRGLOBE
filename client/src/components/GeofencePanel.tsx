/**
 * GeofencePanel.tsx — Geofence Zone Management Panel
 *
 * Provides UI for:
 * - Creating geofence zones by clicking points on the globe
 * - Managing existing zones (edit, delete, toggle)
 * - Viewing zone alert history
 */
import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Shield,
  ShieldAlert,
  MapPin,
  Hexagon,
  Check,
  RotateCcw,
  Pencil,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/* ── Types ──────────────────────────────────────────────── */

interface PolygonVertex {
  lat: number;
  lon: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Vertices being drawn on the globe */
  drawingVertices: PolygonVertex[];
  /** Whether the user is currently drawing a zone */
  isDrawing: boolean;
  /** Start drawing mode */
  onStartDrawing: () => void;
  /** Finish drawing and create zone */
  onFinishDrawing: () => void;
  /** Cancel drawing */
  onCancelDrawing: () => void;
  /** Undo last vertex */
  onUndoVertex: () => void;
}

/* ── Color presets ──────────────────────────────────────── */

const ZONE_COLORS = [
  { label: "Red", value: "#ff000066" },
  { label: "Orange", value: "#ff880066" },
  { label: "Yellow", value: "#ffcc0066" },
  { label: "Green", value: "#00ff0066" },
  { label: "Cyan", value: "#00ffff66" },
  { label: "Blue", value: "#0088ff66" },
  { label: "Purple", value: "#8800ff66" },
  { label: "Pink", value: "#ff00ff66" },
];

/* ── Component ──────────────────────────────────────────── */

export default function GeofencePanel({
  isOpen,
  onClose,
  drawingVertices,
  isDrawing,
  onStartDrawing,
  onFinishDrawing,
  onCancelDrawing,
  onUndoVertex,
}: Props) {

  const [newZoneName, setNewZoneName] = useState("New Zone");
  const [newZoneType, setNewZoneType] = useState<"exclusion" | "inclusion">("exclusion");
  const [newZoneColor, setNewZoneColor] = useState("#ff000066");
  const [newZoneDescription, setNewZoneDescription] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  // ── tRPC queries ──────────────────────────────────────
  const zonesQuery = trpc.geofence.list.useQuery();
  const createMutation = trpc.geofence.create.useMutation({
    onSuccess: () => {
      zonesQuery.refetch();
      toast.success("Geofence zone has been saved.");
    },
  });
  const updateMutation = trpc.geofence.update.useMutation({
    onSuccess: () => {
      zonesQuery.refetch();
      setEditingId(null);
    },
  });
  const deleteMutation = trpc.geofence.delete.useMutation({
    onSuccess: () => {
      zonesQuery.refetch();
      toast.success("Zone deleted.");
    },
  });

  const zones = zonesQuery.data ?? [];

  // ── Handlers ──────────────────────────────────────────

  const handleSaveZone = useCallback(() => {
    if (drawingVertices.length < 3) {
      toast.error("A geofence zone needs at least 3 vertices.");
      return;
    }

    createMutation.mutate({
      name: newZoneName || "Unnamed Zone",
      zoneType: newZoneType,
      polygon: drawingVertices,
      color: newZoneColor,
      description: newZoneDescription || undefined,
    });

    onFinishDrawing();
    setNewZoneName("New Zone");
    setNewZoneDescription("");
  }, [drawingVertices, newZoneName, newZoneType, newZoneColor, newZoneDescription, createMutation, onFinishDrawing, toast]);

  const handleToggleEnabled = useCallback(
    (id: number, currentEnabled: boolean) => {
      updateMutation.mutate({ id, enabled: !currentEnabled });
    },
    [updateMutation]
  );

  const handleToggleVisible = useCallback(
    (id: number, currentVisible: boolean) => {
      updateMutation.mutate({ id, visible: !currentVisible });
    },
    [updateMutation]
  );

  const handleDelete = useCallback(
    (id: number) => {
      deleteMutation.mutate({ id });
    },
    [deleteMutation]
  );

  const handleStartEdit = useCallback(
    (id: number, name: string) => {
      setEditingId(id);
      setEditName(name);
    },
    []
  );

  const handleSaveEdit = useCallback(() => {
    if (editingId === null) return;
    updateMutation.mutate({ id: editingId, name: editName });
  }, [editingId, editName, updateMutation]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="fixed right-4 top-16 bottom-4 w-[380px] z-50 flex flex-col glass-panel rounded-xl border border-border/40 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <div className="flex items-center gap-2">
            <Hexagon className="w-4 h-4 text-orange-400" />
            <span className="text-sm font-semibold text-foreground">Geofence Zones</span>
            <span className="text-xs text-muted-foreground">({zones.length})</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent/50 text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Drawing mode controls */}
        <div className="px-4 py-3 border-b border-border/30">
          {isDrawing ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-orange-400">
                <MapPin className="w-3.5 h-3.5 animate-pulse" />
                <span>Click on the globe to add vertices ({drawingVertices.length} points)</span>
              </div>

              {/* Zone name */}
              <input
                type="text"
                value={newZoneName}
                onChange={(e) => setNewZoneName(e.target.value)}
                placeholder="Zone name..."
                className="w-full px-2 py-1.5 text-xs bg-background/50 border border-border/40 rounded text-foreground placeholder:text-muted-foreground"
              />

              {/* Zone type */}
              <div className="flex gap-2">
                <button
                  onClick={() => setNewZoneType("exclusion")}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded border ${
                    newZoneType === "exclusion"
                      ? "border-red-500/50 bg-red-500/10 text-red-400"
                      : "border-border/40 text-muted-foreground hover:bg-accent/30"
                  }`}
                >
                  <ShieldAlert className="w-3 h-3" />
                  Exclusion
                </button>
                <button
                  onClick={() => setNewZoneType("inclusion")}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded border ${
                    newZoneType === "inclusion"
                      ? "border-green-500/50 bg-green-500/10 text-green-400"
                      : "border-border/40 text-muted-foreground hover:bg-accent/30"
                  }`}
                >
                  <Shield className="w-3 h-3" />
                  Inclusion
                </button>
              </div>

              {/* Color picker */}
              <div className="flex gap-1.5">
                {ZONE_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setNewZoneColor(c.value)}
                    className={`w-6 h-6 rounded-full border-2 ${
                      newZoneColor === c.value ? "border-foreground" : "border-transparent"
                    }`}
                    style={{ backgroundColor: c.value.replace("66", "cc") }}
                    title={c.label}
                  />
                ))}
              </div>

              {/* Description */}
              <textarea
                value={newZoneDescription}
                onChange={(e) => setNewZoneDescription(e.target.value)}
                placeholder="Description (optional)..."
                rows={2}
                className="w-full px-2 py-1.5 text-xs bg-background/50 border border-border/40 rounded text-foreground placeholder:text-muted-foreground resize-none"
              />

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onUndoVertex}
                  disabled={drawingVertices.length === 0}
                  className="flex-1 text-xs"
                >
                  <RotateCcw className="w-3 h-3 mr-1" />
                  Undo
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onCancelDrawing}
                  className="flex-1 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveZone}
                  disabled={drawingVertices.length < 3 || createMutation.isPending}
                  className="flex-1 text-xs bg-orange-600 hover:bg-orange-700 text-white"
                >
                  <Check className="w-3 h-3 mr-1" />
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              onClick={onStartDrawing}
              className="w-full text-xs bg-orange-600/80 hover:bg-orange-600 text-white"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Draw New Zone
            </Button>
          )}
        </div>

        {/* Zone list */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
          {zones.length === 0 && !isDrawing && (
            <div className="text-center py-8 text-muted-foreground text-xs">
              <Hexagon className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>No geofence zones defined.</p>
              <p className="mt-1">Click "Draw New Zone" to create one.</p>
            </div>
          )}

          {zones.map((zone) => {
            const polygon = zone.polygon as Array<{ lat: number; lon: number }>;
            const vertexCount = Array.isArray(polygon) ? polygon.length : 0;
            const isExclusion = zone.zoneType === "exclusion";

            return (
              <div
                key={zone.id}
                className={`rounded-lg border p-3 ${
                  zone.enabled
                    ? "border-border/40 bg-background/30"
                    : "border-border/20 bg-background/10 opacity-60"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-sm"
                      style={{ backgroundColor: zone.color.replace("66", "cc") }}
                    />
                    {editingId === zone.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="px-1.5 py-0.5 text-xs bg-background/50 border border-border/40 rounded text-foreground w-32"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveEdit();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                        <button
                          onClick={handleSaveEdit}
                          className="p-0.5 text-green-400 hover:text-green-300"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs font-medium text-foreground truncate max-w-[160px]">
                        {zone.name}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleStartEdit(zone.id, zone.name)}
                      className="p-1 rounded hover:bg-accent/50 text-muted-foreground"
                      title="Rename"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleToggleVisible(zone.id, zone.visible)}
                      className="p-1 rounded hover:bg-accent/50 text-muted-foreground"
                      title={zone.visible ? "Hide on globe" : "Show on globe"}
                    >
                      {zone.visible ? (
                        <Eye className="w-3 h-3" />
                      ) : (
                        <EyeOff className="w-3 h-3" />
                      )}
                    </button>
                    <button
                      onClick={() => handleToggleEnabled(zone.id, zone.enabled)}
                      className="p-1 rounded hover:bg-accent/50 text-muted-foreground"
                      title={zone.enabled ? "Disable alerts" : "Enable alerts"}
                    >
                      {zone.enabled ? (
                        <ToggleRight className="w-3 h-3 text-green-400" />
                      ) : (
                        <ToggleLeft className="w-3 h-3" />
                      )}
                    </button>
                    <button
                      onClick={() => handleDelete(zone.id)}
                      className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400"
                      title="Delete zone"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span
                    className={`px-1.5 py-0.5 rounded ${
                      isExclusion
                        ? "bg-red-500/10 text-red-400"
                        : "bg-green-500/10 text-green-400"
                    }`}
                  >
                    {isExclusion ? "Exclusion" : "Inclusion"}
                  </span>
                  <span>{vertexCount} vertices</span>
                  {zone.description && (
                    <span className="truncate max-w-[120px]" title={zone.description}>
                      {zone.description}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer info */}
        <div className="px-4 py-2 border-t border-border/30 text-[10px] text-muted-foreground">
          <p>
            <strong>Exclusion</strong>: Alert when target enters zone.{" "}
            <strong>Inclusion</strong>: Alert when target leaves zone.
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
