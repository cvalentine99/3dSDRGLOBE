/**
 * ShortcutHelpOverlay.tsx — Modal overlay showing all keyboard shortcuts
 *
 * Triggered by pressing "?" key. Shows categorized shortcuts with visual key badges.
 * Uses Framer Motion for smooth enter/exit animations and glass-panel styling.
 */
import { motion, AnimatePresence } from "framer-motion";
import { X, Keyboard } from "lucide-react";
import type { ShortcutAction } from "@/hooks/useKeyboardShortcuts";

interface ShortcutHelpOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  shortcuts: ShortcutAction[];
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  panels: { label: "Panels", color: "text-violet-400" },
  navigation: { label: "Navigation", color: "text-cyan-400" },
  general: { label: "General", color: "text-amber-400" },
};

const CATEGORY_ORDER = ["panels", "navigation", "general"];

export default function ShortcutHelpOverlay({ isOpen, onClose, shortcuts }: ShortcutHelpOverlayProps) {
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    ...CATEGORY_LABELS[cat],
    items: shortcuts.filter((s) => s.category === cat),
  }));

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="fixed inset-0 z-[101] flex items-center justify-center pointer-events-none"
          >
            <div
              className="glass-panel rounded-2xl p-6 w-full max-w-lg mx-4 pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center">
                    <Keyboard className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">Keyboard Shortcuts</h2>
                    <p className="text-[11px] text-muted-foreground font-mono">Press any key to trigger</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-lg bg-foreground/5 border border-border flex items-center justify-center hover:bg-foreground/10 transition-colors"
                  aria-label="Close shortcuts help"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              {/* Shortcut categories */}
              <div className="space-y-4">
                {grouped.map((group) => (
                  <div key={group.category}>
                    <h3 className={`text-[11px] font-mono uppercase tracking-wider mb-2 ${group.color}`}>
                      {group.label}
                    </h3>
                    <div className="space-y-1.5">
                      {group.items.map((shortcut) => (
                        <div
                          key={shortcut.key}
                          className="flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-foreground/5 transition-colors"
                        >
                          <span className="text-sm text-foreground/80">{shortcut.description}</span>
                          <kbd className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-md bg-foreground/10 border border-border text-xs font-mono font-medium text-foreground/90 shadow-sm">
                            {shortcut.label}
                          </kbd>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer note */}
              <div className="mt-5 pt-4 border-t border-border">
                <p className="text-[11px] text-muted-foreground text-center font-mono">
                  Shortcuts are disabled when typing in input fields
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
