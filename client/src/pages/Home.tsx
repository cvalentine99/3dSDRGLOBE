/**
 * Home.tsx — Main page for Valentine RF - SigINT
 * Design: "Ether" — Dark atmospheric immersion
 * Full-viewport globe with floating UI overlays
 */
import { RadioProvider, useRadio } from "@/contexts/RadioContext";
import Globe from "@/components/Globe";
import StationPanel from "@/components/StationPanel";
import AudioPlayer from "@/components/AudioPlayer";
import SearchFilter from "@/components/SearchFilter";
import HoverTooltip from "@/components/HoverTooltip";
import StatsOverlay from "@/components/StatsOverlay";
import LoadingScreen from "@/components/LoadingScreen";
import Legend from "@/components/Legend";
import StationList from "@/components/StationList";
import { AnimatePresence } from "framer-motion";
import { motion } from "framer-motion";

const SPACE_BG = "https://private-us-east-1.manuscdn.com/sessionFile/vNaLpF1RBh0KpESEYFZ0O6/sandbox/jetyLTlTEnk4uuIRFGjEIW-img-1_1770744518000_na1fn_c3BhY2UtYmc.jpg?x-oss-process=image/resize,w_1920,h_1920/format,webp/quality,q_80&Expires=1798761600&Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvdk5hTHBGMVJCaDBLcEVTRVlGWjBPNi9zYW5kYm94L2pldHlMVGxURW5rNHV1SVJGR2pFSVctaW1nLTFfMTc3MDc0NDUxODAwMF9uYTFmbl9jM0JoWTJVdFltYy5qcGc~eC1vc3MtcHJvY2Vzcz1pbWFnZS9yZXNpemUsd18xOTIwLGhfMTkyMC9mb3JtYXQsd2VicC9xdWFsaXR5LHFfODAiLCJDb25kaXRpb24iOnsiRGF0ZUxlc3NUaGFuIjp7IkFXUzpFcG9jaFRpbWUiOjE3OTg3NjE2MDB9fX1dfQ__&Key-Pair-Id=K2HSFNDJXOU9YS&Signature=oLsKLTDZuMfoSSrBgke-CjTMYV~7c6H6FjxCJ4T6rvv3cXvumKs9xEu4U9UsS1~PU3FHd-YJ-kfGKUTehPSvHy9u5Q0aGQ5~4lj0nLupUgiraYK7CvieHNb1nUVTSqW045sQZuXoUqptovMJaCgW9m6b6cVrk8mfKsAqPHKA1yFtO8Wj2RYeENPMvELvCyVIo~IjFn3jmIE6VO5MAAUaXr4fng1RicMAPHzysVpYWrvTsrp8ldVH02Z2oFtdcipjkIhAYJAeWNku9Hsg5RBcO8W9DrUMNFyKmW4Dq7LkBQ9XWUZo2lBZDfPHtNrKllwHc4xZUrX0tcNLIVRDxX0rCg__";

function HomeContent() {
  const { loading, selectedStation } = useRadio();

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-background">
      {/* Space background */}
      <div
        className="absolute inset-0 bg-cover bg-center opacity-40 pointer-events-none"
        style={{ backgroundImage: `url(${SPACE_BG})` }}
      />

      {/* Subtle vignette overlay */}
      <div className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.7) 100%)",
        }}
      />

      {/* Bottom gradient for UI readability */}
      <div className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none z-10"
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 100%)",
        }}
      />

      {/* Loading screen */}
      <AnimatePresence>
        {loading && <LoadingScreen />}
      </AnimatePresence>

      {/* 3D Globe */}
      <Globe />

      {/* Title / Branding */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.6 }}
        className="absolute top-5 left-1/2 -translate-x-1/2 z-20 text-center pointer-events-none"
      >
        <h1 className="text-xl font-semibold text-foreground tracking-tight">
          Valentine <span className="text-primary text-glow-coral">RF</span>
        </h1>
        <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-[0.3em] mt-0.5">
          SigINT — Global Receiver Intelligence
        </p>
      </motion.div>

      {/* Search & Filter */}
      <SearchFilter />

      {/* Station Detail Panel */}
      <StationPanel />

      {/* Audio Player */}
      <AudioPlayer />

      {/* Hover Tooltip */}
      <HoverTooltip />

      {/* Instruction hint */}
      {!selectedStation && !loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2, duration: 1 }}
          className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 pointer-events-none"
        >
          <p className="text-xs font-mono text-muted-foreground/30 text-center">
            Select a target or search to begin reconnaissance
          </p>
        </motion.div>
      )}

      {/* Stats */}
      {!selectedStation && <StatsOverlay />}

      {/* Legend */}
      {!selectedStation && <Legend />}

      {/* Station List Sidebar */}
      <StationList />
    </div>
  );
}

export default function Home() {
  return (
    <RadioProvider>
      <HomeContent />
    </RadioProvider>
  );
}
