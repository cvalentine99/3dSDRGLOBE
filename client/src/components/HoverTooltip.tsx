/**
 * HoverTooltip.tsx — Floating tooltip that follows the cursor when hovering a station marker
 * Design: "Ether" — minimal frosted glass tooltip
 */
import { useRadio } from "@/contexts/RadioContext";
import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { detectBands, BAND_DEFINITIONS } from "@/lib/types";

const TYPE_DOT: Record<string, string> = {
  OpenWebRX: "bg-cyan-400",
  WebSDR: "bg-primary",
  KiwiSDR: "bg-green-400",
};

export default function HoverTooltip() {
  const { hoveredStation, selectedStation } = useRadio();
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const bands = useMemo(() => {
    if (!hoveredStation) return [];
    return detectBands(hoveredStation).map((b) => {
      const def = BAND_DEFINITIONS.find((d) => d.id === b);
      return def ? def.label : b;
    });
  }, [hoveredStation]);

  const show = hoveredStation && hoveredStation !== selectedStation;

  return (
    <AnimatePresence>
      {show && hoveredStation && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.1 }}
          className="fixed z-50 pointer-events-none"
          style={{
            left: mousePos.x + 16,
            top: mousePos.y - 10,
          }}
        >
          <div className="glass-panel rounded-lg px-3 py-2 max-w-[240px]">
            <p className="text-xs font-medium text-foreground truncate">
              {hoveredStation.label}
            </p>
            <div className="flex items-center gap-2 mt-1">
              {hoveredStation.receivers
                .map((r) => r.type)
                .filter((v, i, a) => a.indexOf(v) === i)
                .map((type) => (
                  <div key={type} className="flex items-center gap-1">
                    <div className={`w-1.5 h-1.5 rounded-full ${TYPE_DOT[type] || "bg-primary"}`} />
                    <span className="text-[10px] font-mono text-muted-foreground">{type}</span>
                  </div>
                ))}
            </div>
            {bands.length > 0 && (
              <div className="flex items-center gap-1 mt-1">
                {bands.map((b) => (
                  <span key={b} className="text-[8px] font-mono text-accent/70 bg-accent/10 px-1 py-0.5 rounded">
                    {b}
                  </span>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
