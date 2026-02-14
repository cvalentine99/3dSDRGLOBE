/**
 * Legend.tsx — Minimal legend showing marker color meanings
 * Design: "Ether" — subtle, non-intrusive
 */
import { motion } from "framer-motion";

const LEGEND_ITEMS = [
  { type: "KiwiSDR", color: "bg-green-400", glow: "shadow-green-400/30" },
  { type: "OpenWebRX", color: "bg-cyan-400", glow: "shadow-cyan-400/30" },
  { type: "WebSDR", color: "bg-primary", glow: "shadow-primary/30" },
];

export default function Legend() {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 1.5, duration: 0.5 }}
      className="absolute bottom-6 right-4 z-20"
    >
      <div className="glass-panel rounded-xl px-3 py-2.5">
        <div className="flex items-center gap-4">
          {LEGEND_ITEMS.map((item) => (
            <div key={item.type} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${item.color} shadow-sm ${item.glow}`} />
              <span className="text-[10px] font-mono text-white/80">
                {item.type}
              </span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
