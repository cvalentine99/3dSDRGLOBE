/**
 * Home.tsx — Main page for Valentine RF - SigINT
 * Design: "Ether" — Dark atmospheric immersion
 * Full-viewport globe with floating UI overlays
 */
import { useState, useCallback, useRef } from "react";
import { RadioProvider, useRadio } from "@/contexts/RadioContext";
import Globe from "@/components/Globe";
import { useReceiverStatusMap } from "@/hooks/useReceiverStatusMap";
import StationPanel from "@/components/StationPanel";
import AudioPlayer from "@/components/AudioPlayer";
import SearchFilter from "@/components/SearchFilter";
import HoverTooltip from "@/components/HoverTooltip";
import StatsOverlay from "@/components/StatsOverlay";
import LoadingScreen from "@/components/LoadingScreen";
import Legend from "@/components/Legend";
import StationList from "@/components/StationList";
import KeyboardNavIndicator from "@/components/KeyboardNavIndicator";
import MilitaryRfPanel from "@/components/MilitaryRfPanel";
import AlertSettings from "@/components/AlertSettings";
import WatchlistPanel from "@/components/WatchlistPanel";
import PropagationOverlay from "@/components/PropagationOverlay";
import { useKeyboardNav } from "@/hooks/useKeyboardNav";
import { AnimatePresence } from "framer-motion";
import { motion } from "framer-motion";
import { Radar, Bell, Eye, Activity } from "lucide-react";
import { getUnacknowledgedCount } from "@/lib/alertService";
import { getWatchlistCount, getOnlineCount } from "@/lib/watchlistService";
import type { IonosondeStation } from "@/lib/propagationService";

const SPACE_BG = "https://private-us-east-1.manuscdn.com/sessionFile/vNaLpF1RBh0KpESEYFZ0O6/sandbox/jetyLTlTEnk4uuIRFGjEIW-img-1_1770744518000_na1fn_c3BhY2UtYmc.jpg?x-oss-process=image/resize,w_1920,h_1920/format,webp/quality,q_80&Expires=1798761600&Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvdk5hTHBGMVJCaDBLcEVTRVlGWjBPNi9zYW5kYm94L2pldHlMVGxURW5rNHV1SVJGR2pFSVctaW1nLTFfMTc3MDc0NDUxODAwMF9uYTFmbl9jM0JoWTJVdFltYy5qcGc~eC1vc3MtcHJvY2Vzcz1pbWFnZS9yZXNpemUsd18xOTIwLGhfMTkyMC9mb3JtYXQsd2VicC9xdWFsaXR5LHFfODAiLCJDb25kaXRpb24iOnsiRGF0ZUxlc3NUaGFuIjp7IkFXUzpFcG9jaFRpbWUiOjE3OTg3NjE2MDB9fX1dfQ__&Key-Pair-Id=K2HSFNDJXOU9YS&Signature=oLsKLTDZuMfoSSrBgke-CjTMYV~7c6H6FjxCJ4T6rvv3cXvumKs9xEu4U9UsS1~PU3FHd-YJ-kfGKUTehPSvHy9u5Q0aGQ5~4lj0nLupUgiraYK7CvieHNb1nUVTSqW045sQZuXoUqptovMJaCgW9m6b6cVrk8mfKsAqPHKA1yFtO8Wj2RYeENPMvELvCyVIo~IjFn3jmIE6VO5MAAUaXr4fng1RicMAPHzysVpYWrvTsrp8ldVH02Z2oFtdcipjkIhAYJAeWNku9Hsg5RBcO8W9DrUMNFyKmW4Dq7LkBQ9XWUZo2lBZDfPHtNrKllwHc4xZUrX0tcNLIVRDxX0rCg__";

function HomeContent() {
  const { loading, stations, selectedStation, filteredStations, selectStation, setShowPanel } = useRadio();
  const { isStationOnline, progress: batchProgress } = useReceiverStatusMap(stations, loading);
  const { highlightedStation, highlightedIndex, isKeyNavActive } = useKeyboardNav();
  const [milRfOpen, setMilRfOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [propVisible, setPropVisible] = useState(false);
  const ionosondesRef = useRef<IonosondeStation[]>([]);
  const unackAlerts = getUnacknowledgedCount();
  const watchCount = getWatchlistCount();
  const watchOnline = getOnlineCount();

  // Handle selecting a station from the watchlist panel
  const handleWatchlistSelect = useCallback(
    (coordinates: [number, number], label: string) => {
      const station = filteredStations.find(
        (s) =>
          s.label === label &&
          Math.abs(s.location.coordinates[0] - coordinates[0]) < 0.001 &&
          Math.abs(s.location.coordinates[1] - coordinates[1]) < 0.001
      );
      if (station) {
        selectStation(station);
        setShowPanel(true);
        setWatchlistOpen(false);
      }
    },
    [filteredStations, selectStation, setShowPanel]
  );

  const handleIonosondesLoaded = useCallback((stations: IonosondeStation[]) => {
    ionosondesRef.current = stations;
  }, []);

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
      <Globe ionosondes={propVisible ? ionosondesRef.current : []} isStationOnline={isStationOnline} />

      {/* Batch pre-check progress indicator */}
      {batchProgress.running && batchProgress.total > 0 && (
        <div className="absolute bottom-2 right-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/50 backdrop-blur-sm border border-white/10">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-[10px] font-mono text-white/60">
            Scanning receivers: {batchProgress.checked}/{batchProgress.total}
          </span>
          <div className="w-20 h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-cyan-400/60 rounded-full transition-all duration-500"
              style={{ width: `${Math.round((batchProgress.checked / batchProgress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Title / Branding */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.6 }}
        className="absolute top-5 left-1/2 -translate-x-1/2 z-20 text-center pointer-events-none"
      >
        <div className="relative px-6 py-2">
          <div className="absolute inset-0 rounded-xl bg-black/40 backdrop-blur-sm" />
          <div className="relative">
            <h1 className="text-xl font-semibold text-white tracking-tight drop-shadow-lg">
              Valentine <span className="text-primary text-glow-coral">RF</span>
            </h1>
            <p className="text-[11px] font-mono text-white/70 uppercase tracking-[0.3em] mt-0.5 drop-shadow-md">
              SigINT — Global Receiver Intelligence
            </p>
          </div>
        </div>
      </motion.div>

      {/* Top-right button group */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 1, duration: 0.5 }}
        className="absolute top-5 right-4 z-20 flex items-center gap-2"
      >
        {/* Propagation Overlay Button */}
        <button
          onClick={() => setPropVisible(!propVisible)}
          className={`relative flex items-center gap-2 px-3 py-2 rounded-lg backdrop-blur-md transition-all group ${
            propVisible
              ? 'bg-cyan-500/25 border border-cyan-500/40'
              : 'bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 hover:border-cyan-500/30'
          }`}
          title="HF Propagation Overlay"
        >
          <Activity className={`w-4 h-4 transition-colors ${propVisible ? 'text-cyan-300' : 'text-cyan-400 group-hover:text-cyan-300'}`} />
          <span className={`text-[10px] font-mono uppercase tracking-wider transition-colors hidden sm:inline ${
            propVisible ? 'text-cyan-200' : 'text-cyan-300/80 group-hover:text-cyan-200'
          }`}>
            Prop
          </span>
        </button>

        {/* Watchlist Button */}
        <button
          onClick={() => setWatchlistOpen(true)}
          className="relative flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/25 backdrop-blur-md hover:bg-emerald-500/25 hover:border-emerald-500/40 transition-all group"
          title="Watchlist — Background Monitoring"
        >
          <Eye className="w-4 h-4 text-emerald-400 group-hover:text-emerald-300 transition-colors" />
          <span className="text-[10px] font-mono text-emerald-300/80 uppercase tracking-wider group-hover:text-emerald-200 transition-colors hidden sm:inline">
            Watch
          </span>
          {watchCount > 0 && (
            <span className="text-[9px] font-mono text-emerald-400/70 hidden sm:inline">
              {watchOnline}/{watchCount}
            </span>
          )}
          {watchCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 rounded-full bg-emerald-500 text-[8px] text-white font-bold flex items-center justify-center shadow-lg shadow-emerald-500/30 sm:hidden">
              {watchCount}
            </span>
          )}
        </button>

        {/* Alert Settings Button */}
        <button
          onClick={() => setAlertsOpen(true)}
          className="relative flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/25 backdrop-blur-md hover:bg-amber-500/25 hover:border-amber-500/40 transition-all group"
          title="Alert Configuration"
        >
          <Bell className="w-4 h-4 text-amber-400 group-hover:text-amber-300 transition-colors" />
          <span className="text-[10px] font-mono text-amber-300/80 uppercase tracking-wider group-hover:text-amber-200 transition-colors hidden sm:inline">
            Alerts
          </span>
          {unackAlerts > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 rounded-full bg-red-500 text-[8px] text-white font-bold flex items-center justify-center shadow-lg shadow-red-500/30 animate-pulse">
              {unackAlerts > 9 ? "9+" : unackAlerts}
            </span>
          )}
        </button>

        {/* Military RF Intel Button */}
        <button
          onClick={() => setMilRfOpen(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/25 backdrop-blur-md hover:bg-red-500/25 hover:border-red-500/40 transition-all group"
          title="Military RF Intelligence Database"
        >
          <Radar className="w-4 h-4 text-red-400 group-hover:text-red-300 transition-colors" />
          <span className="text-[10px] font-mono text-red-300/80 uppercase tracking-wider group-hover:text-red-200 transition-colors hidden sm:inline">
            Mil-RF Intel
          </span>
        </button>
      </motion.div>

      {/* Military RF Intelligence Panel */}
      <MilitaryRfPanel isOpen={milRfOpen} onClose={() => setMilRfOpen(false)} />

      {/* Alert Settings Panel */}
      <AnimatePresence>
        {alertsOpen && <AlertSettings onClose={() => setAlertsOpen(false)} />}
      </AnimatePresence>

      {/* Watchlist Panel */}
      <AnimatePresence>
        {watchlistOpen && (
          <WatchlistPanel
            isOpen={watchlistOpen}
            onClose={() => setWatchlistOpen(false)}
            onSelectStation={handleWatchlistSelect}
          />
        )}
      </AnimatePresence>

      {/* Propagation Overlay Panel */}
      <AnimatePresence>
        <PropagationOverlay
          visible={propVisible}
          onIonosondesLoaded={handleIonosondesLoaded}
        />
      </AnimatePresence>

      {/* Search & Filter */}
      <SearchFilter />

      {/* Station Detail Panel */}
      <StationPanel />

      {/* Audio Player */}
      <AudioPlayer />

      {/* Hover Tooltip */}
      <HoverTooltip />

      {/* Keyboard Navigation Indicator */}
      <KeyboardNavIndicator
        highlightedStation={highlightedStation}
        highlightedIndex={highlightedIndex}
        totalCount={filteredStations.length}
        isActive={isKeyNavActive}
      />

      {/* Instruction hint */}
      {!selectedStation && !loading && !isKeyNavActive && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2, duration: 1 }}
          className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 pointer-events-none"
        >
          <p className="text-xs font-mono text-white/50 text-center drop-shadow-lg"
            style={{ textShadow: '0 1px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.5)' }}
          >
            Select a target or search to begin reconnaissance · <span className="text-white/30">↑↓ to browse · Enter to select</span>
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
