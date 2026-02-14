/**
 * useKeyboardNav.ts — Keyboard navigation for cycling through stations
 * Arrow Up/Down: cycle through filtered stations
 * Enter: select the highlighted station (opens panel + rotates globe)
 * Escape: deselect / close panel
 * 
 * The hook tracks a "highlighted" index separate from the selected station,
 * so the user can preview stations before committing with Enter.
 */
import { useEffect, useCallback, useRef, useState } from "react";
import { useRadio } from "@/contexts/RadioContext";

export function useKeyboardNav() {
  const {
    filteredStations,
    selectStation,
    selectedStation,
    setShowPanel,
  } = useRadio();

  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [isKeyNavActive, setIsKeyNavActive] = useState(false);
  const stationsRef = useRef(filteredStations);
  stationsRef.current = filteredStations;

  // Reset highlight when filtered stations change
  useEffect(() => {
    setHighlightedIndex(-1);
    setIsKeyNavActive(false);
  }, [filteredStations]);

  // Sync highlighted index when a station is selected externally (e.g. by click)
  useEffect(() => {
    if (selectedStation && !isKeyNavActive) {
      const idx = stationsRef.current.findIndex(
        (s) =>
          s.label === selectedStation.label &&
          s.location.coordinates[0] === selectedStation.location.coordinates[0] &&
          s.location.coordinates[1] === selectedStation.location.coordinates[1]
      );
      if (idx >= 0) {
        setHighlightedIndex(idx);
      }
    }
  }, [selectedStation, isKeyNavActive]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't intercept when user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const stations = stationsRef.current;
      if (stations.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
        case "j": {
          e.preventDefault();
          setIsKeyNavActive(true);
          setHighlightedIndex((prev) => {
            const next = prev < stations.length - 1 ? prev + 1 : 0;
            return next;
          });
          break;
        }
        case "ArrowUp":
        case "k": {
          e.preventDefault();
          setIsKeyNavActive(true);
          setHighlightedIndex((prev) => {
            const next = prev > 0 ? prev - 1 : stations.length - 1;
            return next;
          });
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (highlightedIndex >= 0 && highlightedIndex < stations.length) {
            selectStation(stations[highlightedIndex]);
          }
          break;
        }
        case "Escape": {
          e.preventDefault();
          selectStation(null);
          setShowPanel(false);
          setHighlightedIndex(-1);
          setIsKeyNavActive(false);
          break;
        }
        default:
          break;
      }
    },
    [highlightedIndex, selectStation, setShowPanel]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // The highlighted station (for visual feedback)
  const highlightedStation =
    highlightedIndex >= 0 && highlightedIndex < filteredStations.length
      ? filteredStations[highlightedIndex]
      : null;

  return {
    highlightedIndex,
    highlightedStation,
    isKeyNavActive,
  };
}
