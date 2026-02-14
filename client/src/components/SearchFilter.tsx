/**
 * SearchFilter.tsx — Enhanced search and filter controls
 * Design: "Ether" — frosted glass command palette with type + band + region filters
 */
import { useRadio } from "@/contexts/RadioContext";
import { Search, Radio, ChevronDown, Waves, Antenna, X, Globe, MapPin } from "lucide-react";
import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ReceiverType, BandType, Station } from "@/lib/types";
import { BAND_DEFINITIONS, CONTINENT_DEFINITIONS } from "@/lib/types";

const TYPE_OPTIONS: { value: ReceiverType; label: string; color: string; dotColor: string }[] = [
  { value: "all", label: "All", color: "text-foreground", dotColor: "bg-white" },
  { value: "KiwiSDR", label: "KiwiSDR", color: "text-green-400", dotColor: "bg-green-400" },
  { value: "OpenWebRX", label: "OpenWebRX", color: "text-cyan-400", dotColor: "bg-cyan-400" },
  { value: "WebSDR", label: "WebSDR", color: "text-red-400", dotColor: "bg-red-400" },
];

const BAND_OPTIONS: { value: BandType; label: string; description: string }[] = [
  { value: "all", label: "All Bands", description: "" },
  ...BAND_DEFINITIONS.map((b) => ({
    value: b.id,
    label: b.label,
    description: b.description,
  })),
];

export default function SearchFilter() {
  const {
    searchQuery,
    setSearchQuery,
    filterType,
    setFilterType,
    filterBand,
    setFilterBand,
    filterContinent,
    setFilterContinent,
    filterRegion,
    setFilterRegion,
    filteredStations,
    selectStation,
    loading,
    typeCounts,
    bandCounts,
    continentCounts,
    regionCounts,
  } = useRadio();

  const [isFocused, setIsFocused] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(true);
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

  const handleSelectStation = (station: Station) => {
    selectStation(station);
    setShowResults(false);
    setSearchQuery("");
  };

  const hasActiveFilters = filterType !== "all" || filterBand !== "all" || filterContinent !== "all" || filterRegion !== "all";

  const clearAllFilters = () => {
    setFilterType("all");
    setFilterBand("all");
    setFilterContinent("all");
    setFilterRegion("all");
    setSearchQuery("");
  };

  // Get available regions for the selected continent
  const availableRegions = useMemo(() => {
    if (filterContinent === "all") return [];
    const continentDef = CONTINENT_DEFINITIONS.find((c) => c.id === filterContinent);
    if (!continentDef) return [];
    // Only show regions that have stations
    return continentDef.regions.filter((r) => (regionCounts[r.id] || 0) > 0);
  }, [filterContinent, regionCounts]);

  return (
    <div ref={panelRef} className="absolute top-4 left-4 z-30 w-[340px] max-w-[calc(100vw-2rem)]">
      {/* Search bar */}
      <div className={`glass-panel rounded-2xl transition-all duration-300 ${
        isFocused ? "glow-cyan" : ""
      }`}>
        {/* Search input row */}
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

        {/* Filter toggle header */}
        <div className="px-3 pb-1">
          <button
            onClick={() => setFiltersExpanded(!filtersExpanded)}
            className="flex items-center gap-2 w-full px-1 py-1.5 text-left group"
          >
            <Antenna className="w-3 h-3 text-muted-foreground/60" />
            <span className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider flex-1">
              Filters
            </span>
            {hasActiveFilters && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  clearAllFilters();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    clearAllFilters();
                  }
                }}
                className="text-[9px] font-mono text-accent/70 hover:text-accent transition-colors flex items-center gap-0.5 cursor-pointer"
              >
                <X className="w-2.5 h-2.5" />
                Clear
              </span>
            )}
            <ChevronDown className={`w-3 h-3 text-muted-foreground/40 transition-transform duration-200 ${
              filtersExpanded ? "rotate-180" : ""
            }`} />
          </button>
        </div>

        {/* Expandable filter sections */}
        <AnimatePresence>
          {filtersExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              {/* Receiver Type section */}
              <div className="px-3 pb-2">
                <div className="flex items-center gap-1.5 mb-1.5 px-1">
                  <Radio className="w-3 h-3 text-muted-foreground/50" />
                  <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">
                    Receiver Type
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {TYPE_OPTIONS.map((opt) => {
                    const count = typeCounts[opt.value] || 0;
                    const isActive = filterType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setFilterType(opt.value)}
                        className={`text-[10px] font-medium px-2 py-1 rounded-lg border transition-all duration-200 flex items-center gap-1.5 ${
                          isActive
                            ? "bg-white/10 border-white/20 text-foreground"
                            : "bg-transparent border-white/5 text-muted-foreground hover:border-white/10 hover:text-foreground"
                        }`}
                      >
                        {opt.value !== "all" && (
                          <span className={`w-1.5 h-1.5 rounded-full ${opt.dotColor} ${isActive ? "opacity-100" : "opacity-40"}`} />
                        )}
                        <span>{opt.label}</span>
                        <span className="opacity-40 font-mono">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Band section */}
              <div className="px-3 pb-2">
                <div className="flex items-center gap-1.5 mb-1.5 px-1">
                  <Waves className="w-3 h-3 text-muted-foreground/50" />
                  <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">
                    Band
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {BAND_OPTIONS.map((opt) => {
                    const count = bandCounts[opt.value] || 0;
                    const isActive = filterBand === opt.value;
                    if (opt.value !== "all" && count === 0) return null;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setFilterBand(opt.value)}
                        className={`text-[10px] font-medium px-2 py-1 rounded-lg border transition-all duration-200 flex items-center gap-1.5 ${
                          isActive
                            ? "bg-white/10 border-white/20 text-foreground"
                            : "bg-transparent border-white/5 text-muted-foreground hover:border-white/10 hover:text-foreground"
                        }`}
                        title={opt.description}
                      >
                        <span>{opt.label}</span>
                        {opt.description && (
                          <span className="opacity-30 font-mono text-[8px]">{opt.description}</span>
                        )}
                        <span className="opacity-40 font-mono">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Continent section */}
              <div className="px-3 pb-2">
                <div className="flex items-center gap-1.5 mb-1.5 px-1">
                  <Globe className="w-3 h-3 text-muted-foreground/50" />
                  <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">
                    Continent
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => setFilterContinent("all")}
                    className={`text-[10px] font-medium px-2 py-1 rounded-lg border transition-all duration-200 flex items-center gap-1.5 ${
                      filterContinent === "all"
                        ? "bg-white/10 border-white/20 text-foreground"
                        : "bg-transparent border-white/5 text-muted-foreground hover:border-white/10 hover:text-foreground"
                    }`}
                  >
                    <span>All</span>
                    <span className="opacity-40 font-mono">{continentCounts["all"] || 0}</span>
                  </button>
                  {CONTINENT_DEFINITIONS.map((c) => {
                    const count = continentCounts[c.id] || 0;
                    if (count === 0) return null;
                    const isActive = filterContinent === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => setFilterContinent(c.id)}
                        className={`text-[10px] font-medium px-2 py-1 rounded-lg border transition-all duration-200 flex items-center gap-1.5 ${
                          isActive
                            ? "bg-white/10 border-white/20 text-foreground"
                            : "bg-transparent border-white/5 text-muted-foreground hover:border-white/10 hover:text-foreground"
                        }`}
                      >
                        <span className="text-[8px] font-mono opacity-50">{c.emoji}</span>
                        <span>{c.label}</span>
                        <span className="opacity-40 font-mono">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Region section (only when a continent is selected) */}
              <AnimatePresence>
                {filterContinent !== "all" && availableRegions.length > 1 && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-3">
                      <div className="flex items-center gap-1.5 mb-1.5 px-1">
                        <MapPin className="w-3 h-3 text-muted-foreground/50" />
                        <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider">
                          Region
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          onClick={() => setFilterRegion("all")}
                          className={`text-[10px] font-medium px-2 py-1 rounded-lg border transition-all duration-200 flex items-center gap-1.5 ${
                            filterRegion === "all"
                              ? "bg-white/10 border-white/20 text-foreground"
                              : "bg-transparent border-white/5 text-muted-foreground hover:border-white/10 hover:text-foreground"
                          }`}
                        >
                          <span>All Regions</span>
                          <span className="opacity-40 font-mono">{continentCounts[filterContinent] || 0}</span>
                        </button>
                        {availableRegions.map((r) => {
                          const count = regionCounts[r.id] || 0;
                          const isActive = filterRegion === r.id;
                          return (
                            <button
                              key={r.id}
                              onClick={() => setFilterRegion(r.id)}
                              className={`text-[10px] font-medium px-2 py-1 rounded-lg border transition-all duration-200 flex items-center gap-1.5 ${
                                isActive
                                  ? "bg-white/10 border-white/20 text-foreground"
                                  : "bg-transparent border-white/5 text-muted-foreground hover:border-white/10 hover:text-foreground"
                              }`}
                            >
                              <span>{r.label}</span>
                              <span className="opacity-40 font-mono">{count}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Active filter summary (when collapsed) */}
      {!filtersExpanded && hasActiveFilters && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-1.5 px-3 py-1.5 glass-panel rounded-lg flex items-center gap-2 flex-wrap"
        >
          <span className="text-[9px] font-mono text-muted-foreground/50">Active:</span>
          {filterType !== "all" && (
            <span className="text-[9px] font-mono text-accent/80 bg-accent/10 px-1.5 py-0.5 rounded">
              {filterType}
            </span>
          )}
          {filterBand !== "all" && (
            <span className="text-[9px] font-mono text-accent/80 bg-accent/10 px-1.5 py-0.5 rounded">
              {filterBand}
            </span>
          )}
          {filterContinent !== "all" && (
            <span className="text-[9px] font-mono text-accent/80 bg-accent/10 px-1.5 py-0.5 rounded">
              {filterContinent}
            </span>
          )}
          {filterRegion !== "all" && (
            <span className="text-[9px] font-mono text-accent/80 bg-accent/10 px-1.5 py-0.5 rounded">
              {filterRegion}
            </span>
          )}
        </motion.div>
      )}

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
