/**
 * SavedQueriesSidebar.tsx — Bookmarked chat prompts sidebar
 *
 * Collapsible panel on the left side of the IntelChat dialog that shows
 * saved/bookmarked queries organized by category. Users can:
 * - Save the current prompt as a bookmark
 * - Pin favorites to the top
 * - Filter by category
 * - One-click re-run any saved query
 * - Delete or edit saved queries
 *
 * Design: "Ether" dark atmospheric style matching IntelChat.
 */

import { useState, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bookmark,
  BookmarkPlus,
  Pin,
  PinOff,
  Trash2,
  Play,
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  Star,
  Hash,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────

interface SavedQuery {
  id: number;
  name: string;
  prompt: string;
  category: string;
  pinned: boolean;
  usageCount: number;
  lastUsedAt: number | null;
  createdAt: number;
}

const CATEGORIES = [
  { value: "all", label: "All", icon: <Filter className="w-3 h-3" /> },
  { value: "general", label: "General", icon: <Star className="w-3 h-3" /> },
  { value: "receivers", label: "Receivers", icon: <Hash className="w-3 h-3" /> },
  { value: "targets", label: "Targets", icon: <Hash className="w-3 h-3" /> },
  { value: "conflicts", label: "Conflicts", icon: <Hash className="w-3 h-3" /> },
  { value: "anomalies", label: "Anomalies", icon: <Hash className="w-3 h-3" /> },
  { value: "system", label: "System", icon: <Hash className="w-3 h-3" /> },
];

// ── Component ───────────────────────────────────────────────────

export default function SavedQueriesSidebar({
  isOpen,
  onToggle,
  onRunQuery,
  currentInput,
}: {
  isOpen: boolean;
  onToggle: () => void;
  onRunQuery: (prompt: string) => void;
  currentInput: string;
}) {
  const [activeCategory, setActiveCategory] = useState("all");
  const [saveName, setSaveName] = useState("");
  const [saveCategory, setSaveCategory] = useState("general");
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // tRPC queries
  const queriesQuery = trpc.savedQueries.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const createMutation = trpc.savedQueries.create.useMutation({
    onSuccess: () => {
      queriesQuery.refetch();
      setShowSaveForm(false);
      setSaveName("");
    },
  });
  const deleteMutation = trpc.savedQueries.delete.useMutation({
    onSuccess: () => {
      queriesQuery.refetch();
      setDeletingId(null);
    },
  });
  const togglePinMutation = trpc.savedQueries.togglePin.useMutation({
    onSuccess: () => queriesQuery.refetch(),
  });
  const recordUsageMutation = trpc.savedQueries.recordUsage.useMutation({
    onSuccess: () => queriesQuery.refetch(),
  });

  const queries = queriesQuery.data?.queries || [];

  const filteredQueries = useMemo(() => {
    if (activeCategory === "all") return queries;
    return queries.filter((q) => q.category === activeCategory);
  }, [queries, activeCategory]);

  const handleSave = useCallback(() => {
    if (!saveName.trim() || !currentInput.trim()) return;
    createMutation.mutate({
      name: saveName.trim(),
      prompt: currentInput.trim(),
      category: saveCategory as any,
    });
  }, [saveName, currentInput, saveCategory, createMutation]);

  const handleRun = useCallback(
    (query: SavedQuery) => {
      recordUsageMutation.mutate({ id: query.id });
      onRunQuery(query.prompt);
    },
    [onRunQuery, recordUsageMutation]
  );

  const handleDelete = useCallback(
    (id: number) => {
      setDeletingId(id);
      deleteMutation.mutate({ id });
    },
    [deleteMutation]
  );

  const handleTogglePin = useCallback(
    (id: number) => {
      togglePinMutation.mutate({ id });
    },
    [togglePinMutation]
  );

  // ── Collapsed toggle button ───────────────────────────────────

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-6 h-16 rounded-r-lg transition-all duration-200 hover:w-7"
        style={{
          background: "rgba(0, 200, 255, 0.08)",
          borderRight: "1px solid rgba(0, 200, 255, 0.15)",
          borderTop: "1px solid rgba(0, 200, 255, 0.15)",
          borderBottom: "1px solid rgba(0, 200, 255, 0.15)",
        }}
        title="Open saved queries"
      >
        <ChevronRight className="w-3.5 h-3.5 text-cyan-400/60" />
      </button>
    );
  }

  // ── Expanded sidebar ──────────────────────────────────────────

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 240, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="shrink-0 flex flex-col overflow-hidden"
      style={{
        borderRight: "1px solid rgba(0, 200, 255, 0.1)",
        background: "rgba(0, 10, 25, 0.6)",
      }}
    >
      {/* Sidebar Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 shrink-0"
        style={{ borderBottom: "1px solid rgba(0, 200, 255, 0.08)" }}
      >
        <div className="flex items-center gap-1.5">
          <Bookmark className="w-3.5 h-3.5 text-cyan-400/70" />
          <span className="text-[11px] font-semibold text-cyan-200/80 uppercase tracking-wider">
            Saved Queries
          </span>
        </div>
        <button
          onClick={onToggle}
          className="p-1 rounded text-cyan-500/40 hover:text-cyan-300 transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Category Filter */}
      <div
        className="flex flex-wrap gap-1 px-2 py-2 shrink-0"
        style={{ borderBottom: "1px solid rgba(0, 200, 255, 0.06)" }}
      >
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setActiveCategory(cat.value)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium transition-all duration-150"
            style={{
              background:
                activeCategory === cat.value
                  ? "rgba(0, 200, 255, 0.15)"
                  : "rgba(0, 200, 255, 0.04)",
              border: `1px solid ${
                activeCategory === cat.value
                  ? "rgba(0, 200, 255, 0.3)"
                  : "rgba(0, 200, 255, 0.08)"
              }`,
              color:
                activeCategory === cat.value
                  ? "rgb(100, 220, 255)"
                  : "rgba(100, 200, 255, 0.5)",
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Save Current Query */}
      <div className="px-2 py-2 shrink-0" style={{ borderBottom: "1px solid rgba(0, 200, 255, 0.06)" }}>
        {showSaveForm ? (
          <div className="space-y-1.5">
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Query name..."
              className="w-full px-2 py-1 rounded text-[11px] bg-transparent text-cyan-200 placeholder-cyan-500/30 outline-none"
              style={{ border: "1px solid rgba(0, 200, 255, 0.15)" }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") setShowSaveForm(false);
              }}
            />
            <select
              value={saveCategory}
              onChange={(e) => setSaveCategory(e.target.value)}
              className="w-full px-2 py-1 rounded text-[10px] bg-transparent text-cyan-300/70 outline-none"
              style={{ border: "1px solid rgba(0, 200, 255, 0.1)" }}
            >
              {CATEGORIES.filter((c) => c.value !== "all").map((cat) => (
                <option key={cat.value} value={cat.value} style={{ background: "#0a1628" }}>
                  {cat.label}
                </option>
              ))}
            </select>
            <div className="flex gap-1">
              <button
                onClick={handleSave}
                disabled={!saveName.trim() || !currentInput.trim() || createMutation.isPending}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors"
                style={{
                  background: saveName.trim() && currentInput.trim()
                    ? "rgba(0, 200, 255, 0.15)"
                    : "rgba(0, 200, 255, 0.05)",
                  border: "1px solid rgba(0, 200, 255, 0.2)",
                  color: saveName.trim() && currentInput.trim()
                    ? "rgb(100, 220, 255)"
                    : "rgba(100, 200, 255, 0.3)",
                }}
              >
                {createMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  "Save"
                )}
              </button>
              <button
                onClick={() => setShowSaveForm(false)}
                className="px-2 py-1 rounded text-[10px] text-cyan-500/40 hover:text-cyan-300 transition-colors"
                style={{ border: "1px solid rgba(0, 200, 255, 0.08)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowSaveForm(true)}
            disabled={!currentInput.trim()}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[10px] font-medium transition-all duration-150"
            style={{
              background: currentInput.trim()
                ? "rgba(0, 200, 255, 0.08)"
                : "rgba(0, 200, 255, 0.03)",
              border: `1px solid ${
                currentInput.trim()
                  ? "rgba(0, 200, 255, 0.15)"
                  : "rgba(0, 200, 255, 0.06)"
              }`,
              color: currentInput.trim()
                ? "rgb(100, 220, 255)"
                : "rgba(100, 200, 255, 0.25)",
            }}
          >
            <BookmarkPlus className="w-3 h-3" />
            Save Current Query
          </button>
        )}
      </div>

      {/* Query List */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 scrollbar-thin">
        {queriesQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 text-cyan-400/40 animate-spin" />
          </div>
        ) : filteredQueries.length === 0 ? (
          <div className="text-center py-8">
            <Bookmark className="w-5 h-5 text-cyan-500/20 mx-auto mb-2" />
            <p className="text-[10px] text-cyan-500/30">
              {activeCategory === "all"
                ? "No saved queries yet"
                : `No ${activeCategory} queries`}
            </p>
          </div>
        ) : (
          filteredQueries.map((query) => (
            <div
              key={query.id}
              className="group rounded-lg px-2.5 py-2 transition-all duration-150 hover:scale-[1.01]"
              style={{
                background: query.pinned
                  ? "rgba(255, 180, 0, 0.06)"
                  : "rgba(0, 200, 255, 0.03)",
                border: `1px solid ${
                  query.pinned
                    ? "rgba(255, 180, 0, 0.12)"
                    : "rgba(0, 200, 255, 0.06)"
                }`,
              }}
            >
              <div className="flex items-start justify-between gap-1 mb-1">
                <span
                  className="text-[11px] font-medium truncate flex-1"
                  style={{
                    color: query.pinned
                      ? "rgb(255, 210, 100)"
                      : "rgb(150, 210, 255)",
                  }}
                >
                  {query.pinned && (
                    <Pin
                      className="w-2.5 h-2.5 inline mr-1 -mt-0.5"
                      style={{ color: "rgb(255, 180, 0)" }}
                    />
                  )}
                  {query.name}
                </span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={() => handleTogglePin(query.id)}
                    className="p-0.5 rounded hover:bg-cyan-400/10 transition-colors"
                    title={query.pinned ? "Unpin" : "Pin to top"}
                  >
                    {query.pinned ? (
                      <PinOff className="w-3 h-3 text-amber-400/60" />
                    ) : (
                      <Pin className="w-3 h-3 text-cyan-500/40" />
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(query.id)}
                    className="p-0.5 rounded hover:bg-red-400/10 transition-colors"
                    title="Delete"
                    disabled={deletingId === query.id}
                  >
                    {deletingId === query.id ? (
                      <Loader2 className="w-3 h-3 text-red-400/40 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3 text-red-400/40 hover:text-red-400" />
                    )}
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-cyan-400/40 truncate mb-1.5">
                {query.prompt}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-cyan-500/25">
                  {query.usageCount > 0
                    ? `Used ${query.usageCount}x`
                    : "Never used"}
                </span>
                <button
                  onClick={() => handleRun(query)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium transition-all duration-150"
                  style={{
                    background: "rgba(0, 200, 255, 0.1)",
                    border: "1px solid rgba(0, 200, 255, 0.2)",
                    color: "rgb(100, 220, 255)",
                  }}
                >
                  <Play className="w-2.5 h-2.5" />
                  Run
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer stats */}
      <div
        className="px-3 py-1.5 shrink-0 text-center"
        style={{ borderTop: "1px solid rgba(0, 200, 255, 0.06)" }}
      >
        <span className="text-[9px] text-cyan-500/25">
          {queries.length} saved • {queries.filter((q) => q.pinned).length}{" "}
          pinned
        </span>
      </div>
    </motion.div>
  );
}
