/**
 * Home.tsx — Main page for Valentine RF - SigINT
 * Design: "Ether" — Dark atmospheric immersion
 * Full-viewport globe with floating UI overlays
 */
import { useState, useCallback, useRef, useMemo, Component, type ReactNode } from "react";
import { RadioProvider, useRadio } from "@/contexts/RadioContext";
import Globe, { type TdoaOverlayData, type GlobeHandle } from "@/components/Globe";
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
import AnomalyAlertPanel from "@/components/AnomalyAlertPanel";
import SharedListPanel from "@/components/SharedListPanel";
import WatchlistPanel from "@/components/WatchlistPanel";
import PropagationOverlay from "@/components/PropagationOverlay";
import ConflictOverlay, { type SlimConflictEvent } from "@/components/ConflictOverlay";
import SigintConflictTimeline from "@/components/SigintConflictTimeline";
import { useKeyboardNav } from "@/hooks/useKeyboardNav";
import { AnimatePresence } from "framer-motion";
import { motion } from "framer-motion";
import { Radar, Bell, Eye, Activity, Crosshair, Target, AlertTriangle, Users, BarChart3, Flame, Layers, Shield } from "lucide-react";
import NavBarGroup, { type NavBarItem } from "@/components/NavBarGroup";
import { getUnacknowledgedCount } from "@/lib/alertService";
import { getWatchlistCount, getOnlineCount } from "@/lib/watchlistService";
import type { IonosondeStation } from "@/lib/propagationService";
import TDoAPanel from "@/components/TDoAPanel";
import KiwiWaterfall from "@/components/KiwiWaterfall";
import TargetManager from "@/components/TargetManager";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import type { SavedTargetData, DriftTrailEntry, PredictionData } from "@/components/TDoAGlobeOverlay";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import ShortcutHelpOverlay from "@/components/ShortcutHelpOverlay";
import ThemeToggle from "@/components/ThemeToggle";
import { useTheme } from "@/contexts/ThemeContext";

/** Local error boundary specifically for the Globe component to catch WebGL crashes */
class GlobeErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  componentDidCatch(error: Error) {
    console.error("[GlobeErrorBoundary] Caught WebGL/Three.js crash:", error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 w-full h-full z-[5] flex items-center justify-center">
          <div className="max-w-md text-center px-6 py-8 rounded-2xl bg-foreground/5 border border-border backdrop-blur-sm">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/15 border border-red-500/25 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-foreground/90 mb-2">3D Globe Crashed</h2>
            <p className="text-sm text-muted-foreground mb-4">{this.state.error || "An unexpected error occurred in the 3D renderer."}</p>
            <p className="text-xs text-muted-foreground/50 mb-4">The rest of the app still works. Use the search panel or station list to browse receivers.</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-xs font-medium text-cyan-600 dark:text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 rounded-lg hover:bg-cyan-500/20 transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const SPACE_BG = "https://private-us-east-1.manuscdn.com/sessionFile/vNaLpF1RBh0KpESEYFZ0O6/sandbox/jetyLTlTEnk4uuIRFGjEIW-img-1_1770744518000_na1fn_c3BhY2UtYmc.jpg?x-oss-process=image/resize,w_1920,h_1920/format,webp/quality,q_80&Expires=1798761600&Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvdk5hTHBGMVJCaDBLcEVTRVlGWjBPNi9zYW5kYm94L2pldHlMVGxURW5rNHV1SVJGR2pFSVctaW1nLTFfMTc3MDc0NDUxODAwMF9uYTFmbl9jM0JoWTJVdFltYy5qcGc~eC1vc3MtcHJvY2Vzcz1pbWFnZS9yZXNpemUsd18xOTIwLGhfMTkyMC9mb3JtYXQsd2VicC9xdWFsaXR5LHFfODAiLCJDb25kaXRpb24iOnsiRGF0ZUxlc3NUaGFuIjp7IkFXUzpFcG9jaFRpbWUiOjE3OTg3NjE2MDB9fX1dfQ__&Key-Pair-Id=K2HSFNDJXOU9YS&Signature=oLsKLTDZuMfoSSrBgke-CjTMYV~7c6H6FjxCJ4T6rvv3cXvumKs9xEu4U9UsS1~PU3FHd-YJ-kfGKUTehPSvHy9u5Q0aGQ5~4lj0nLupUgiraYK7CvieHNb1nUVTSqW045sQZuXoUqptovMJaCgW9m6b6cVrk8mfKsAqPHKA1yFtO8Wj2RYeENPMvELvCyVIo~IjFn3jmIE6VO5MAAUaXr4fng1RicMAPHzysVpYWrvTsrp8ldVH02Z2oFtdcipjkIhAYJAeWNku9Hsg5RBcO8W9DrUMNFyKmW4Dq7LkBQ9XWUZo2lBZDfPHtNrKllwHc4xZUrX0tcNLIVRDxX0rCg__";

/** Format a future timestamp as a human-readable countdown like "28m" or "< 1m" */
function formatCountdown(targetMs: number): string {
  const diffMs = targetMs - Date.now();
  if (diffMs <= 0) return "< 1m";
  const mins = Math.ceil(diffMs / 60000);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
  }
  return `${mins}m`;
}

function HomeContent() {
  const { loading, stations, selectedStation, filteredStations, selectStation, setShowPanel } = useRadio();
  const { isStationOnline, progress: batchProgress, autoRefresh } = useReceiverStatusMap(stations, loading);
  const { highlightedStation, highlightedIndex, isKeyNavActive } = useKeyboardNav();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const globeRef = useRef<GlobeHandle>(null);
  const [milRfOpen, setMilRfOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [propVisible, setPropVisible] = useState(false);
  const [tdoaOpen, setTdoaOpen] = useState(false);
  const [tdoaSelectedHosts, setTdoaSelectedHosts] = useState<any[]>([]);
  const [waterfallVisible, setWaterfallVisible] = useState(false);
  const [waterfallFreq, setWaterfallFreq] = useState(10000);
  const [waterfallPb, setWaterfallPb] = useState(1000);
  const [tdoaResult, setTdoaResult] = useState<{
    likelyLat: number;
    likelyLon: number;
    hosts: { lat: number; lon: number; h: string }[];
    contours: any[];
    jobId: string;
    heatmapUrl?: string;
    heatmapBounds?: { north: number; south: number; east: number; west: number };
  } | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [anomalyPanelOpen, setAnomalyPanelOpen] = useState(false);
  const [sharingPanelOpen, setSharingPanelOpen] = useState(false);
  const [conflictVisible, setConflictVisible] = useState(false);
  const [conflictTimelineOpen, setConflictTimelineOpen] = useState(false);
  const conflictEventsRef = useRef<SlimConflictEvent[]>([]);
  const [, setConflictTick] = useState(0); // force re-render when events change
  const [heatmapMode, setHeatmapMode] = useState(false);
  const [conflictZoneStations, setConflictZoneStations] = useState<Set<string>>(new Set());
  const [correlationRadius, setCorrelationRadius] = useState(200);
  const [, navigate] = useLocation();

  // Keyboard shortcuts
  const { helpOpen, setHelpOpen, shortcuts } = useKeyboardShortcuts({
    onToggleTdoa: useCallback(() => setTdoaOpen((v) => !v), []),
    onFocusSearch: useCallback(() => {
      const input = document.getElementById("global-search-input") as HTMLInputElement | null;
      input?.focus();
    }, []),
    onNavigateDashboard: useCallback(() => navigate("/dashboard"), [navigate]),
    onToggleWatchlist: useCallback(() => setWatchlistOpen((v) => !v), []),
    onToggleAlerts: useCallback(() => setAlertsOpen((v) => !v), []),
    onToggleMilRf: useCallback(() => setMilRfOpen((v) => !v), []),
    onToggleTargets: useCallback(() => setTargetsOpen((v) => !v), []),
    onToggleAnomaly: useCallback(() => setAnomalyPanelOpen((v) => !v), []),
    onTogglePropagation: useCallback(() => setPropVisible((v) => !v), []),
    onToggleSharing: useCallback(() => setSharingPanelOpen((v) => !v), []),
    onToggleConflict: useCallback(() => setConflictVisible((v) => !v), []),
    onEscapeAll: useCallback(() => {
      setTdoaOpen(false);
      setMilRfOpen(false);
      setAlertsOpen(false);
      setWatchlistOpen(false);
      setTargetsOpen(false);
      setAnomalyPanelOpen(false);
      setSharingPanelOpen(false);
      setConflictVisible(false);
      selectStation(null);
      setShowPanel(false);
    }, [selectStation, setShowPanel]),
  });

  // Fetch unacknowledged anomaly alert count
  const anomalyCountQuery = trpc.anomalies.unacknowledgedCount.useQuery(undefined, {
    refetchInterval: 15000,
  });
  const anomalyCount = typeof anomalyCountQuery.data === 'object' ? anomalyCountQuery.data?.count ?? 0 : anomalyCountQuery.data ?? 0;

  // Fetch saved TDoA targets for globe overlay
  const targetsQuery = trpc.targets.list.useQuery(undefined, {
    refetchInterval: 15000,
  });
  const savedTargets = useMemo<SavedTargetData[]>(() => {
    if (!targetsQuery.data) return [];
    return (targetsQuery.data as any[])
      .filter((t: any) => t.visible)
      .map((t: any) => ({
        id: t.id,
        label: t.label,
        lat: parseFloat(t.lat),
        lon: parseFloat(t.lon),
        color: t.color,
        frequencyKhz: t.frequencyKhz ? parseFloat(t.frequencyKhz) : null,
      }));
  }, [targetsQuery.data]);

  // Fetch all target position history for drift trail rendering
  const allHistoryQuery = trpc.targets.getAllHistory.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const driftTrailData = useMemo(() => {
    if (!allHistoryQuery.data || !targetsQuery.data) return undefined;
    const historyByTarget = new Map<number, DriftTrailEntry[]>();
    const targetColors = new Map<number, string>();

    // Build color map from visible targets
    for (const t of (targetsQuery.data as any[])) {
      if (t.visible) {
        targetColors.set(t.id, t.color);
      }
    }

    // Group history entries by target
    for (const entry of (allHistoryQuery.data as any[])) {
      if (!targetColors.has(entry.targetId)) continue; // skip hidden targets
      if (!historyByTarget.has(entry.targetId)) {
        historyByTarget.set(entry.targetId, []);
      }
      historyByTarget.get(entry.targetId)!.push({
        targetId: entry.targetId,
        lat: parseFloat(entry.lat),
        lon: parseFloat(entry.lon),
        observedAt: entry.observedAt,
      });
    }

    return { historyByTarget, targetColors };
  }, [allHistoryQuery.data, targetsQuery.data]);

  // Fetch predictions for all visible targets with enough history
  const predictionsQuery = trpc.targets.predictAll.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const predictions = useMemo<PredictionData[]>(() => {
    if (!predictionsQuery.data || !targetsQuery.data) return [];
    const visibleTargets = new Set(
      (targetsQuery.data as any[]).filter((t: any) => t.visible).map((t: any) => t.id)
    );
    return (predictionsQuery.data as any[])
      .filter((p: any) => visibleTargets.has(p.targetId))
      .map((p: any) => {
        const target = (targetsQuery.data as any[]).find((t: any) => t.id === p.targetId);
        return {
          targetId: p.targetId,
          predictedLat: p.predictedLat,
          predictedLon: p.predictedLon,
          ellipseMajor: p.ellipseMajor,
          ellipseMinor: p.ellipseMinor,
          ellipseRotation: p.ellipseRotation,
          color: target?.color || '#ffffff',
          label: target?.label || `Target ${p.targetId}`,
          rSquaredLat: p.rSquaredLat,
          rSquaredLon: p.rSquaredLon,
          bearingDeg: p.bearingDeg,
          velocityKmh: p.velocityKmh,
        } as PredictionData;
      });
  }, [predictionsQuery.data, targetsQuery.data]);

  // Save target mutation (used from TDoA result)
  const trpcUtils = trpc.useUtils();
  const saveTargetMutation = trpc.targets.save.useMutation({
    onSuccess: () => {
      trpcUtils.targets.list.invalidate();
    },
  });

  // Build TDoA overlay data for the globe
  const tdoaOverlay = useMemo<TdoaOverlayData>(() => {
    if (!tdoaOpen && !tdoaResult) return { visible: false };

    const hosts = tdoaSelectedHosts.map((h: any) => ({
      lat: h.lat,
      lon: h.lon,
      hostname: h.h || h.id || "",
      selected: true,
      status: "idle" as const,
    }));

    if (tdoaResult) {
      return {
        visible: true,
        hosts: tdoaResult.hosts.map((h) => ({
          lat: h.lat,
          lon: h.lon,
          hostname: h.h,
          selected: true,
          status: "ok" as const,
        })),
        targetLat: tdoaResult.likelyLat,
        targetLon: tdoaResult.likelyLon,
        contours: tdoaResult.contours,
        heatmapUrl: tdoaResult.heatmapUrl,
        heatmapBounds: tdoaResult.heatmapBounds,
      };
    }

    return {
      visible: tdoaOpen && hosts.length > 0,
      hosts,
    };
  }, [tdoaOpen, tdoaSelectedHosts, tdoaResult]);

  const handleTdoaReplay = useCallback((job: {
    likelyLat: number;
    likelyLon: number;
    hosts: { lat: number; lon: number; h: string }[];
    contours: any[];
    jobId: string;
    heatmapUrl?: string;
    heatmapBounds?: { north: number; south: number; east: number; west: number };
  }) => {
    setTdoaResult(job);
    setTdoaOpen(true);
  }, []);
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
      {/* Space background — reduced opacity in light mode for softer backdrop */}
      <div
        className={`absolute inset-0 bg-cover bg-center pointer-events-none transition-opacity duration-500 ${
          isDark ? "opacity-40" : "opacity-15"
        }`}
        style={{ backgroundImage: `url(${SPACE_BG})` }}
      />

      {/* Light mode: soft warm wash behind the globe for a clean, airy feel */}
      {!isDark && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse at 50% 50%, oklch(0.92 0.02 195 / 40%) 0%, oklch(0.96 0.005 260 / 60%) 50%, oklch(0.97 0.003 260 / 80%) 100%)",
          }}
        />
      )}

      {/* Subtle vignette overlay — softer in light mode */}
      <div className="absolute inset-0 pointer-events-none"
        style={{
          background: isDark
            ? "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.7) 100%)"
            : "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.12) 100%)",
        }}
      />

      {/* Bottom gradient for UI readability — lighter in light mode */}
      <div className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none z-10"
        style={{
          background: isDark
            ? "linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 100%)"
            : "linear-gradient(to top, rgba(0,0,0,0.06) 0%, transparent 100%)",
        }}
      />

      {/* Loading screen */}
      <AnimatePresence>
        {loading && <LoadingScreen />}
      </AnimatePresence>

      {/* 3D Globe — wrapped in local error boundary to isolate WebGL crashes */}
      <GlobeErrorBoundary>
        <Globe
          ref={globeRef}
          ionosondes={propVisible ? ionosondesRef.current : []}
          isStationOnline={isStationOnline}
          tdoaOverlay={tdoaOverlay}
          savedTargets={savedTargets}
          driftTrailData={driftTrailData}
          predictions={predictions}
          conflictEvents={conflictVisible ? conflictEventsRef.current : []}
          conflictHeatmapMode={conflictVisible && heatmapMode}
          conflictZoneStations={conflictVisible ? conflictZoneStations : undefined}
        />
      </GlobeErrorBoundary>

      {/* Batch pre-check progress / auto-refresh indicator */}
      <div className="absolute bottom-2 right-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background/70 backdrop-blur-sm border border-border">
        {batchProgress.running && batchProgress.total > 0 ? (
          <>
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-[10px] font-mono text-muted-foreground">
              {autoRefresh.cycleCount > 0 ? `Refresh #${autoRefresh.cycleCount}: ` : "Scanning: "}
              {batchProgress.checked}/{batchProgress.total}
            </span>
            <div className="w-20 h-1 bg-foreground/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-400/60 rounded-full transition-all duration-500"
                style={{ width: `${Math.round((batchProgress.checked / batchProgress.total) * 100)}%` }}
              />
            </div>
          </>
        ) : autoRefresh.active && autoRefresh.nextRefreshAt ? (
          <>
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-[10px] font-mono text-muted-foreground">
              Auto-refresh in {formatCountdown(autoRefresh.nextRefreshAt)}
            </span>
          </>
        ) : batchProgress.total > 0 ? (
          <>
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-[10px] font-mono text-muted-foreground">
              {batchProgress.checked} receivers scanned
            </span>
          </>
        ) : null}
      </div>

      {/* Title / Branding */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.6 }}
        className="absolute top-5 left-1/2 -translate-x-1/2 z-20 text-center pointer-events-none"
      >
        <div className="relative px-6 py-2">
          <div className="absolute inset-0 rounded-xl bg-background/60 backdrop-blur-sm" />
          <div className="relative">
            <h1 className="text-xl font-semibold text-foreground tracking-tight drop-shadow-lg">
              Valentine <span className="text-primary text-glow-coral">RF</span>
            </h1>
            <p className="text-[11px] font-mono text-muted-foreground uppercase tracking-[0.3em] mt-0.5 drop-shadow-md">
              SigINT — Global Receiver Intelligence
            </p>
          </div>
        </div>
      </motion.div>

      {/* Top-right button group — grouped into dropdown menus */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 1, duration: 0.5 }}
        className="absolute top-5 right-4 z-20 flex items-center gap-1.5"
      >
        {/* Theme Toggle */}
        <ThemeToggle />

        {/* Keyboard Shortcuts Help */}
        <button
          onClick={() => setHelpOpen(true)}
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-foreground/5 border border-border backdrop-blur-md hover:bg-foreground/10 hover:border-border transition-all group"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          <span className="text-sm font-mono font-bold text-muted-foreground group-hover:text-foreground/80 transition-colors">?</span>
        </button>

        {/* Separator */}
        <div className="w-px h-6 bg-border/50 mx-0.5" />

        {/* Overlays Group — Propagation + Conflict */}
        <NavBarGroup
          label="Overlays"
          icon={<Layers className="w-4 h-4" />}
          colorClass="cyan"
          items={[
            {
              id: "propagation",
              label: "HF Propagation",
              icon: <Activity className="w-4 h-4" />,
              onClick: () => setPropVisible(!propVisible),
              active: propVisible,
              colorClass: "cyan",
            },
            {
              id: "conflict",
              label: "Conflict Data (UCDP)",
              icon: <Flame className="w-4 h-4" />,
              onClick: () => setConflictVisible(!conflictVisible),
              active: conflictVisible,
              colorClass: "red",
            },
          ]}
        />

        {/* SIGINT Tools Group — TDoA + Targets + Mil-RF */}
        <NavBarGroup
          label="SIGINT"
          icon={<Crosshair className="w-4 h-4" />}
          colorClass="violet"
          items={[
            {
              id: "tdoa",
              label: "TDoA Triangulation",
              icon: <Crosshair className="w-4 h-4" />,
              onClick: () => setTdoaOpen(!tdoaOpen),
              active: tdoaOpen,
              badge: tdoaSelectedHosts.length > 0 ? tdoaSelectedHosts.length : null,
              colorClass: "violet",
            },
            {
              id: "targets",
              label: "Saved Targets",
              icon: <Target className="w-4 h-4" />,
              onClick: () => setTargetsOpen(!targetsOpen),
              active: targetsOpen,
              badge: savedTargets.length > 0 ? savedTargets.length : null,
              colorClass: "rose",
            },
            {
              id: "milrf",
              label: "Military RF Intel",
              icon: <Radar className="w-4 h-4" />,
              onClick: () => setMilRfOpen(true),
              colorClass: "red",
            },
          ]}
        />

        {/* Monitoring Group — Watchlist + Alerts + Anomaly */}
        <NavBarGroup
          label="Monitor"
          icon={<Shield className="w-4 h-4" />}
          colorClass="emerald"
          items={[
            {
              id: "watchlist",
              label: `Watchlist${watchCount > 0 ? ` (${watchOnline}/${watchCount})` : ""}`,
              icon: <Eye className="w-4 h-4" />,
              onClick: () => setWatchlistOpen(true),
              badge: watchCount > 0 ? watchCount : null,
              colorClass: "emerald",
            },
            {
              id: "alerts",
              label: "Alert Settings",
              icon: <Bell className="w-4 h-4" />,
              onClick: () => setAlertsOpen(true),
              badge: unackAlerts > 0 ? unackAlerts : null,
              badgePulse: unackAlerts > 0,
              colorClass: "amber",
            },
            {
              id: "anomaly",
              label: "Anomaly Detection",
              icon: <AlertTriangle className="w-4 h-4" />,
              onClick: () => setAnomalyPanelOpen(!anomalyPanelOpen),
              active: anomalyPanelOpen,
              badge: anomalyCount > 0 ? anomalyCount : null,
              badgePulse: anomalyCount > 0,
              colorClass: "red",
            },
            {
              id: "sigint-conflict",
              label: "SIGINT × Conflict",
              icon: <Activity className="w-4 h-4" />,
              onClick: () => setConflictTimelineOpen(!conflictTimelineOpen),
              active: conflictTimelineOpen,
              colorClass: "cyan",
            },
          ]}
        />

        {/* Collaboration Group — Share + Dashboard */}
        <NavBarGroup
          label="Collab"
          icon={<Users className="w-4 h-4" />}
          colorClass="blue"
          items={[
            {
              id: "share",
              label: "Shared Target Lists",
              icon: <Users className="w-4 h-4" />,
              onClick: () => setSharingPanelOpen(!sharingPanelOpen),
              active: sharingPanelOpen,
              colorClass: "blue",
            },
            {
              id: "dashboard",
              label: "Analytics Dashboard",
              icon: <BarChart3 className="w-4 h-4" />,
              onClick: () => navigate("/dashboard"),
              colorClass: "indigo",
            },
          ]}
        />
      </motion.div>

      {/* Saved Targets Panel */}
      <TargetManager
        isOpen={targetsOpen}
        onClose={() => setTargetsOpen(false)}
        onFocusTarget={(lat, lon) => {
          const s = globeRef.current;
          // Globe doesn't expose direct camera control, but we can use the TDoA result mechanism
          // to trigger a camera focus
          if (s) {
            // Use a temporary overlay to trigger camera focus
            setTdoaResult({
              likelyLat: lat,
              likelyLon: lon,
              hosts: [],
              contours: [],
              jobId: 'focus',
            });
            // Clear after a short delay so it doesn't persist as a TDoA result
            setTimeout(() => setTdoaResult(null), 500);
          }
        }}
      />

      {/* Military RF Intelligence Panel */}
      <MilitaryRfPanel isOpen={milRfOpen} onClose={() => setMilRfOpen(false)} />

      {/* Alert Settings Panel */}
      <AnimatePresence>
        {alertsOpen && <AlertSettings onClose={() => setAlertsOpen(false)} />}
      </AnimatePresence>

      {/* Anomaly Alert Panel */}
      <AnomalyAlertPanel
        isOpen={anomalyPanelOpen}
        onClose={() => setAnomalyPanelOpen(false)}
        targets={(targetsQuery.data as any[])?.map((t: any) => ({
          id: t.id,
          label: t.label,
          category: t.category,
        })) ?? []}
      />

      {/* Shared Lists Panel */}
      <SharedListPanel
        isOpen={sharingPanelOpen}
        onClose={() => setSharingPanelOpen(false)}
        availableTargets={(targetsQuery.data as any[])?.map((t: any) => ({
          id: t.id,
          label: t.label,
          category: t.category || "unknown",
        })) ?? []}
      />

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

      {/* TDoA Triangulation Panel */}
      <TDoAPanel
        isOpen={tdoaOpen}
        onClose={() => {
          setTdoaOpen(false);
          setTdoaResult(null);
        }}
        selectedHosts={tdoaSelectedHosts}
        onToggleHost={(host) => {
          setTdoaSelectedHosts((prev) => {
            const exists = prev.some((h) => h.h === host.h && h.p === host.p);
            if (exists) return prev.filter((h) => !(h.h === host.h && h.p === host.p));
            if (prev.length >= 6) return prev;
            return [...prev, host];
          });
        }}
        onClearHosts={() => setTdoaSelectedHosts([])}
        onResult={(res) => {
          setTdoaResult({
            likelyLat: res.likelyLat,
            likelyLon: res.likelyLon,
            hosts: tdoaSelectedHosts.map((h: any) => ({ lat: h.lat, lon: h.lon, h: h.h || h.id })),
            contours: [],
            jobId: res.jobId,
            heatmapUrl: res.heatmapUrl,
            heatmapBounds: res.heatmapBounds,
          });
        }}
        onReplayJob={handleTdoaReplay}
        onToggleWaterfall={() => setWaterfallVisible((v) => !v)}
        waterfallVisible={waterfallVisible}
        onScreenshot={() => {
          const dataUrl = globeRef.current?.captureScreenshot();
          if (!dataUrl) return;
          const link = document.createElement("a");
          link.download = `tdoa-globe-${Date.now()}.png`;
          link.href = dataUrl;
          link.click();
        }}
        onSaveTarget={(data) => {
          saveTargetMutation.mutate(data, {
            onSuccess: () => {
              targetsQuery.refetch();
            },
          });
        }}
      />

      {/* Live KiwiSDR Waterfall */}
      <KiwiWaterfall
        hosts={tdoaSelectedHosts}
        frequencyKhz={waterfallFreq}
        passbandHz={waterfallPb}
        visible={waterfallVisible && tdoaSelectedHosts.length > 0}
        onClose={() => setWaterfallVisible(false)}
      />

      {/* Propagation Overlay Panel */}
      <AnimatePresence>
        <PropagationOverlay
          visible={propVisible}
          onIonosondesLoaded={handleIonosondesLoaded}
        />
      </AnimatePresence>

      {/* SIGINT × Conflict Timeline */}
      <SigintConflictTimeline
        isOpen={conflictTimelineOpen}
        onClose={() => setConflictTimelineOpen(false)}
        conflictEvents={conflictEventsRef.current}
        onFocusPosition={(_lat, _lon) => {
          // Globe auto-rotates; focus position is informational
        }}
      />

      {/* Conflict Data Overlay (UCDP) */}
      <ConflictOverlay
        visible={conflictVisible}
        onEventsLoaded={useCallback((events: SlimConflictEvent[]) => {
          conflictEventsRef.current = events;
          setConflictTick((t) => t + 1);
        }, [])}
        heatmapMode={heatmapMode}
        onHeatmapToggle={setHeatmapMode}
        onConflictZoneStations={setConflictZoneStations}
        correlationRadius={correlationRadius}
        onCorrelationRadiusChange={setCorrelationRadius}
      />

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
          <p className="text-xs font-mono text-muted-foreground text-center drop-shadow-lg"
            style={{ textShadow: '0 1px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.5)' }}
          >
            Select a target or search to begin reconnaissance · <span className="text-muted-foreground/50">↑↓ to browse · Enter to select · ? for shortcuts</span>
          </p>
        </motion.div>
      )}

      {/* Stats */}
      {!selectedStation && <StatsOverlay />}

      {/* Legend */}
      {!selectedStation && <Legend />}

      {/* Station List Sidebar */}
      <StationList />

      {/* Keyboard Shortcuts Help Overlay */}
      <ShortcutHelpOverlay
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        shortcuts={shortcuts}
      />
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
