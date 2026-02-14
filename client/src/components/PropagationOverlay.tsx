/**
 * PropagationOverlay — HF Propagation data overlay for the 3D globe
 * Design: "Ether" dark atmospheric — ionosonde markers with MUF/foF2 color coding,
 * solar conditions dashboard, and band condition indicators
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Radio, Sun, RefreshCw, ChevronDown, ChevronUp, Activity,
  Zap, Wind, Gauge, X, Eye, EyeOff, Info
} from 'lucide-react';
import {
  fetchPropagationData,
  PropagationData,
  IonosondeStation,
  MUF_COLOR_SCALE,
  FOF2_COLOR_SCALE,
  getMufColor,
  getFof2Color,
  getBandConditionColor,
} from '@/lib/propagationService';

type DisplayMode = 'muf' | 'fof2';

interface PropagationOverlayProps {
  onIonosondesLoaded?: (stations: IonosondeStation[]) => void;
  visible: boolean;
}

export default function PropagationOverlay({ onIonosondesLoaded, visible }: PropagationOverlayProps) {
  const [data, setData] = useState<PropagationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<DisplayMode>('muf');
  const [showSolar, setShowSolar] = useState(false);
  const [showStations, setShowStations] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const result = await fetchPropagationData(force);
      setData(result);
      if (result.ionosondes.length > 0 && onIonosondesLoaded) {
        onIonosondesLoaded(result.ionosondes);
      }
    } catch {
      // handled in service
    } finally {
      setLoading(false);
    }
  }, [onIonosondesLoaded]);

  useEffect(() => {
    if (visible) {
      loadData();
      intervalRef.current = setInterval(() => loadData(), 15 * 60 * 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [visible, loadData]);

  if (!visible) return null;

  const colorScale = mode === 'muf' ? MUF_COLOR_SCALE : FOF2_COLOR_SCALE;
  const solar = data?.solar;
  const recentStations = data?.ionosondes.filter(s => s.ageMinutes < 120) || [];
  const allStations = data?.ionosondes || [];

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="fixed left-4 bottom-20 z-30 w-80 max-h-[70vh] overflow-y-auto scrollbar-thin"
      style={{ pointerEvents: 'auto' }}
    >
      <div className="glass-panel rounded-xl overflow-hidden border border-white/10">
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-white/5 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-semibold text-white">HF Propagation</span>
            {loading && <RefreshCw className="w-3 h-3 text-cyan-400 animate-spin" />}
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <span className="text-[10px] text-white/40">
                {recentStations.length} ionosondes
              </span>
            )}
            {expanded ? (
              <ChevronDown className="w-4 h-4 text-white/50" />
            ) : (
              <ChevronUp className="w-4 h-4 text-white/50" />
            )}
          </div>
        </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              className="overflow-hidden"
            >
              {/* Mode Toggle */}
              <div className="px-3 py-1.5 flex items-center gap-1.5 border-t border-white/5">
                <button
                  onClick={() => setMode('muf')}
                  className={`flex-1 text-xs py-1 rounded-md transition-colors font-medium ${
                    mode === 'muf'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                      : 'text-white/50 hover:text-white/70 border border-transparent'
                  }`}
                >
                  MUF (3000km)
                </button>
                <button
                  onClick={() => setMode('fof2')}
                  className={`flex-1 text-xs py-1 rounded-md transition-colors font-medium ${
                    mode === 'fof2'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                      : 'text-white/50 hover:text-white/70 border border-transparent'
                  }`}
                >
                  foF2 (Critical)
                </button>
                <button
                  onClick={() => loadData(true)}
                  className="p-1 text-white/40 hover:text-cyan-400 transition-colors"
                  title="Refresh data"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {/* Color Scale Legend */}
              <div className="px-3 py-1.5 border-t border-white/5">
                <div className="flex items-center gap-0.5 h-3 rounded-full overflow-hidden">
                  {colorScale.map((c, i) => (
                    <div
                      key={i}
                      className="flex-1 h-full"
                      style={{ backgroundColor: c.color }}
                      title={c.label}
                    />
                  ))}
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-[9px] text-white/40">{colorScale[0].label}</span>
                  <span className="text-[9px] text-white/40">
                    {mode === 'muf' ? 'MUF MHz' : 'foF2 MHz'}
                  </span>
                  <span className="text-[9px] text-white/40">
                    {colorScale[colorScale.length - 1].label}
                  </span>
                </div>
              </div>

              {/* Solar Conditions Toggle */}
              {solar && (
                <>
                  <button
                    onClick={() => setShowSolar(!showSolar)}
                    className="w-full px-3 py-1.5 flex items-center justify-between border-t border-white/5 hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Sun className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs text-white/80">Solar Conditions</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/40">
                        SFI {solar.solarFlux} | K{solar.kIndex}
                      </span>
                      {showSolar ? (
                        <ChevronUp className="w-3 h-3 text-white/40" />
                      ) : (
                        <ChevronDown className="w-3 h-3 text-white/40" />
                      )}
                    </div>
                  </button>

                  <AnimatePresence>
                    {showSolar && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="px-3 py-2 space-y-2 border-t border-white/5 bg-white/[0.02]">
                          {/* Solar indices */}
                          <div className="grid grid-cols-4 gap-1.5">
                            <SolarStat
                              icon={<Sun className="w-3 h-3" />}
                              label="SFI"
                              value={solar.solarFlux.toString()}
                              color={solar.solarFlux > 150 ? '#10b981' : solar.solarFlux > 100 ? '#eab308' : '#ef4444'}
                            />
                            <SolarStat
                              icon={<Gauge className="w-3 h-3" />}
                              label="K-idx"
                              value={solar.kIndex.toString()}
                              color={solar.kIndex <= 2 ? '#10b981' : solar.kIndex <= 4 ? '#eab308' : '#ef4444'}
                            />
                            <SolarStat
                              icon={<Zap className="w-3 h-3" />}
                              label="A-idx"
                              value={solar.aIndex.toString()}
                              color={solar.aIndex <= 10 ? '#10b981' : solar.aIndex <= 20 ? '#eab308' : '#ef4444'}
                            />
                            <SolarStat
                              icon={<Wind className="w-3 h-3" />}
                              label="SW"
                              value={`${Math.round(solar.solarWind)}`}
                              color={solar.solarWind < 400 ? '#10b981' : solar.solarWind < 500 ? '#eab308' : '#ef4444'}
                            />
                          </div>

                          {/* Extra info row */}
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-white/40">
                              Sunspots: <span className="text-white/70">{solar.sunspots}</span>
                            </span>
                            <span className="text-white/40">
                              X-ray: <span className="text-white/70">{solar.xray}</span>
                            </span>
                            <span className="text-white/40">
                              Bz: <span className="text-white/70">{solar.magneticField}</span>
                            </span>
                          </div>

                          {/* Geomag + Noise */}
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-white/40">
                              Geomag: <span className="text-emerald-400">{solar.geomagField}</span>
                            </span>
                            <span className="text-white/40">
                              Noise: <span className="text-white/70">{solar.signalNoise}</span>
                            </span>
                          </div>

                          {/* Band Conditions */}
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1 text-[10px] text-white/50 font-medium">
                              <Radio className="w-3 h-3" />
                              <span>HF Band Conditions</span>
                            </div>
                            <div className="grid grid-cols-3 gap-x-2 text-[10px]">
                              <span className="text-white/30 font-medium">Band</span>
                              <span className="text-white/30 font-medium text-center">Day</span>
                              <span className="text-white/30 font-medium text-center">Night</span>
                              {solar.bandConditions.map((bc, i) => (
                                <BandRow key={i} band={bc.band} day={bc.day} night={bc.night} />
                              ))}
                            </div>
                          </div>

                          {/* VHF Conditions */}
                          {solar.vhfConditions.length > 0 && (
                            <div className="space-y-0.5">
                              <span className="text-[10px] text-white/50 font-medium">VHF Conditions</span>
                              {solar.vhfConditions.map((v, i) => (
                                <div key={i} className="flex justify-between text-[10px]">
                                  <span className="text-white/40">
                                    {v.name} ({v.location})
                                  </span>
                                  <span
                                    style={{
                                      color: v.status.toLowerCase().includes('closed')
                                        ? '#ef4444'
                                        : v.status.toLowerCase().includes('high')
                                        ? '#eab308'
                                        : '#10b981',
                                    }}
                                  >
                                    {v.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="text-[9px] text-white/25 text-right">
                            Updated: {solar.updated}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}

              {/* Ionosonde Station List Toggle */}
              <button
                onClick={() => setShowStations(!showStations)}
                className="w-full px-3 py-1.5 flex items-center justify-between border-t border-white/5 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Info className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-xs text-white/80">Ionosonde Stations</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-white/40">
                    {recentStations.length} active / {allStations.length} total
                  </span>
                  {showStations ? (
                    <ChevronUp className="w-3 h-3 text-white/40" />
                  ) : (
                    <ChevronDown className="w-3 h-3 text-white/40" />
                  )}
                </div>
              </button>

              <AnimatePresence>
                {showStations && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: 'auto' }}
                    exit={{ height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="max-h-48 overflow-y-auto border-t border-white/5">
                      {allStations
                        .sort((a, b) => a.ageMinutes - b.ageMinutes)
                        .map((s) => {
                          const val = mode === 'muf' ? s.mufd : s.fof2;
                          const color = val
                            ? mode === 'muf'
                              ? getMufColor(val)
                              : getFof2Color(val)
                            : '#6b7280';
                          const stale = s.ageMinutes > 120;
                          return (
                            <div
                              key={s.id}
                              className={`px-3 py-1 flex items-center justify-between border-b border-white/5 ${
                                stale ? 'opacity-40' : ''
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <div
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: color }}
                                />
                                <span className="text-[10px] text-white/70 truncate">
                                  {s.name}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span
                                  className="text-[10px] font-mono font-bold"
                                  style={{ color }}
                                >
                                  {val ? val.toFixed(1) : '—'}
                                </span>
                                <span className="text-[9px] text-white/30">
                                  {s.ageMinutes < 60
                                    ? `${s.ageMinutes}m`
                                    : `${Math.round(s.ageMinutes / 60)}h`}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Data source attribution */}
              <div className="px-3 py-1 border-t border-white/5 text-[9px] text-white/25 flex justify-between">
                <span>Data: KC2G / GIRO / HamQSL</span>
                {data && (
                  <span>
                    {new Date(data.lastFetch).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function SolarStat({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-1 rounded-md bg-white/[0.03] border border-white/5">
      <div style={{ color }} className="opacity-80">
        {icon}
      </div>
      <span className="text-[10px] font-mono font-bold" style={{ color }}>
        {value}
      </span>
      <span className="text-[8px] text-white/30">{label}</span>
    </div>
  );
}

function BandRow({ band, day, night }: { band: string; day: string; night: string }) {
  return (
    <>
      <span className="text-white/60">{band}</span>
      <span className="text-center font-medium" style={{ color: getBandConditionColor(day) }}>
        {day || '—'}
      </span>
      <span className="text-center font-medium" style={{ color: getBandConditionColor(night) }}>
        {night || '—'}
      </span>
    </>
  );
}
