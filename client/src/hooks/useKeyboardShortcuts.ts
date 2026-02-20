/**
 * useKeyboardShortcuts.ts — Global keyboard shortcuts for the application
 *
 * Maps single-key shortcuts to actions while avoiding conflicts with text input fields.
 * Shortcuts are disabled when the user is typing in an input, textarea, or select element,
 * or when an element with [contenteditable] is focused.
 *
 * Shortcut map:
 *   T  — Toggle TDoA panel
 *   S  — Focus search input
 *   D  — Navigate to dashboard
 *   W  — Toggle watchlist panel
 *   A  — Toggle alerts panel
 *   M  — Toggle military RF panel
 *   X  — Toggle targets panel
 *   N  — Toggle anomaly panel
 *   P  — Toggle propagation overlay
 *   C  — Toggle shared lists panel
 *   F  — Toggle conflict data overlay
 *   ?  — Show/hide keyboard shortcuts help overlay
 *   Escape — Close all panels / dismiss help overlay
 */
import { useEffect, useCallback, useState } from "react";

export interface ShortcutAction {
  key: string;
  label: string;
  description: string;
  category: "panels" | "navigation" | "general";
  action: () => void;
}

interface UseKeyboardShortcutsOptions {
  onToggleTdoa: () => void;
  onFocusSearch: () => void;
  onNavigateDashboard: () => void;
  onToggleWatchlist: () => void;
  onToggleAlerts: () => void;
  onToggleMilRf: () => void;
  onToggleTargets: () => void;
  onToggleAnomaly: () => void;
  onTogglePropagation: () => void;
  onToggleSharing: () => void;
  onToggleConflict: () => void;
  onEscapeAll: () => void;
}

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions) {
  const [helpOpen, setHelpOpen] = useState(false);

  const shortcuts: ShortcutAction[] = [
    { key: "T", label: "T", description: "Toggle TDoA panel", category: "panels", action: options.onToggleTdoa },
    { key: "S", label: "S", description: "Focus search input", category: "navigation", action: options.onFocusSearch },
    { key: "D", label: "D", description: "Open analytics dashboard", category: "navigation", action: options.onNavigateDashboard },
    { key: "W", label: "W", description: "Toggle watchlist panel", category: "panels", action: options.onToggleWatchlist },
    { key: "A", label: "A", description: "Toggle alerts panel", category: "panels", action: options.onToggleAlerts },
    { key: "M", label: "M", description: "Toggle military RF panel", category: "panels", action: options.onToggleMilRf },
    { key: "X", label: "X", description: "Toggle targets panel", category: "panels", action: options.onToggleTargets },
    { key: "N", label: "N", description: "Toggle anomaly panel", category: "panels", action: options.onToggleAnomaly },
    { key: "P", label: "P", description: "Toggle propagation overlay", category: "panels", action: options.onTogglePropagation },
    { key: "C", label: "C", description: "Toggle shared lists panel", category: "panels", action: options.onToggleSharing },
    { key: "F", label: "F", description: "Toggle conflict data overlay", category: "panels", action: options.onToggleConflict },
    { key: "?", label: "?", description: "Show keyboard shortcuts help", category: "general", action: () => setHelpOpen((v) => !v) },
    { key: "Escape", label: "Esc", description: "Close all panels / dismiss overlay", category: "general", action: options.onEscapeAll },
  ];

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Always allow Escape
      if (e.key === "Escape") {
        if (helpOpen) {
          e.preventDefault();
          setHelpOpen(false);
          return;
        }
        e.preventDefault();
        options.onEscapeAll();
        return;
      }

      // Don't intercept when user is typing
      if (isInputFocused()) return;

      // Don't intercept if modifier keys are held (except Shift for ?)
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const key = e.key;

      if (key === "?") {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }

      // Match single-letter shortcuts (case-insensitive)
      const upper = key.toUpperCase();
      const shortcut = shortcuts.find((s) => s.key === upper && s.key !== "?" && s.key !== "Escape");
      if (shortcut) {
        e.preventDefault();
        shortcut.action();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [helpOpen, options.onToggleTdoa, options.onFocusSearch, options.onNavigateDashboard,
     options.onToggleWatchlist, options.onToggleAlerts, options.onToggleMilRf,
     options.onToggleTargets, options.onToggleAnomaly, options.onTogglePropagation,
     options.onToggleSharing, options.onToggleConflict, options.onEscapeAll]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return {
    helpOpen,
    setHelpOpen,
    shortcuts,
  };
}
