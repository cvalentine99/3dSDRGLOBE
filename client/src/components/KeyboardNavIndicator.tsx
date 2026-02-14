/**
 * KeyboardNavIndicator.tsx — Visual indicator for keyboard navigation
 * Shows the currently highlighted station name and keyboard shortcuts
 * Appears at the bottom center when arrow keys are used
 */
import { motion, AnimatePresence } from "framer-motion";
import { ChevronUp, ChevronDown, CornerDownLeft, X } from "lucide-react";
import type { Station } from "@/lib/types";

interface Props {
  highlightedStation: Station | null;
  highlightedIndex: number;
  totalCount: number;
  isActive: boolean;
}

export default function KeyboardNavIndicator({
  highlightedStation,
  highlightedIndex,
  totalCount,
  isActive,
}: Props) {
  return (
    <AnimatePresence>
      {isActive && highlightedStation && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.2 }}
          className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30 pointer-events-none"
        >
          <div className="glass-panel rounded-xl px-4 py-2.5 flex items-center gap-3 max-w-md">
            {/* Station info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">
                {highlightedStation.label}
              </p>
              <p className="text-[9px] font-mono text-muted-foreground/60 mt-0.5">
                {highlightedIndex + 1} / {totalCount}
              </p>
            </div>

            {/* Key hints */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-0.5">
                <kbd className="inline-flex items-center justify-center w-5 h-5 rounded bg-white/10 border border-white/10 text-[9px] text-muted-foreground">
                  <ChevronUp className="w-3 h-3" />
                </kbd>
                <kbd className="inline-flex items-center justify-center w-5 h-5 rounded bg-white/10 border border-white/10 text-[9px] text-muted-foreground">
                  <ChevronDown className="w-3 h-3" />
                </kbd>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="inline-flex items-center justify-center h-5 px-1.5 rounded bg-white/10 border border-white/10 text-[8px] font-mono text-muted-foreground">
                  <CornerDownLeft className="w-3 h-3 mr-0.5" />
                  Enter
                </kbd>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="inline-flex items-center justify-center h-5 px-1.5 rounded bg-white/10 border border-white/10 text-[8px] font-mono text-muted-foreground">
                  <X className="w-2.5 h-2.5 mr-0.5" />
                  Esc
                </kbd>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
