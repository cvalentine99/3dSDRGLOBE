/**
 * WatchlistPanel.tsx — Watchlist monitoring dashboard
 * Design: "Ether" dark atmospheric theme
 *
 * Shows all watched stations with live status, SNR bars,
 * polling controls, and quick actions.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Eye, EyeOff, RefreshCw, Trash2, Radio, Wifi, WifiOff,
  Activity, Users, Clock, Settings, ChevronDown, ChevronUp,
  Crosshair, AlertTriangle, Antenna, Zap, StickyNote, Pencil,
  Check, X as XIcon, Search, FileText
} from "lucide-react";
import {
  getWatchlist,
  getWatchlistConfig,
  setWatchlistConfig,
  removeFromWatchlist,
  clearWatchlist,
  forcePollAll,
  forcePollStation,
  onWatchlistChange,
  setStationNote,
  type WatchlistEntry,
  type WatchlistConfig,
} from "@/lib/watchlistService";

/* ── Types ────────────────────────────────────────── */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectStation?: (coordinates: [number, number], label: string) => void;
}

type SortMode = "name" | "snr" | "status" | "added";

/* ── Helpers ──────────────────────────────────────── */

function snrToColor(snr: number): string {
  if (snr <= 0 || snr === -1) return "#6b7280";
  if (snr <= 3) return "#ef4444";
  if (snr <= 8) return "#f97316";
  if (snr <= 15) return "#eab308";
  if (snr <= 25) return "#22c55e";
  return "#10b981";
}

function snrToLabel(snr: number): string {
  if (snr <= 0 || snr === -1) return "N/A";
  if (snr <= 3) return "Very Weak";
  if (snr <= 8) return "Weak";
  if (snr <= 15) return "Moderate";
  if (snr <= 25) return "Good";
  return "Excellent";
}

function formatUptime(seconds: number): string {
  if (seconds <= 0) return "N/A";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

const TYPE_COLORS: Record<string, string> = {
  KiwiSDR: "#4ade80",
  OpenWebRX: "#22d3ee",
  WebSDR: "#f87171",
};

/* ── Component ────────────────────────────────────── */

export default function WatchlistPanel({ isOpen, onClose, onSelectStation }: Props) {
  const [entries, setEntries] = useState<WatchlistEntry[]>(getWatchlist);
  const [config, setConfig] = useState<WatchlistConfig>(getWatchlistConfig);
  const [showSettings, setShowSettings] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("status");
  const [sortAsc, setSortAsc] = useState(false);
  const [polling, setPolling] = useState(false);
  const [noteSearch, setNoteSearch] = useState("");
  const [showNoteSearch, setShowNoteSearch] = useState(false);

  // Listen for watchlist changes
  useEffect(() => {
    const unsub = onWatchlistChange(() => {
      setEntries(getWatchlist());
    });
    return unsub;
  }, []);

  // Refresh on open
  useEffect(() => {
    if (isOpen) {
      setEntries(getWatchlist());
      setConfig(getWatchlistConfig());
    }
  }, [isOpen]);

  const handlePollAll = useCallback(async () => {
    setPolling(true);
    await forcePollAll();
    setEntries(getWatchlist());
    setPolling(false);
  }, []);

  const handlePollOne = useCallback(async (key: string) => {
    await forcePollStation(key);
    setEntries(getWatchlist());
  }, []);

  const handleRemove = useCallback((key: string) => {
    removeFromWatchlist(key);
    setEntries(getWatchlist());
  }, []);

  const handleClearAll = useCallback(() => {
    clearWatchlist();
    setEntries(getWatchlist());
  }, []);

  const updateConfig = useCallback((patch: Partial<WatchlistConfig>) => {
    const updated = setWatchlistConfig(patch);
    setConfig(updated);
  }, []);

  const handleSort = useCallback((mode: SortMode) => {
    if (sortMode === mode) {
      setSortAsc(!sortAsc);
    } else {
      setSortMode(mode);
      setSortAsc(false);
    }
  }, [sortMode, sortAsc]);

  // Filter by note search, then sort
  const filteredEntries = useMemo(() => {
    if (!noteSearch.trim()) return entries;
    const q = noteSearch.toLowerCase();
    return entries.filter((e) => {
      // Search in notes, station label, and receiver type
      const inNotes = e.notes?.toLowerCase().includes(q);
      const inLabel = e.label.toLowerCase().includes(q);
      const inType = e.receiverType.toLowerCase().includes(q);
      return inNotes || inLabel || inType;
    });
  }, [entries, noteSearch]);

  const sortedEntries = useMemo(() => {
    const sorted = [...filteredEntries].sort((a, b) => {
      // When searching notes, prioritize entries with matching notes
      if (noteSearch.trim()) {
        const q = noteSearch.toLowerCase();
        const aHasNote = a.notes?.toLowerCase().includes(q) ? 1 : 0;
        const bHasNote = b.notes?.toLowerCase().includes(q) ? 1 : 0;
        if (aHasNote !== bHasNote) return bHasNote - aHasNote;
      }
      switch (sortMode) {
        case "name":
          return a.label.localeCompare(b.label);
        case "snr": {
          const snrA = a.lastStatus?.snr ?? -1;
          const snrB = b.lastStatus?.snr ?? -1;
          return snrB - snrA;
        }
        case "status": {
          const onA = a.lastStatus?.online ? 1 : 0;
          const onB = b.lastStatus?.online ? 1 : 0;
          if (onA !== onB) return onB - onA;
          return (b.lastStatus?.snr ?? -1) - (a.lastStatus?.snr ?? -1);
        }
        case "added":
          return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
        default:
          return 0;
      }
    });
    return sortAsc ? sorted.reverse() : sorted;
  }, [filteredEntries, sortMode, sortAsc, noteSearch]);

  const notesCount = entries.filter((e) => e.notes).length;

  // Stats
  const onlineCount = entries.filter((e) => e.lastStatus?.online).length;
  const offlineCount = entries.filter((e) => e.lastStatus && !e.lastStatus.online).length;
  const pendingCount = entries.filter((e) => !e.lastStatus).length;
  const avgSnr = useMemo(() => {
    const snrs = entries
      .filter((e) => e.lastStatus && e.lastStatus.snr > 0)
      .map((e) => e.lastStatus!.snr);
    if (snrs.length === 0) return 0;
    return Math.round(snrs.reduce((a, b) => a + b, 0) / snrs.length);
  }, [entries]);

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 20 }}
      transition={{ type: "spring", damping: 25, stiffness: 250 }}
      className="absolute inset-4 z-50 glass-panel rounded-2xl overflow-hidden flex flex-col"
      style={{ maxWidth: "680px", maxHeight: "780px", margin: "auto" }}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
            <Eye className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white/90">Watchlist</h2>
            <p className="text-[10px] font-mono text-white/40 mt-0.5">
              {entries.length} station{entries.length !== 1 ? "s" : ""} monitored
              {config.enabled ? ` · polling every ${config.intervalSeconds}s` : " · paused"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded-lg transition-colors ${
              showSettings ? "bg-white/10 text-white/70" : "hover:bg-white/5 text-white/30 hover:text-white/50"
            }`}
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-white/40 hover:text-white/70"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Settings panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-white/5"
          >
            <div className="px-5 py-3 space-y-3">
              {/* Polling toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {config.enabled ? (
                    <Eye className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5 text-white/30" />
                  )}
                  <div>
                    <p className="text-[10px] text-white/60">Background Polling</p>
                    <p className="text-[8px] text-white/25">
                      {config.enabled ? "Automatically checking station status" : "Polling paused"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => updateConfig({ enabled: !config.enabled })}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    config.enabled ? "bg-emerald-500/40" : "bg-white/10"
                  }`}
                >
                  <motion.div
                    className={`absolute top-0.5 w-4 h-4 rounded-full ${
                      config.enabled ? "bg-emerald-400" : "bg-white/30"
                    }`}
                    animate={{ left: config.enabled ? 22 : 2 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                </button>
              </div>

              {/* Poll interval */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/50">Poll Interval</span>
                <select
                  value={config.intervalSeconds}
                  onChange={(e) => updateConfig({ intervalSeconds: parseInt(e.target.value) })}
                  className="bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] font-mono text-white/70 cursor-pointer"
                >
                  <option value={30}>30 seconds</option>
                  <option value={60}>1 minute</option>
                  <option value={120}>2 minutes</option>
                  <option value={300}>5 minutes</option>
                  <option value={600}>10 minutes</option>
                </select>
              </div>

              {/* Max concurrent */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/50">Max Concurrent Polls</span>
                <select
                  value={config.maxConcurrent}
                  onChange={(e) => updateConfig({ maxConcurrent: parseInt(e.target.value) })}
                  className="bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] font-mono text-white/70 cursor-pointer"
                >
                  <option value={3}>3</option>
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={15}>15</option>
                </select>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Note search bar */}
      {entries.length > 0 && (
        <div className="px-5 py-2 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setShowNoteSearch(!showNoteSearch);
                if (showNoteSearch) setNoteSearch("");
              }}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[9px] font-mono transition-colors ${
                showNoteSearch || noteSearch
                  ? "bg-amber-400/10 text-amber-400/80 border border-amber-400/20"
                  : "text-white/30 hover:text-white/50 hover:bg-white/5"
              }`}
              title="Search notes & stations"
            >
              <Search className="w-3 h-3" />
              Search
              {notesCount > 0 && (
                <span className="text-[8px] text-white/20 ml-1">{notesCount} notes</span>
              )}
            </button>
            {noteSearch && (
              <span className="text-[9px] font-mono text-amber-400/50">
                {filteredEntries.length} of {entries.length} match
              </span>
            )}
          </div>
          <AnimatePresence>
            {showNoteSearch && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="relative mt-2">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/20" />
                  <input
                    type="text"
                    value={noteSearch}
                    onChange={(e) => setNoteSearch(e.target.value)}
                    placeholder="Search notes, station names, types..."
                    autoFocus
                    className="w-full bg-white/5 border border-white/10 rounded-lg pl-7 pr-8 py-1.5 text-[10px] text-white/80 placeholder:text-white/20 font-mono focus:outline-none focus:border-amber-400/30 focus:ring-1 focus:ring-amber-400/10 transition-colors"
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setNoteSearch("");
                        setShowNoteSearch(false);
                      }
                    }}
                  />
                  {noteSearch && (
                    <button
                      onClick={() => setNoteSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/10 text-white/30 hover:text-white/60 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Stats bar */}
      {entries.length > 0 && (
        <div className="px-5 py-2.5 border-b border-white/5 flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-[10px] font-mono text-green-400/80">{onlineCount} online</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-400/60" />
            <span className="text-[10px] font-mono text-red-400/60">{offlineCount} offline</span>
          </div>
          {pendingCount > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-white/20 animate-pulse" />
              <span className="text-[10px] font-mono text-white/30">{pendingCount} pending</span>
            </div>
          )}
          {avgSnr > 0 && (
            <div className="flex items-center gap-1.5 ml-auto">
              <Activity className="w-3 h-3 text-white/30" />
              <span className="text-[10px] font-mono text-white/40">avg {avgSnr} dB</span>
            </div>
          )}
        </div>
      )}

      {/* Sort bar + actions */}
      {entries.length > 0 && (
        <div className="px-5 py-2 border-b border-white/5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-mono text-white/25 mr-1">Sort:</span>
            {(["status", "name", "snr", "added"] as SortMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => handleSort(mode)}
                className={`px-2 py-0.5 rounded text-[9px] font-mono transition-colors ${
                  sortMode === mode
                    ? "bg-white/10 text-white/70 border border-white/15"
                    : "text-white/30 hover:text-white/50"
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
                {sortMode === mode && (
                  sortAsc ? <ChevronUp className="w-2.5 h-2.5 inline ml-0.5" /> : <ChevronDown className="w-2.5 h-2.5 inline ml-0.5" />
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePollAll}
              disabled={polling}
              className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-mono text-cyan-400/60 hover:text-cyan-400/90 hover:bg-white/5 transition-colors disabled:opacity-30"
              title="Poll all now"
            >
              <RefreshCw className={`w-3 h-3 ${polling ? "animate-spin" : ""}`} />
              Refresh All
            </button>
            <button
              onClick={handleClearAll}
              className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-mono text-red-400/40 hover:text-red-400/70 hover:bg-white/5 transition-colors"
              title="Remove all from watchlist"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Station list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {entries.length === 0 ? (
          <div className="text-center py-16">
            <Eye className="w-10 h-10 text-white/8 mx-auto mb-4" />
            <p className="text-sm text-white/30">No stations being watched</p>
            <p className="text-[10px] text-white/15 mt-2 max-w-xs mx-auto leading-relaxed">
              Add stations to your watchlist by clicking the eye icon in the station detail panel.
              Watched stations are polled in the background for continuous monitoring.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedEntries.map((entry) => (
              <WatchlistCard
                key={entry.key}
                entry={entry}
                searchQuery={noteSearch}
                onPoll={() => handlePollOne(entry.key)}
                onRemove={() => handleRemove(entry.key)}
                onSelect={() => onSelectStation?.(entry.coordinates, entry.label)}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* ── Station Card ─────────────────────────────────── */

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const q = query.toLowerCase();
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-amber-400/25 text-amber-300 rounded-sm px-0.5">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

function WatchlistCard({
  entry,
  searchQuery,
  onPoll,
  onRemove,
  onSelect,
}: {
  entry: WatchlistEntry;
  searchQuery: string;
  onPoll: () => void;
  onRemove: () => void;
  onSelect: () => void;
}) {
  const [polling, setPolling] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState(entry.notes || "");
  const [showNote, setShowNote] = useState(!!entry.notes);
  const status = entry.lastStatus;
  const isOnline = status?.online ?? false;
  const snr = status?.snr ?? -1;
  const hasData = !!status;

  const handlePoll = async () => {
    setPolling(true);
    await onPoll();
    setPolling(false);
  };

  const handleSaveNote = () => {
    setStationNote(entry.key, noteText);
    setEditingNote(false);
    if (!noteText.trim()) setShowNote(false);
  };

  const handleCancelNote = () => {
    setNoteText(entry.notes || "");
    setEditingNote(false);
    if (!entry.notes) setShowNote(false);
  };

  const handleStartEdit = () => {
    setNoteText(entry.notes || "");
    setShowNote(true);
    setEditingNote(true);
  };

  return (
    <div
      className={`rounded-lg border p-3 transition-all ${
        isOnline
          ? "bg-white/[0.03] border-white/8 hover:border-white/15"
          : hasData
          ? "bg-red-500/[0.02] border-red-500/10 hover:border-red-500/20"
          : "bg-white/[0.02] border-white/5"
      }`}
    >
      {/* Top row: name + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <button
              onClick={onSelect}
              className="text-[11px] font-medium text-white/80 hover:text-white truncate transition-colors text-left"
              title="Fly to station"
            >
              <HighlightText text={entry.label} query={searchQuery} />
            </button>
            <span
              className="text-[8px] font-mono px-1.5 py-0.5 rounded shrink-0"
              style={{
                color: TYPE_COLORS[entry.receiverType] || "#9ca3af",
                backgroundColor: (TYPE_COLORS[entry.receiverType] || "#9ca3af") + "15",
              }}
            >
              {entry.receiverType}
            </span>
          </div>

          {/* Status row */}
          <div className="flex items-center gap-3 mt-1.5">
            {/* Online/Offline */}
            {hasData ? (
              isOnline ? (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-[9px] font-mono text-green-400/80">ONLINE</span>
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400/60" />
                  <span className="text-[9px] font-mono text-red-400/60">OFFLINE</span>
                </span>
              )
            ) : (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-white/20 animate-pulse" />
                <span className="text-[9px] font-mono text-white/30">PENDING</span>
              </span>
            )}

            {/* SNR */}
            {snr > 0 && (
              <span className="flex items-center gap-1">
                <Activity className="w-3 h-3" style={{ color: snrToColor(snr) + "80" }} />
                <span
                  className="text-[9px] font-mono font-bold"
                  style={{ color: snrToColor(snr) }}
                >
                  {snr} dB
                </span>
                <span className="text-[8px] font-mono text-white/25">
                  {snrToLabel(snr)}
                </span>
              </span>
            )}

            {/* Users */}
            {status && status.users >= 0 && (
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3 text-white/20" />
                <span className="text-[9px] font-mono text-white/35">
                  {status.users}/{status.usersMax}
                </span>
              </span>
            )}

            {/* ADC warning */}
            {status?.adcOverload && (
              <span className="flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-amber-400/70" />
                <span className="text-[8px] font-mono text-amber-400/50">ADC OVL</span>
              </span>
            )}
          </div>

          {/* SNR bar */}
          {snr > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: snrToColor(snr) }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min((snr / 35) * 100, 100)}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
              <span className="text-[8px] font-mono text-white/20 w-8 text-right">
                {snr} dB
              </span>
            </div>
          )}

          {/* Extra info row */}
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {status?.antenna && (
              <span className="flex items-center gap-1">
                <Antenna className="w-2.5 h-2.5 text-white/15" />
                <span className="text-[8px] font-mono text-white/20 truncate max-w-[120px]">
                  {status.antenna}
                </span>
              </span>
            )}
            {status && status.uptime > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="w-2.5 h-2.5 text-white/15" />
                <span className="text-[8px] font-mono text-white/20">
                  {formatUptime(status.uptime)}
                </span>
              </span>
            )}
            {entry.lastPollAt && (
              <span className="text-[8px] font-mono text-white/15">
                polled {timeAgo(entry.lastPollAt)}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={onSelect}
            className="p-1.5 rounded-md hover:bg-white/5 text-white/25 hover:text-cyan-400/70 transition-colors"
            title="Fly to station"
          >
            <Crosshair className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleStartEdit}
            className={`p-1.5 rounded-md hover:bg-white/5 transition-colors ${
              entry.notes ? "text-amber-400/50 hover:text-amber-400/80" : "text-white/25 hover:text-amber-400/70"
            }`}
            title={entry.notes ? "Edit note" : "Add note"}
          >
            <StickyNote className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handlePoll}
            disabled={polling}
            className="p-1.5 rounded-md hover:bg-white/5 text-white/25 hover:text-emerald-400/70 transition-colors disabled:opacity-30"
            title="Poll now"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${polling ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={onRemove}
            className="p-1.5 rounded-md hover:bg-white/5 text-white/25 hover:text-red-400/70 transition-colors"
            title="Remove from watchlist"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Notes section */}
      <AnimatePresence>
        {showNote && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 pt-2 border-t border-white/5">
              {editingNote ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Pencil className="w-2.5 h-2.5 text-amber-400/50" />
                    <span className="text-[8px] font-mono text-amber-400/50 uppercase tracking-wider">Note</span>
                  </div>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Write a note about this station..."
                    maxLength={500}
                    autoFocus
                    className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-2 text-[10px] text-white/80 placeholder:text-white/20 font-mono resize-none focus:outline-none focus:border-amber-400/30 focus:ring-1 focus:ring-amber-400/10 transition-colors"
                    rows={3}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        handleSaveNote();
                      }
                      if (e.key === "Escape") {
                        handleCancelNote();
                      }
                    }}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-mono text-white/15">
                      {noteText.length}/500 · Ctrl+Enter to save · Esc to cancel
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={handleCancelNote}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-mono text-white/30 hover:text-white/50 hover:bg-white/5 transition-colors"
                      >
                        <X className="w-3 h-3" />
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveNote}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-mono text-amber-400/70 hover:text-amber-400 hover:bg-amber-400/10 transition-colors"
                      >
                        <Check className="w-3 h-3" />
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              ) : entry.notes ? (
                <div
                  className="group/note cursor-pointer"
                  onClick={handleStartEdit}
                  title="Click to edit note"
                >
                  <div className="flex items-start gap-1.5">
                    <StickyNote className="w-2.5 h-2.5 text-amber-400/30 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-white/50 font-mono leading-relaxed whitespace-pre-wrap break-words group-hover/note:text-white/60 transition-colors">
                        <HighlightText text={entry.notes} query={searchQuery} />
                      </p>
                      {entry.notesUpdatedAt && (
                        <p className="text-[7px] font-mono text-white/15 mt-1">
                          updated {timeAgo(entry.notesUpdatedAt)}
                        </p>
                      )}
                    </div>
                    <Pencil className="w-2.5 h-2.5 text-white/0 group-hover/note:text-white/25 transition-colors shrink-0 mt-0.5" />
                  </div>
                </div>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
