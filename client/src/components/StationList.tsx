/**
 * StationList.tsx — Scrollable station list sidebar with sorting & favorites
 * Design: "Ether" — frosted glass panel with compact station rows
 * Supports sort by name, type, receivers, region. Favorites filter toggle.
 */
import { useRadio } from "@/contexts/RadioContext";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  List,
  Radio,
  ChevronLeft,
  ChevronRight,
  MapPin,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  SortAsc,
  Star,
} from "lucide-react";
import type { Station } from "@/lib/types";

const TYPE_DOT: Record<string, string> = {
  OpenWebRX: "bg-cyan-400",
  WebSDR: "bg-red-400",
  KiwiSDR: "bg-green-400",
};

// Sort priority for type sorting
const TYPE_ORDER: Record<string, number> = {
  KiwiSDR: 0,
  OpenWebRX: 1,
  WebSDR: 2,
};

type SortField = "name" | "type" | "receivers" | "region";
type SortDirection = "asc" | "desc";

const SORT_OPTIONS: { field: SortField; label: string; shortLabel: string }[] = [
  { field: "name", label: "Station Name", shortLabel: "Name" },
  { field: "type", label: "Receiver Type", shortLabel: "Type" },
  { field: "receivers", label: "Receiver Count", shortLabel: "Count" },
  { field: "region", label: "Region", shortLabel: "Region" },
];

// Virtual scrolling: only render visible items for performance
const ITEM_HEIGHT = 64;
const OVERSCAN = 5;

export default function StationList() {
  const {
    filteredStations,
    selectStation,
    selectedStation,
    stationRegions,
    stationContinents,
    isFavorite,
    toggleFavorite,
    favoriteCount,
  } = useRadio();

  const [isOpen, setIsOpen] = useState(false);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  // Measure container height
  useEffect(() => {
    if (!scrollRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, [isOpen]);

  const handleScroll = () => {
    if (scrollRef.current) {
      setScrollTop(scrollRef.current.scrollTop);
    }
  };

  // Toggle sort: if same field, flip direction; if new field, set ascending
  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDirection(field === "receivers" ? "desc" : "asc");
      }
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
        setScrollTop(0);
      }
    },
    [sortField]
  );

  // Filter by favorites if toggled
  const favFilteredStations = useMemo(() => {
    if (!showFavoritesOnly) return filteredStations;
    return filteredStations.filter((s) => isFavorite(s));
  }, [filteredStations, showFavoritesOnly, isFavorite]);

  // Count favorites in current filtered set
  const filteredFavCount = useMemo(() => {
    return filteredStations.filter((s) => isFavorite(s)).length;
  }, [filteredStations, isFavorite]);

  // Sorted stations
  const sortedStations = useMemo(() => {
    const sorted = [...favFilteredStations];
    const dir = sortDirection === "asc" ? 1 : -1;

    sorted.sort((a: Station, b: Station) => {
      // Always put favorites first when not in favorites-only mode
      if (!showFavoritesOnly) {
        const aFav = isFavorite(a);
        const bFav = isFavorite(b);
        if (aFav && !bFav) return -1;
        if (!aFav && bFav) return 1;
      }

      switch (sortField) {
        case "name":
          return dir * a.label.localeCompare(b.label);
        case "type": {
          const typeA = a.receivers[0]?.type || "WebSDR";
          const typeB = b.receivers[0]?.type || "WebSDR";
          const orderDiff = (TYPE_ORDER[typeA] ?? 99) - (TYPE_ORDER[typeB] ?? 99);
          if (orderDiff !== 0) return dir * orderDiff;
          return dir * a.label.localeCompare(b.label);
        }
        case "receivers":
          return dir * (a.receivers.length - b.receivers.length);
        case "region": {
          const regionA = stationRegions.get(a) || "";
          const regionB = stationRegions.get(b) || "";
          const continentA = stationContinents.get(a) || "";
          const continentB = stationContinents.get(b) || "";
          // Sort by continent first, then region, then name
          const contDiff = continentA.localeCompare(continentB);
          if (contDiff !== 0) return dir * contDiff;
          const regDiff = regionA.localeCompare(regionB);
          if (regDiff !== 0) return dir * regDiff;
          return dir * a.label.localeCompare(b.label);
        }
        default:
          return 0;
      }
    });

    return sorted;
  }, [favFilteredStations, sortField, sortDirection, stationRegions, stationContinents, isFavorite, showFavoritesOnly]);

  // Virtual scroll calculations
  const totalHeight = sortedStations.length * ITEM_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    sortedStations.length,
    Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + OVERSCAN
  );
  const visibleStations = useMemo(
    () => sortedStations.slice(startIndex, endIndex),
    [sortedStations, startIndex, endIndex]
  );

  // Scroll to selected station when it changes
  useEffect(() => {
    if (!selectedStation || !scrollRef.current || !isOpen) return;
    const idx = sortedStations.findIndex(
      (s) =>
        s.label === selectedStation.label &&
        s.location.coordinates[0] === selectedStation.location.coordinates[0] &&
        s.location.coordinates[1] === selectedStation.location.coordinates[1]
    );
    if (idx >= 0) {
      const targetScroll = idx * ITEM_HEIGHT - containerHeight / 2 + ITEM_HEIGHT / 2;
      scrollRef.current.scrollTo({ top: Math.max(0, targetScroll), behavior: "smooth" });
    }
  }, [selectedStation, isOpen, sortedStations, containerHeight]);

  const DirectionIcon = sortDirection === "asc" ? ArrowUp : ArrowDown;

  return (
    <>
      {/* Toggle button */}
      <motion.button
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 1.2, duration: 0.4 }}
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed right-0 top-1/2 -translate-y-1/2 z-30 glass-panel rounded-l-xl px-2 py-4 transition-all duration-300 hover:bg-white/10 ${
          isOpen ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
        title="Open station list"
      >
        <div className="flex flex-col items-center gap-2">
          <List className="w-4 h-4 text-muted-foreground" />
          <span
            className="text-[9px] font-mono text-muted-foreground/60"
            style={{ writingMode: "vertical-rl" }}
          >
            {filteredStations.length} stations
          </span>
          <ChevronLeft className="w-3 h-3 text-muted-foreground/40" />
        </div>
      </motion.button>

      {/* Sidebar panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ x: 360, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 360, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 220 }}
            className="fixed right-0 top-0 bottom-0 w-[340px] z-30 glass-panel border-l border-white/5 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 shrink-0">
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-foreground">Station Directory</h3>
                <p className="text-[10px] font-mono text-muted-foreground/60">
                  {sortedStations.length} targets{showFavoritesOnly ? " (favorites)" : " matching filters"}
                </p>
              </div>
              <SortAsc className="w-4 h-4 text-muted-foreground/40" />
            </div>

            {/* Sort & Favorites controls */}
            <div className="px-4 py-2 border-b border-white/5 shrink-0 space-y-2">
              {/* Sort row */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <ArrowUpDown className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wider shrink-0 mr-0.5">
                  Sort
                </span>
                {SORT_OPTIONS.map((opt) => {
                  const isActive = sortField === opt.field;
                  return (
                    <button
                      key={opt.field}
                      onClick={() => handleSort(opt.field)}
                      title={`Sort by ${opt.label}`}
                      className={`text-[10px] font-medium px-2 py-1 rounded-lg border transition-all duration-200 flex items-center gap-1 ${
                        isActive
                          ? "bg-white/10 border-white/20 text-foreground"
                          : "bg-transparent border-white/5 text-muted-foreground/70 hover:border-white/10 hover:text-foreground"
                      }`}
                    >
                      <span>{opt.shortLabel}</span>
                      {isActive && (
                        <DirectionIcon className="w-2.5 h-2.5 text-accent" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Favorites toggle row */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setShowFavoritesOnly(!showFavoritesOnly);
                    if (scrollRef.current) {
                      scrollRef.current.scrollTop = 0;
                      setScrollTop(0);
                    }
                  }}
                  className={`text-[10px] font-medium px-2.5 py-1 rounded-lg border transition-all duration-200 flex items-center gap-1.5 ${
                    showFavoritesOnly
                      ? "bg-yellow-400/10 border-yellow-400/25 text-yellow-400"
                      : "bg-transparent border-white/5 text-muted-foreground/60 hover:border-white/10 hover:text-yellow-400/70"
                  }`}
                >
                  <Star className={`w-3 h-3 ${showFavoritesOnly ? "fill-yellow-400" : ""}`} />
                  <span>Favorites</span>
                  <span className="font-mono opacity-60">{filteredFavCount}</span>
                </button>
                {showFavoritesOnly && filteredFavCount === 0 && (
                  <span className="text-[9px] font-mono text-muted-foreground/40">
                    No favorites yet — star stations to save them
                  </span>
                )}
              </div>
            </div>

            {/* Scrollable list with virtual scrolling */}
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto overflow-x-hidden"
              style={{
                scrollbarWidth: "thin",
                scrollbarColor: "rgba(255,255,255,0.1) transparent",
              }}
            >
              {sortedStations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <Star className="w-8 h-8 text-muted-foreground/20 mb-3" />
                  <p className="text-sm text-muted-foreground/50 font-medium">
                    {showFavoritesOnly ? "No favorites yet" : "No stations found"}
                  </p>
                  <p className="text-[10px] font-mono text-muted-foreground/30 mt-1">
                    {showFavoritesOnly
                      ? "Click the star icon on any station to bookmark it"
                      : "Try adjusting your filters"}
                  </p>
                </div>
              ) : (
                <div style={{ height: totalHeight, position: "relative" }}>
                  {visibleStations.map((station, i) => {
                    const actualIndex = startIndex + i;
                    const isSelected =
                      selectedStation &&
                      station.label === selectedStation.label &&
                      station.location.coordinates[0] ===
                        selectedStation.location.coordinates[0] &&
                      station.location.coordinates[1] ===
                        selectedStation.location.coordinates[1];

                    const primaryType = station.receivers[0]?.type || "WebSDR";
                    const region = stationRegions.get(station) || "";
                    const starred = isFavorite(station);

                    return (
                      <div
                        key={`${station.label}-${station.location.coordinates[0]}-${actualIndex}`}
                        className={`absolute left-0 right-0 w-full text-left px-4 py-2 transition-all duration-150 border-b border-white/3 hover:bg-white/5 flex items-start gap-2 ${
                          isSelected
                            ? "bg-white/8 border-l-2 border-l-primary"
                            : ""
                        }`}
                        style={{
                          top: actualIndex * ITEM_HEIGHT,
                          height: ITEM_HEIGHT,
                        }}
                      >
                        {/* Star button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(station);
                          }}
                          className={`mt-1 shrink-0 p-0.5 rounded transition-all duration-200 ${
                            starred
                              ? "text-yellow-400"
                              : "text-muted-foreground/20 hover:text-yellow-400/60"
                          }`}
                          title={starred ? "Remove from favorites" : "Add to favorites"}
                        >
                          <Star className={`w-3 h-3 ${starred ? "fill-yellow-400" : ""}`} />
                        </button>

                        {/* Main clickable area */}
                        <button
                          onClick={() => selectStation(station)}
                          className="flex items-start gap-2 flex-1 min-w-0 h-full text-left"
                        >
                          <div className="flex flex-col items-center gap-1 pt-1 shrink-0">
                            <div
                              className={`w-2 h-2 rounded-full ${
                                TYPE_DOT[primaryType] || "bg-red-400"
                              } ${isSelected ? "shadow-sm shadow-primary/50" : ""}`}
                            />
                            <span className="text-[8px] font-mono text-muted-foreground/30">
                              {actualIndex + 1}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-xs font-medium truncate leading-tight ${
                                isSelected
                                  ? "text-foreground"
                                  : "text-foreground/80"
                              }`}
                            >
                              {station.label}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1">
                              {station.receivers
                                .map((r) => r.type)
                                .filter((v, i, a) => a.indexOf(v) === i)
                                .map((type) => (
                                  <span
                                    key={type}
                                    className="text-[8px] font-mono text-muted-foreground/60 bg-white/5 px-1 py-0.5 rounded"
                                  >
                                    {type}
                                  </span>
                                ))}
                              <span className="text-[8px] font-mono text-muted-foreground/40">
                                {station.receivers.length}x
                              </span>
                            </div>
                            {region && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <MapPin className="w-2.5 h-2.5 text-muted-foreground/30" />
                                <span className="text-[8px] font-mono text-muted-foreground/40 truncate">
                                  {region}
                                </span>
                              </div>
                            )}
                          </div>
                          {isSelected && (
                            <Radio className="w-3.5 h-3.5 text-primary shrink-0 mt-1 animate-pulse" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-white/5 shrink-0">
              <p className="text-[9px] font-mono text-muted-foreground/40 text-center">
                {favoriteCount > 0
                  ? `${favoriteCount} favorite${favoriteCount !== 1 ? "s" : ""} saved • `
                  : ""}
                Click a station to select • Globe rotates to target
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
