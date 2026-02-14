/**
 * LoadingScreen.tsx — Atmospheric loading screen while data loads
 * Design: "Ether" — pulsing radio wave animation
 */
import { motion } from "framer-motion";

export default function LoadingScreen() {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
      className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background"
    >
      {/* Animated radio waves */}
      <div className="relative w-32 h-32 mb-8">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="absolute inset-0 rounded-full border border-primary/30"
            initial={{ scale: 0.3, opacity: 0.8 }}
            animate={{ scale: 1.5, opacity: 0 }}
            transition={{
              duration: 2,
              delay: i * 0.6,
              repeat: Infinity,
              ease: "easeOut",
            }}
          />
        ))}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-4 h-4 rounded-full bg-primary glow-coral" />
        </div>
      </div>

      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="text-2xl font-semibold text-foreground tracking-tight mb-2"
      >
        Valentine <span className="text-primary">RF</span>
      </motion.h1>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="text-sm text-muted-foreground font-mono"
      >
        Initializing SigINT...
      </motion.p>
    </motion.div>
  );
}
