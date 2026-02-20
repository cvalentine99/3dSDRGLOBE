/**
 * NavBarGroup.tsx — Collapsible nav bar group with dropdown menu
 * Groups multiple feature buttons under a single icon with expandable dropdown.
 * Uses a static color config map to avoid Tailwind JIT dynamic class issues.
 */
import { useState, useRef, useEffect, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

/** Color configuration with all Tailwind classes pre-defined */
const COLOR_MAP: Record<string, {
  bg: string; bgActive: string; border: string; borderActive: string;
  hoverBg: string; hoverBorder: string;
  text: string; textActive: string; textLabel: string; textLabelActive: string;
  dot: string; badge: string; badgeShadow: string;
  itemBg: string; itemText: string; itemIcon: string; itemIconHover: string;
}> = {
  cyan: {
    bg: "bg-cyan-500/10", bgActive: "bg-cyan-500/25",
    border: "border-cyan-500/20", borderActive: "border-cyan-500/40",
    hoverBg: "hover:bg-cyan-500/20", hoverBorder: "hover:border-cyan-500/30",
    text: "text-cyan-600 dark:text-cyan-400", textActive: "text-cyan-600 dark:text-cyan-300",
    textLabel: "text-cyan-600/80 dark:text-cyan-300/80", textLabelActive: "text-cyan-700 dark:text-cyan-200",
    dot: "bg-cyan-500", badge: "bg-cyan-500", badgeShadow: "shadow-cyan-500/30",
    itemBg: "bg-cyan-500/20", itemText: "text-cyan-700 dark:text-cyan-200",
    itemIcon: "text-cyan-600 dark:text-cyan-400", itemIconHover: "group-hover/item:text-cyan-700 dark:group-hover/item:text-cyan-300",
  },
  violet: {
    bg: "bg-violet-500/10", bgActive: "bg-violet-500/25",
    border: "border-violet-500/20", borderActive: "border-violet-500/40",
    hoverBg: "hover:bg-violet-500/20", hoverBorder: "hover:border-violet-500/30",
    text: "text-violet-600 dark:text-violet-400", textActive: "text-violet-600 dark:text-violet-300",
    textLabel: "text-violet-600/80 dark:text-violet-300/80", textLabelActive: "text-violet-700 dark:text-violet-200",
    dot: "bg-violet-500", badge: "bg-violet-500", badgeShadow: "shadow-violet-500/30",
    itemBg: "bg-violet-500/20", itemText: "text-violet-700 dark:text-violet-200",
    itemIcon: "text-violet-600 dark:text-violet-400", itemIconHover: "group-hover/item:text-violet-700 dark:group-hover/item:text-violet-300",
  },
  emerald: {
    bg: "bg-emerald-500/10", bgActive: "bg-emerald-500/25",
    border: "border-emerald-500/20", borderActive: "border-emerald-500/40",
    hoverBg: "hover:bg-emerald-500/20", hoverBorder: "hover:border-emerald-500/30",
    text: "text-emerald-600 dark:text-emerald-400", textActive: "text-emerald-600 dark:text-emerald-300",
    textLabel: "text-emerald-600/80 dark:text-emerald-300/80", textLabelActive: "text-emerald-700 dark:text-emerald-200",
    dot: "bg-emerald-500", badge: "bg-emerald-500", badgeShadow: "shadow-emerald-500/30",
    itemBg: "bg-emerald-500/20", itemText: "text-emerald-700 dark:text-emerald-200",
    itemIcon: "text-emerald-600 dark:text-emerald-400", itemIconHover: "group-hover/item:text-emerald-700 dark:group-hover/item:text-emerald-300",
  },
  blue: {
    bg: "bg-blue-500/10", bgActive: "bg-blue-500/25",
    border: "border-blue-500/20", borderActive: "border-blue-500/40",
    hoverBg: "hover:bg-blue-500/20", hoverBorder: "hover:border-blue-500/30",
    text: "text-blue-600 dark:text-blue-400", textActive: "text-blue-600 dark:text-blue-300",
    textLabel: "text-blue-600/80 dark:text-blue-300/80", textLabelActive: "text-blue-700 dark:text-blue-200",
    dot: "bg-blue-500", badge: "bg-blue-500", badgeShadow: "shadow-blue-500/30",
    itemBg: "bg-blue-500/20", itemText: "text-blue-700 dark:text-blue-200",
    itemIcon: "text-blue-600 dark:text-blue-400", itemIconHover: "group-hover/item:text-blue-700 dark:group-hover/item:text-blue-300",
  },
  amber: {
    bg: "bg-amber-500/10", bgActive: "bg-amber-500/25",
    border: "border-amber-500/20", borderActive: "border-amber-500/40",
    hoverBg: "hover:bg-amber-500/20", hoverBorder: "hover:border-amber-500/30",
    text: "text-amber-600 dark:text-amber-400", textActive: "text-amber-600 dark:text-amber-300",
    textLabel: "text-amber-600/80 dark:text-amber-300/80", textLabelActive: "text-amber-700 dark:text-amber-200",
    dot: "bg-amber-500", badge: "bg-amber-500", badgeShadow: "shadow-amber-500/30",
    itemBg: "bg-amber-500/20", itemText: "text-amber-700 dark:text-amber-200",
    itemIcon: "text-amber-600 dark:text-amber-400", itemIconHover: "group-hover/item:text-amber-700 dark:group-hover/item:text-amber-300",
  },
  red: {
    bg: "bg-red-500/10", bgActive: "bg-red-500/25",
    border: "border-red-500/20", borderActive: "border-red-500/40",
    hoverBg: "hover:bg-red-500/20", hoverBorder: "hover:border-red-500/30",
    text: "text-red-600 dark:text-red-400", textActive: "text-red-600 dark:text-red-300",
    textLabel: "text-red-600/80 dark:text-red-300/80", textLabelActive: "text-red-700 dark:text-red-200",
    dot: "bg-red-500", badge: "bg-red-500", badgeShadow: "shadow-red-500/30",
    itemBg: "bg-red-500/20", itemText: "text-red-700 dark:text-red-200",
    itemIcon: "text-red-600 dark:text-red-400", itemIconHover: "group-hover/item:text-red-700 dark:group-hover/item:text-red-300",
  },
  rose: {
    bg: "bg-rose-500/10", bgActive: "bg-rose-500/25",
    border: "border-rose-500/20", borderActive: "border-rose-500/40",
    hoverBg: "hover:bg-rose-500/20", hoverBorder: "hover:border-rose-500/30",
    text: "text-rose-600 dark:text-rose-400", textActive: "text-rose-600 dark:text-rose-300",
    textLabel: "text-rose-600/80 dark:text-rose-300/80", textLabelActive: "text-rose-700 dark:text-rose-200",
    dot: "bg-rose-500", badge: "bg-rose-500", badgeShadow: "shadow-rose-500/30",
    itemBg: "bg-rose-500/20", itemText: "text-rose-700 dark:text-rose-200",
    itemIcon: "text-rose-600 dark:text-rose-400", itemIconHover: "group-hover/item:text-rose-700 dark:group-hover/item:text-rose-300",
  },
  indigo: {
    bg: "bg-indigo-500/10", bgActive: "bg-indigo-500/25",
    border: "border-indigo-500/20", borderActive: "border-indigo-500/40",
    hoverBg: "hover:bg-indigo-500/20", hoverBorder: "hover:border-indigo-500/30",
    text: "text-indigo-600 dark:text-indigo-400", textActive: "text-indigo-600 dark:text-indigo-300",
    textLabel: "text-indigo-600/80 dark:text-indigo-300/80", textLabelActive: "text-indigo-700 dark:text-indigo-200",
    dot: "bg-indigo-500", badge: "bg-indigo-500", badgeShadow: "shadow-indigo-500/30",
    itemBg: "bg-indigo-500/20", itemText: "text-indigo-700 dark:text-indigo-200",
    itemIcon: "text-indigo-600 dark:text-indigo-400", itemIconHover: "group-hover/item:text-indigo-700 dark:group-hover/item:text-indigo-300",
  },
};

export interface NavBarItem {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  badge?: number | string | null;
  badgePulse?: boolean;
  colorClass: string; // key into COLOR_MAP
}

interface NavBarGroupProps {
  label: string;
  icon: ReactNode;
  items: NavBarItem[];
  colorClass: string; // key into COLOR_MAP
}

export default function NavBarGroup({ label, icon, items, colorClass }: NavBarGroupProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const c = COLOR_MAP[colorClass] || COLOR_MAP.cyan;

  const hasActiveItem = items.some(i => i.active);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Count total badges
  const totalBadge = items.reduce((sum, item) => {
    if (item.badge && typeof item.badge === "number") return sum + item.badge;
    if (item.badge) return sum + 1;
    return sum;
  }, 0);

  return (
    <div ref={ref} className="relative">
      {/* Group trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className={`relative flex items-center gap-1.5 px-2.5 py-2 rounded-lg backdrop-blur-md transition-all group border ${
          open || hasActiveItem
            ? `${c.bgActive} ${c.borderActive}`
            : `${c.bg} ${c.border} ${c.hoverBg} ${c.hoverBorder}`
        }`}
        title={label}
        aria-label={label}
        aria-expanded={open}
      >
        <span className={`transition-colors ${open || hasActiveItem ? c.textActive : c.text}`}>
          {icon}
        </span>
        <span className={`text-[10px] font-mono uppercase tracking-wider transition-colors hidden lg:inline ${
          open || hasActiveItem ? c.textLabelActive : c.textLabel
        }`}>
          {label}
        </span>
        <ChevronDown className={`w-3 h-3 transition-all ${open ? "rotate-180" : ""} ${
          open || hasActiveItem ? c.textActive : `${c.text} opacity-50`
        }`} />

        {/* Active indicator dot */}
        {hasActiveItem && !open && totalBadge === 0 && (
          <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ${c.dot} shadow-lg ${c.badgeShadow}`} />
        )}

        {/* Badge count */}
        {totalBadge > 0 && !open && (
          <span className={`absolute -top-1.5 -right-1.5 w-4.5 h-4.5 rounded-full ${c.badge} text-[8px] text-white font-bold flex items-center justify-center shadow-lg ${c.badgeShadow}`}>
            {totalBadge > 9 ? "9+" : totalBadge}
          </span>
        )}
      </button>

      {/* Dropdown menu */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full right-0 mt-2 min-w-[220px] rounded-xl glass-panel border border-border shadow-2xl overflow-hidden z-50"
          >
            <div className="px-3 py-2 border-b border-border">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</span>
            </div>
            <div className="p-1.5">
              {items.map((item) => {
                const ic = COLOR_MAP[item.colorClass] || COLOR_MAP.cyan;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      item.onClick();
                      setOpen(false);
                    }}
                    className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group/item ${
                      item.active
                        ? `${ic.itemBg} ${ic.itemText}`
                        : "hover:bg-foreground/5 text-foreground/80 hover:text-foreground"
                    }`}
                  >
                    <span className={`flex-shrink-0 transition-colors ${
                      item.active ? ic.textActive : `${ic.itemIcon} ${ic.itemIconHover}`
                    }`}>
                      {item.icon}
                    </span>
                    <span className="flex-1 text-left text-xs font-medium">{item.label}</span>
                    {item.badge != null && (
                      <span className={`flex-shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                        item.badgePulse ? "animate-pulse" : ""
                      } ${ic.itemBg} ${ic.itemText}`}>
                        {typeof item.badge === "number" && item.badge > 9 ? "9+" : item.badge}
                      </span>
                    )}
                    {item.active && (
                      <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${ic.dot}`} />
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
