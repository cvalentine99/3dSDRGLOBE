/**
 * StationList.tsx — Scrollable station list sidebar
 * Design: "Ether" — frosted glass panel with compact station rows
 * Shows all filtered stations in a browsable list, complementing the search
 */
import { useRadio } from "@/contexts/RadioContext";
import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { List, Radio, ChevronLeft, ChevronRight, MapPin } from "lucide-react";

const TYPE_DOT: Record<string, string> = {
  OpenWebRX: "bg-cyan-400",
  WebSDR: "bg-red-400",
  KiwiSDR: "bg-green-400",
};

// Virtual scrolling: only render visible items for performance
const ITEM_HEIGHT = 64; // px per row
const OVERSCAN = 5; // extra items above/below viewport

export default function StationList() {
  const {
    filteredStations,
    selectStation,
    selectedStation,
    stationRegions,
  } = useRadio();

  const [isOpen, setIsOpen] = useState(false);
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

  // Virtual scroll calculations
  const totalHeight = filteredStations.length * ITEM_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    filteredStations.length,
    Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + OVERSCAN
  );
  const visibleStations = useMemo(
    () => filteredStations.slice(startIndex, endIndex),
    [filteredStations, startIndex, endIndex]
  );

  // Scroll to selected station when it changes
  useEffect(() => {
    if (!selectedStation || !scrollRef.current || !isOpen) return;
    const idx = filteredStations.indexOf(selectedStation);
    if (idx >= 0) {
      const targetScroll = idx * ITEM_HEIGHT - containerHeight / 2 + ITEM_HEIGHT / 2;
      scrollRef.current.scrollTo({ top: Math.max(0, targetScroll), behavior: "smooth" });
    }
  }, [selectedStation, isOpen, filteredStations, containerHeight]);

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
          <span className="text-[9px] font-mono text-muted-foreground/60 writing-mode-vertical"
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
                  {filteredStations.length} targets matching filters
                </p>
              </div>
              <List className="w-4 h-4 text-muted-foreground/40" />
            </div>

            {/* Scrollable list with virtual scrolling */}
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto overflow-x-hidden"
              style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}
            >
              <div style={{ height: totalHeight, position: "relative" }}>
                {visibleStations.map((station, i) => {
                  const actualIndex = startIndex + i;
                  const isSelected =
                    selectedStation &&
                    station.label === selectedStation.label &&
                    station.location.coordinates[0] === selectedStation.location.coordinates[0] &&
                    station.location.coordinates[1] === selectedStation.location.coordinates[1];

                  const primaryType = station.receivers[0]?.type || "WebSDR";
                  const region = stationRegions.get(station) || "";

                  return (
                    <button
                      key={`${station.label}-${actualIndex}`}
                      onClick={() => selectStation(station)}
                      className={`absolute left-0 right-0 w-full text-left px-4 py-2 transition-all duration-150 border-b border-white/3 hover:bg-white/5 ${
                        isSelected ? "bg-white/8 border-l-2 border-l-primary" : ""
                      }`}
                      style={{
                        top: actualIndex * ITEM_HEIGHT,
                        height: ITEM_HEIGHT,
                      }}
                    >
                      <div className="flex items-start gap-3 h-full">
                        <div className="flex flex-col items-center gap-1 pt-1 shrink-0">
                          <div className={`w-2 h-2 rounded-full ${TYPE_DOT[primaryType] || "bg-red-400"} ${
                            isSelected ? "shadow-sm shadow-primary/50" : ""
                          }`} />
                          <span className="text-[8px] font-mono text-muted-foreground/30">
                            {actualIndex + 1}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs font-medium truncate leading-tight ${
                            isSelected ? "text-foreground" : "text-foreground/80"
                          }`}>
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
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-white/5 shrink-0">
              <p className="text-[9px] font-mono text-muted-foreground/40 text-center">
                Click a station to select • Globe rotates to target
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
