/**
 * StatsOverlay.tsx — Minimal stats display in the bottom-left corner
 * Design: "Ether" — subtle, atmospheric data readout
 */
import { useRadio } from "@/contexts/RadioContext";
import { useMemo } from "react";
import { motion } from "framer-motion";

export default function StatsOverlay() {
  const { stations, filteredStations, loading } = useRadio();

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
      <div className="flex items-center gap-4 text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest">
        <span>{stations.length} targets</span>
        <span className="w-px h-3 bg-white/10" />
        <span>{stats.totalReceivers} receivers</span>
        <span className="w-px h-3 bg-white/10" />
        <span>global coverage</span>
      </div>
    </motion.div>
  );
}
