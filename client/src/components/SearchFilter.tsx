/**
 * SearchFilter.tsx — Floating search and filter controls
 * Design: "Ether" — minimal frosted glass with command-palette feel
 */
import { useRadio } from "@/contexts/RadioContext";
import { Search, Radio } from "lucide-react";
import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ReceiverType, Station } from "@/lib/types";

const FILTER_OPTIONS: { value: ReceiverType; label: string; color: string; count?: number }[] = [
  { value: "all", label: "All Types", color: "text-foreground" },
  { value: "KiwiSDR", label: "KiwiSDR", color: "text-green-400" },
  { value: "OpenWebRX", label: "OpenWebRX", color: "text-cyan-400" },
  { value: "WebSDR", label: "WebSDR", color: "text-primary" },
];

export default function SearchFilter() {
  const {
    searchQuery,
    setSearchQuery,
    filterType,
    setFilterType,
    filteredStations,
    stations,
    selectStation,
    loading,
  } = useRadio();

  const [isFocused, setIsFocused] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") {
        setShowResults(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close results when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const searchResults = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return [];
    return filteredStations.slice(0, 8);
  }, [searchQuery, filteredStations]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: stations.length };
    stations.forEach((s) => {
      s.receivers.forEach((r) => {
        counts[r.type] = (counts[r.type] || 0) + 1;
      });
    });
    return counts;
  }, [stations]);

  const handleSelectStation = (station: Station) => {
    selectStation(station);
    setShowResults(false);
    setSearchQuery("");
  };

  return (
    <div ref={panelRef} className="absolute top-4 left-4 z-30 w-[360px] max-w-[calc(100vw-2rem)]">
      {/* Search bar */}
      <div className={`glass-panel rounded-2xl transition-all duration-300 ${
        isFocused ? "glow-cyan" : ""
      }`}>
        <div className="flex items-center gap-3 px-4 py-3">
          <Search className={`w-4 h-4 shrink-0 transition-colors ${
            isFocused ? "text-accent" : "text-muted-foreground"
          }`} />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowResults(true);
            }}
            onFocus={() => {
              setIsFocused(true);
              setShowResults(true);
            }}
            onBlur={() => setIsFocused(false)}
            placeholder="Search receivers..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none font-sans"
          />
          {loading ? (
            <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-accent rounded-full animate-spin" />
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground">
                {filteredStations.length}
              </span>
              {!isFocused && (
                <kbd className="text-[9px] font-mono text-muted-foreground/40 border border-white/10 rounded px-1 py-0.5">/</kbd>
              )}
            </div>
          )}
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-1.5 px-3 pb-3 flex-wrap">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilterType(opt.value)}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all duration-200 ${
                filterType === opt.value
                  ? "bg-white/10 border-white/20 text-foreground"
                  : "bg-transparent border-white/5 text-muted-foreground hover:border-white/10 hover:text-foreground"
              }`}
            >
              <span className={filterType === opt.value ? opt.color : ""}>
                {opt.label}
              </span>
              <span className="ml-1 opacity-50">
                {typeCounts[opt.value] || 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Search results dropdown */}
      <AnimatePresence>
        {showResults && searchResults.length > 0 && (
          <motion.div
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="mt-2 glass-panel rounded-xl overflow-hidden"
          >
            <div className="max-h-[320px] overflow-y-auto">
              {searchResults.map((station, idx) => (
                <button
                  key={`${station.label}-${idx}`}
                  onClick={() => handleSelectStation(station)}
                  className="w-full text-left px-4 py-3 hover:bg-white/5 transition-colors border-b border-white/3 last:border-0"
                >
                  <div className="flex items-start gap-3">
                    <Radio className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {station.label}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {station.receivers.length} receiver{station.receivers.length !== 1 ? "s" : ""} •{" "}
                        {station.receivers.map((r) => r.type).filter((v, i, a) => a.indexOf(v) === i).join(", ")}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
