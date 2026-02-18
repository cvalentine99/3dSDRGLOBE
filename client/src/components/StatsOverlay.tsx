/**
 * StatsOverlay.tsx — Minimal stats display in the bottom-left corner
 * Design: "Ether" — subtle, atmospheric data readout
 * Includes build version for deployment verification
 */
import { useRadio } from "@/contexts/RadioContext";
import { useMemo } from "react";
import { motion } from "framer-motion";

/** Build timestamp injected at compile time — changes with every new build */
const BUILD_VERSION = `v${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.${Math.floor(Date.now() / 1000) % 100000}`;

export default function StatsOverlay() {
  const { stations, loading } = useRadio();

  const stats = useMemo(() => {
    const types: Record<string, number> = {};
    let totalReceivers = 0;
    stations.forEach((s) => {
      s.receivers.forEach((r) => {
        types[r.type] = (types[r.type] || 0) + 1;
        totalReceivers++;
      });
    });
    return { types, totalReceivers };
  }, [stations]);

  if (loading) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1, duration: 0.5 }}
      className="absolute bottom-6 left-4 z-20 pointer-events-none"
    >
      <div 
        className="flex items-center gap-4 text-[10px] font-mono text-white/70 uppercase tracking-widest"
        style={{ textShadow: '0 1px 6px rgba(0,0,0,0.8), 0 0 16px rgba(0,0,0,0.5)' }}
      >
        <span>{stations.length} targets</span>
        <span className="w-px h-3 bg-white/20" />
        <span>{stats.totalReceivers} receivers</span>
        <span className="w-px h-3 bg-white/20" />
        <span>global coverage</span>
        <span className="w-px h-3 bg-white/20" />
        <span className="text-white/30" title="Build version for deployment verification">{BUILD_VERSION}</span>
      </div>
    </motion.div>
  );
}
