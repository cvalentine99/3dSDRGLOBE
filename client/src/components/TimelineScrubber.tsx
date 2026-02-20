/**
 * TimelineScrubber — Animated timeline slider for conflict event playback
 *
 * Allows month-by-month scrubbing through conflict data with play/pause,
 * speed controls, and visual month/year indicator.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, SkipBack, SkipForward, Clock, ChevronLeft, ChevronRight } from "lucide-react";

interface TimelineScrubberProps {
  /** Start date of the data range (ISO string YYYY-MM-DD) */
  startDate: string;
  /** End date of the data range (ISO string YYYY-MM-DD) */
  endDate: string;
  /** Callback when the active month changes — returns [startOfMonth, endOfMonth] ISO strings */
  onMonthChange: (start: string, end: string) => void;
  /** Whether to show all events (no time filter) */
  onShowAll: () => void;
  /** Whether the scrubber is active (filtering by time) */
  isActive: boolean;
}

interface MonthEntry {
  year: number;
  month: number; // 0-11
  label: string; // "Jan 2024"
  startDate: string; // ISO
  endDate: string; // ISO
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const SPEED_OPTIONS = [
  { label: "0.5x", ms: 2000 },
  { label: "1x", ms: 1000 },
  { label: "2x", ms: 500 },
  { label: "4x", ms: 250 },
];

function parseLocalDate(dateStr: string): { year: number; month: number } {
  const [y, m] = dateStr.split("-").map(Number);
  return { year: y, month: m - 1 }; // month is 0-indexed
}

function generateMonths(startDate: string, endDate: string): MonthEntry[] {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  const months: MonthEntry[] = [];

  let current = new Date(start.year, start.month, 1);
  const lastMonth = new Date(end.year, end.month, 1);

  while (current <= lastMonth) {
    const year = current.getFullYear();
    const month = current.getMonth();
    const nextMonth = new Date(year, month + 1, 1);
    const endOfMonth = new Date(nextMonth.getTime() - 1);

    months.push({
      year,
      month,
      label: `${MONTH_NAMES[month]} ${year}`,
      startDate: `${year}-${String(month + 1).padStart(2, "0")}-01`,
      endDate: `${endOfMonth.getFullYear()}-${String(endOfMonth.getMonth() + 1).padStart(2, "0")}-${String(endOfMonth.getDate()).padStart(2, "0")}`,
    });

    current = nextMonth;
  }

  return months;
}

export default function TimelineScrubber({
  startDate,
  endDate,
  onMonthChange,
  onShowAll,
  isActive,
}: TimelineScrubberProps) {
  const months = useMemo(() => generateMonths(startDate, endDate), [startDate, endDate]);
  const [currentIndex, setCurrentIndex] = useState(months.length - 1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(1); // Default 1x
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clamp index when months change
  useEffect(() => {
    if (currentIndex >= months.length) {
      setCurrentIndex(months.length - 1);
    }
  }, [months.length, currentIndex]);

  // Notify parent when month changes
  useEffect(() => {
    if (isActive && months[currentIndex]) {
      const m = months[currentIndex];
      onMonthChange(m.startDate, m.endDate);
    }
  }, [currentIndex, isActive, months, onMonthChange]);

  // Playback timer
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= months.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, SPEED_OPTIONS[speedIndex].ms);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPlaying, speedIndex, months.length]);

  const handlePlay = useCallback(() => {
    if (currentIndex >= months.length - 1) {
      setCurrentIndex(0);
    }
    setIsPlaying(true);
  }, [currentIndex, months.length]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handlePrev = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleNext = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex((prev) => Math.min(months.length - 1, prev + 1));
  }, [months.length]);

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setIsPlaying(false);
    setCurrentIndex(Number(e.target.value));
  }, []);

  const cycleSpeed = useCallback(() => {
    setSpeedIndex((prev) => (prev + 1) % SPEED_OPTIONS.length);
  }, []);

  if (months.length === 0) return null;

  const currentMonth = months[currentIndex];
  const progress = months.length > 1 ? currentIndex / (months.length - 1) : 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="glass-panel rounded-xl overflow-hidden mt-2"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-red-500 dark:text-red-400" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            Timeline
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isActive ? (
            <button
              onClick={onShowAll}
              className="text-[9px] px-1.5 py-0.5 rounded bg-foreground/10 text-muted-foreground hover:bg-foreground/15 transition-colors"
            >
              Show All
            </button>
          ) : (
            <button
              onClick={() => {
                setCurrentIndex(months.length - 1);
                onMonthChange(currentMonth.startDate, currentMonth.endDate);
              }}
              className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-500/30 transition-colors"
            >
              Enable
            </button>
          )}
        </div>
      </div>

      {/* Current month display */}
      <div className="px-3 pt-2 pb-1">
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={handlePrev}
            disabled={currentIndex === 0}
            className="p-0.5 rounded hover:bg-foreground/10 transition-colors disabled:opacity-30"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <div className="text-center min-w-[100px]">
            <div className="text-sm font-semibold text-foreground font-mono">
              {currentMonth?.label ?? "—"}
            </div>
            <div className="text-[9px] text-muted-foreground">
              {currentIndex + 1} / {months.length} months
            </div>
          </div>
          <button
            onClick={handleNext}
            disabled={currentIndex >= months.length - 1}
            className="p-0.5 rounded hover:bg-foreground/10 transition-colors disabled:opacity-30"
          >
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Slider */}
      <div className="px-3 py-1">
        <input
          type="range"
          min={0}
          max={months.length - 1}
          value={currentIndex}
          onChange={handleSliderChange}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-3
            [&::-webkit-slider-thumb]:h-3
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-red-500
            [&::-webkit-slider-thumb]:border-2
            [&::-webkit-slider-thumb]:border-background
            [&::-webkit-slider-thumb]:shadow-sm
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-moz-range-thumb]:w-3
            [&::-moz-range-thumb]:h-3
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-red-500
            [&::-moz-range-thumb]:border-2
            [&::-moz-range-thumb]:border-background
            [&::-moz-range-thumb]:cursor-pointer"
          style={{
            background: `linear-gradient(to right, #ef4444 0%, #ef4444 ${progress * 100}%, var(--color-foreground, #888) ${progress * 100}%, var(--color-foreground, #888) 100%)`,
            opacity: 0.6,
          }}
        />
        {/* Year markers */}
        <div className="flex justify-between mt-0.5">
          {months.length > 2 && (
            <>
              <span className="text-[8px] text-muted-foreground font-mono">
                {months[0].label}
              </span>
              <span className="text-[8px] text-muted-foreground font-mono">
                {months[months.length - 1].label}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-2 px-3 pb-2">
        <button
          onClick={() => { setIsPlaying(false); setCurrentIndex(0); }}
          className="p-1 rounded hover:bg-foreground/10 transition-colors"
          title="Go to start"
        >
          <SkipBack className="w-3 h-3 text-muted-foreground" />
        </button>

        {isPlaying ? (
          <button
            onClick={handlePause}
            className="p-1.5 rounded-full bg-red-500/20 hover:bg-red-500/30 transition-colors"
            title="Pause"
          >
            <Pause className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
          </button>
        ) : (
          <button
            onClick={handlePlay}
            className="p-1.5 rounded-full bg-red-500/20 hover:bg-red-500/30 transition-colors"
            title="Play"
          >
            <Play className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
          </button>
        )}

        <button
          onClick={() => { setIsPlaying(false); setCurrentIndex(months.length - 1); }}
          className="p-1 rounded hover:bg-foreground/10 transition-colors"
          title="Go to end"
        >
          <SkipForward className="w-3 h-3 text-muted-foreground" />
        </button>

        <button
          onClick={cycleSpeed}
          className="text-[9px] px-1.5 py-0.5 rounded bg-foreground/10 text-muted-foreground hover:bg-foreground/15 transition-colors font-mono min-w-[28px] text-center"
          title="Playback speed"
        >
          {SPEED_OPTIONS[speedIndex].label}
        </button>
      </div>
    </motion.div>
  );
}
