/**
 * ThemeToggle.tsx — Dark/light theme switcher button
 *
 * Renders a compact toggle button with sun/moon icon that matches the nav bar style.
 * Uses the ThemeContext to toggle between dark and light themes.
 */
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { motion, AnimatePresence } from "framer-motion";

export default function ThemeToggle() {
  const { theme, toggleTheme, switchable } = useTheme();

  if (!switchable || !toggleTheme) return null;

  const isDark = theme === "dark";

  return (
    <button
      onClick={toggleTheme}
      className="relative flex items-center gap-2 px-3 py-2 rounded-lg backdrop-blur-md transition-all group bg-yellow-500/10 border border-yellow-500/20 hover:bg-yellow-500/20 hover:border-yellow-500/30"
      title={`Switch to ${isDark ? "light" : "dark"} theme`}
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDark ? (
          <motion.div
            key="sun"
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Sun className="w-4 h-4 text-yellow-400 group-hover:text-yellow-300 transition-colors" />
          </motion.div>
        ) : (
          <motion.div
            key="moon"
            initial={{ rotate: 90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: -90, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Moon className="w-4 h-4 text-yellow-400 group-hover:text-yellow-300 transition-colors" />
          </motion.div>
        )}
      </AnimatePresence>
      <span className="text-[10px] font-mono text-yellow-300/80 uppercase tracking-wider group-hover:text-yellow-200 transition-colors hidden sm:inline">
        {isDark ? "Light" : "Dark"}
      </span>
    </button>
  );
}
