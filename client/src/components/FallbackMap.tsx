/**
 * FallbackMap.tsx — Lightweight 2D SVG world map fallback
 *
 * Renders an equirectangular world map with SDR station markers when
 * WebGL is unavailable or the context is lost. Zero Three.js dependency.
 * Activates/deactivates based on RenderMode events.
 *
 * Full interaction support:
 *  - Click a single-station dot → select station + open panel
 *  - Click a cluster dot → zoom into cluster and show picker list
 *  - Hover dot → show tooltip with station info + set hoveredStation
 *  - Selected station gets a pulsing ring highlight
 *  - Pan (drag) and zoom (scroll wheel) the map
 *  - Touch support for mobile (drag + pinch-zoom)
 */
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { onRenderModeChange, getRenderMode } from "@/lib/RenderMode";
import type { Station } from "@/lib/types";
import { detectBands, BAND_DEFINITIONS } from "@/lib/types";

/** Equirectangular projection: lat/lng to pixel coordinates */
function latLngToXY(
  lat: number,
  lng: number,
  width: number,
  height: number
): { x: number; y: number } {
  const x = ((lng + 180) / 360) * width;
  const y = ((90 - lat) / 180) * height;
  return { x, y };
}

/** Station type color mapping (matches Globe.tsx) */
const TYPE_COLORS: Record<string, string> = {
  OpenWebRX: "#06b6d4",
  WebSDR: "#ff6b6b",
  KiwiSDR: "#4ade80",
};

const STATUS_ONLINE = "#22c55e";
const STATUS_OFFLINE = "#ef4444";

/** Geographic clustering grid size in degrees — adapts to zoom */
function getClusterGridSize(zoom: number): number {
  if (zoom >= 4) return 1;
  if (zoom >= 2) return 2;
  return 5;
}

interface ClusteredStation {
  lat: number;
  lng: number;
  stations: Station[];
  color: string;
  radius: number;
}

/**
 * Cluster stations by geographic grid. Grid size adapts to zoom level.
 */
function clusterStations(
  stations: Station[],
  gridSize: number,
  isStationOnline?: (station: Station) => boolean | null
): ClusteredStation[] {
  // At tight zoom or low station count, don't cluster
  if (stations.length <= 500 && gridSize <= 2) {
    return stations.map((s) => {
      const [lng, lat] = s.location.coordinates;
      const primaryType = s.receivers[0]?.type || "WebSDR";
      let color = TYPE_COLORS[primaryType] || TYPE_COLORS.WebSDR;

      if (isStationOnline) {
        const status = isStationOnline(s);
        if (status === true) color = STATUS_ONLINE;
        else if (status === false) color = STATUS_OFFLINE;
      }

      return { lat, lng, stations: [s], color, radius: 3 };
    });
  }

  // Grid-based clustering
  const grid = new Map<string, { lats: number[]; lngs: number[]; stations: Station[] }>();
  stations.forEach((s) => {
    const [lng, lat] = s.location.coordinates;
    const gridKey = `${Math.floor(lat / gridSize)},${Math.floor(lng / gridSize)}`;
    if (!grid.has(gridKey)) {
      grid.set(gridKey, { lats: [], lngs: [], stations: [] });
    }
    const cell = grid.get(gridKey)!;
    cell.lats.push(lat);
    cell.lngs.push(lng);
    cell.stations.push(s);
  });

  const clusters: ClusteredStation[] = [];
  grid.forEach((cell) => {
    const avgLat = cell.lats.reduce((a, b) => a + b, 0) / cell.lats.length;
    const avgLng = cell.lngs.reduce((a, b) => a + b, 0) / cell.lngs.length;

    // Determine dominant type
    const typeCounts: Record<string, number> = {};
    cell.stations.forEach((s) => {
      const t = s.receivers[0]?.type || "WebSDR";
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    const dominantType = Object.entries(typeCounts).sort(
      (a, b) => b[1] - a[1]
    )[0][0];

    // Determine color — if all have same online status, use that
    let color = TYPE_COLORS[dominantType] || TYPE_COLORS.WebSDR;
    if (isStationOnline && cell.stations.length === 1) {
      const status = isStationOnline(cell.stations[0]);
      if (status === true) color = STATUS_ONLINE;
      else if (status === false) color = STATUS_OFFLINE;
    }

    const radius = Math.min(8, 2 + Math.log2(cell.stations.length) * 1.5);

    clusters.push({
      lat: avgLat,
      lng: avgLng,
      stations: cell.stations,
      color,
      radius,
    });
  });

  return clusters;
}

interface FallbackMapProps {
  stations: Station[];
  selectedStation?: Station | null;
  hoveredStation?: Station | null;
  isStationOnline?: (station: Station) => boolean | null;
  onSelectStation?: (station: Station) => void;
  onHoverStation?: (station: Station | null) => void;
}

/**
 * 2D SVG fallback map that renders when WebGL is unavailable.
 * Shows all SDR stations as dots on an equirectangular world map projection.
 * Full click/hover/zoom/pan interaction matching the 3D Globe behavior.
 */
export default function FallbackMap({
  stations,
  selectedStation,
  hoveredStation,
  isStationOnline,
  onSelectStation,
  onHoverStation,
}: FallbackMapProps) {
  const [visible, setVisible] = useState(getRenderMode() === "fallback");
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Tooltip state (positioned via mouse coords)
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    cluster: ClusteredStation;
  } | null>(null);

  // Cluster picker state — when clicking a multi-station cluster
  const [clusterPicker, setClusterPicker] = useState<{
    x: number;
    y: number;
    stations: Station[];
  } | null>(null);

  // Pan & zoom state
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 960, h: 480 });
  const [zoom, setZoom] = useState(1);
  const dragRef = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    startViewX: number;
    startViewY: number;
    moved: boolean;
  }>({ dragging: false, startX: 0, startY: 0, startViewX: 0, startViewY: 0, moved: false });

  // Touch state for pinch zoom
  const touchRef = useRef<{ lastDist: number; lastCenter: { x: number; y: number } }>({
    lastDist: 0,
    lastCenter: { x: 0, y: 0 },
  });

  // Pulse animation for selected station
  const [pulsePhase, setPulsePhase] = useState(0);
  useEffect(() => {
    if (!visible || !selectedStation) return;
    const interval = setInterval(() => {
      setPulsePhase((p) => (p + 1) % 60);
    }, 50);
    return () => clearInterval(interval);
  }, [visible, selectedStation]);

  // Listen for render mode changes
  useEffect(() => {
    const cleanup = onRenderModeChange((detail) => {
      setVisible(detail.mode === "fallback");
    });
    return cleanup;
  }, []);

  // Map dimensions
  const MAP_W = 960;
  const MAP_H = 480;

  const gridSize = useMemo(() => getClusterGridSize(zoom), [zoom]);

  const clusters = useMemo(
    () => clusterStations(stations, gridSize, isStationOnline),
    [stations, gridSize, isStationOnline]
  );

  // Find the cluster containing the selected station for highlighting
  const selectedClusterIdx = useMemo(() => {
    if (!selectedStation) return -1;
    return clusters.findIndex((c) =>
      c.stations.some(
        (s) =>
          s.label === selectedStation.label &&
          s.location.coordinates[0] === selectedStation.location.coordinates[0] &&
          s.location.coordinates[1] === selectedStation.location.coordinates[1]
      )
    );
  }, [clusters, selectedStation]);

  // --- Pan handlers ---
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only left button
    if (e.button !== 0) return;
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startViewX: viewBox.x,
      startViewY: viewBox.y,
      moved: false,
    };
  }, [viewBox.x, viewBox.y]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragRef.current.dragging) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        dragRef.current.moved = true;
      }

      // Convert pixel delta to viewBox units
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const scaleX = viewBox.w / rect.width;
      const scaleY = viewBox.h / rect.height;

      setViewBox((prev) => ({
        ...prev,
        x: dragRef.current.startViewX - dx * scaleX,
        y: dragRef.current.startViewY - dy * scaleY,
      }));
    },
    [viewBox.w, viewBox.h]
  );

  const handleMouseUp = useCallback(() => {
    dragRef.current.dragging = false;
  }, []);

  // --- Zoom handler ---
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      // Mouse position in viewBox coordinates
      const mouseXRatio = (e.clientX - rect.left) / rect.width;
      const mouseYRatio = (e.clientY - rect.top) / rect.height;
      const mouseVBX = viewBox.x + mouseXRatio * viewBox.w;
      const mouseVBY = viewBox.y + mouseYRatio * viewBox.h;

      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;
      const newW = Math.max(120, Math.min(MAP_W, viewBox.w * zoomFactor));
      const newH = Math.max(60, Math.min(MAP_H, viewBox.h * zoomFactor));
      const newZoom = MAP_W / newW;

      // Keep mouse position stable
      const newX = mouseVBX - mouseXRatio * newW;
      const newY = mouseVBY - mouseYRatio * newH;

      setViewBox({ x: newX, y: newY, w: newW, h: newH });
      setZoom(newZoom);
    },
    [viewBox]
  );

  // --- Touch handlers ---
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        dragRef.current = {
          dragging: true,
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          startViewX: viewBox.x,
          startViewY: viewBox.y,
          moved: false,
        };
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchRef.current.lastDist = Math.sqrt(dx * dx + dy * dy);
        touchRef.current.lastCenter = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        };
      }
    },
    [viewBox.x, viewBox.y]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && dragRef.current.dragging) {
        const dx = e.touches[0].clientX - dragRef.current.startX;
        const dy = e.touches[0].clientY - dragRef.current.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          dragRef.current.moved = true;
        }
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const scaleX = viewBox.w / rect.width;
        const scaleY = viewBox.h / rect.height;
        setViewBox((prev) => ({
          ...prev,
          x: dragRef.current.startViewX - dx * scaleX,
          y: dragRef.current.startViewY - dy * scaleY,
        }));
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (touchRef.current.lastDist > 0) {
          const scale = touchRef.current.lastDist / dist;
          const newW = Math.max(120, Math.min(MAP_W, viewBox.w * scale));
          const newH = Math.max(60, Math.min(MAP_H, viewBox.h * scale));
          setViewBox((prev) => ({ ...prev, w: newW, h: newH }));
          setZoom(MAP_W / newW);
        }
        touchRef.current.lastDist = dist;
      }
    },
    [viewBox.w, viewBox.h]
  );

  const handleTouchEnd = useCallback(() => {
    dragRef.current.dragging = false;
    touchRef.current.lastDist = 0;
  }, []);

  // --- Dot interaction handlers ---
  const handleDotHover = useCallback(
    (e: React.MouseEvent, cluster: ClusteredStation) => {
      setTooltip({ x: e.clientX, y: e.clientY, cluster });
      // Set hovered station for the HoverTooltip system (single station only)
      if (cluster.stations.length === 1 && onHoverStation) {
        onHoverStation(cluster.stations[0]);
      }
    },
    [onHoverStation]
  );

  const handleDotLeave = useCallback(() => {
    setTooltip(null);
    if (onHoverStation) {
      onHoverStation(null);
    }
  }, [onHoverStation]);

  const handleDotClick = useCallback(
    (e: React.MouseEvent, cluster: ClusteredStation) => {
      e.stopPropagation();
      // Dismiss cluster picker if clicking a different dot
      setClusterPicker(null);

      if (cluster.stations.length === 1) {
        // Single station — select it directly
        if (onSelectStation) {
          onSelectStation(cluster.stations[0]);
        }
      } else {
        // Multi-station cluster — show picker dropdown
        setClusterPicker({
          x: e.clientX,
          y: e.clientY,
          stations: cluster.stations,
        });
      }
    },
    [onSelectStation]
  );

  const handlePickerSelect = useCallback(
    (station: Station) => {
      setClusterPicker(null);
      if (onSelectStation) {
        onSelectStation(station);
      }
    },
    [onSelectStation]
  );

  // Close picker when clicking background
  const handleBackgroundClick = useCallback(() => {
    if (!dragRef.current.moved) {
      setClusterPicker(null);
    }
  }, []);

  // Reset view
  const handleResetView = useCallback(() => {
    setViewBox({ x: 0, y: 0, w: MAP_W, h: MAP_H });
    setZoom(1);
  }, []);

  if (!visible) return null;

  // Pulse animation value (0..1 sine wave)
  const pulseValue = Math.sin((pulsePhase / 60) * Math.PI * 2) * 0.5 + 0.5;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-[6] bg-[#0a0e14]"
      style={{ contain: "layout paint", cursor: dragRef.current.dragging ? "grabbing" : "grab" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={handleBackgroundClick}
    >
      {/* Status banner */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-center gap-2 py-2 bg-amber-500/15 border-b border-amber-500/25 backdrop-blur-sm">
        <svg
          className="w-4 h-4 text-amber-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126Z"
          />
        </svg>
        <span className="text-xs font-mono text-amber-300/90">
          WebGL unavailable — 3D globe suspended. Showing 2D station map.
        </span>
        {zoom > 1.1 && (
          <button
            onClick={(e) => { e.stopPropagation(); handleResetView(); }}
            className="ml-2 px-2 py-0.5 text-[10px] font-mono text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 rounded hover:bg-cyan-500/20 transition-colors"
          >
            Reset View
          </button>
        )}
      </div>

      {/* SVG Map */}
      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
        style={{ paddingTop: "32px" }}
      >
        {/* Background */}
        <rect x={-200} y={-200} width={MAP_W + 400} height={MAP_H + 400} fill="#0a0e14" />

        {/* Grid lines */}
        {Array.from({ length: 7 }, (_, i) => {
          const y = (i * MAP_H) / 6;
          return (
            <line
              key={`h${i}`}
              x1={0}
              y1={y}
              x2={MAP_W}
              y2={y}
              stroke="rgba(100,180,200,0.08)"
              strokeWidth={0.5}
            />
          );
        })}
        {Array.from({ length: 13 }, (_, i) => {
          const x = (i * MAP_W) / 12;
          return (
            <line
              key={`v${i}`}
              x1={x}
              y1={0}
              x2={x}
              y2={MAP_H}
              stroke="rgba(100,180,200,0.08)"
              strokeWidth={0.5}
            />
          );
        })}

        {/* Continent shapes — simplified filled polygons */}
        {/* North America */}
        <ellipse cx={200} cy={140} rx={80} ry={60} fill="rgba(100,180,200,0.04)" stroke="rgba(100,180,200,0.1)" strokeWidth={0.5} />
        {/* Europe */}
        <ellipse cx={490} cy={130} rx={50} ry={40} fill="rgba(100,180,200,0.04)" stroke="rgba(100,180,200,0.1)" strokeWidth={0.5} />
        {/* Africa */}
        <ellipse cx={490} cy={260} rx={40} ry={55} fill="rgba(100,180,200,0.04)" stroke="rgba(100,180,200,0.1)" strokeWidth={0.5} />
        {/* Asia */}
        <ellipse cx={650} cy={150} rx={100} ry={55} fill="rgba(100,180,200,0.04)" stroke="rgba(100,180,200,0.1)" strokeWidth={0.5} />
        {/* South America */}
        <ellipse cx={260} cy={310} rx={35} ry={55} fill="rgba(100,180,200,0.04)" stroke="rgba(100,180,200,0.1)" strokeWidth={0.5} />
        {/* Australia */}
        <ellipse cx={810} cy={330} rx={35} ry={25} fill="rgba(100,180,200,0.04)" stroke="rgba(100,180,200,0.1)" strokeWidth={0.5} />

        {/* Station dots */}
        {clusters.map((cluster, i) => {
          const { x, y } = latLngToXY(
            cluster.lat,
            cluster.lng,
            MAP_W,
            MAP_H
          );
          const isMulti = cluster.stations.length > 1;
          const isSelected = i === selectedClusterIdx;
          const dotRadius = cluster.radius / Math.max(1, zoom * 0.5);

          return (
            <g key={i}>
              {/* Selected station pulsing ring */}
              {isSelected && (
                <>
                  <circle
                    cx={x}
                    cy={y}
                    r={dotRadius * (2 + pulseValue * 2)}
                    fill="none"
                    stroke="#ff6b6b"
                    strokeWidth={0.8 / zoom}
                    opacity={0.6 - pulseValue * 0.4}
                  />
                  <circle
                    cx={x}
                    cy={y}
                    r={dotRadius * (3 + pulseValue * 1.5)}
                    fill="none"
                    stroke="#ff6b6b"
                    strokeWidth={0.5 / zoom}
                    opacity={0.3 - pulseValue * 0.2}
                  />
                </>
              )}
              {/* Glow */}
              <circle
                cx={x}
                cy={y}
                r={dotRadius * 2}
                fill={isSelected ? "#ff6b6b" : cluster.color}
                opacity={isSelected ? 0.25 : 0.1}
              />
              {/* Dot */}
              <circle
                cx={x}
                cy={y}
                r={dotRadius}
                fill={isSelected ? "#ff6b6b" : cluster.color}
                opacity={isSelected ? 1 : 0.8}
                stroke={isSelected ? "#ff6b6b" : cluster.color}
                strokeWidth={isSelected ? 1 / zoom : 0.5 / zoom}
                strokeOpacity={isSelected ? 0.8 : 0.5}
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) => { e.stopPropagation(); handleDotHover(e, cluster); }}
                onMouseLeave={handleDotLeave}
                onClick={(e) => handleDotClick(e, cluster)}
              />
              {/* Cluster count badge */}
              {isMulti && cluster.stations.length > 2 && (
                <text
                  x={x}
                  y={y + 0.5}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontSize={Math.max(3, (cluster.radius < 4 ? 4 : 5) / Math.max(1, zoom * 0.5))}
                  fontFamily="JetBrains Mono, monospace"
                  style={{ pointerEvents: "none" }}
                >
                  {cluster.stations.length}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y - 8,
            maxWidth: 300,
          }}
        >
          <div className="px-3 py-2 rounded-lg bg-background/95 border border-border backdrop-blur-sm">
            {tooltip.cluster.stations.length === 1 ? (
              <SingleStationTooltip
                station={tooltip.cluster.stations[0]}
                isStationOnline={isStationOnline}
              />
            ) : (
              <ClusterTooltip cluster={tooltip.cluster} />
            )}
          </div>
        </div>
      )}

      {/* Cluster picker dropdown */}
      {clusterPicker && (
        <div
          className="fixed z-50"
          style={{
            left: clusterPicker.x,
            top: clusterPicker.y + 8,
            maxWidth: 320,
            maxHeight: 300,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="rounded-lg bg-background/95 border border-border backdrop-blur-md overflow-hidden shadow-xl">
            <div className="px-3 py-2 border-b border-border">
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {clusterPicker.stations.length} stations in this area
              </span>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
              {clusterPicker.stations.map((station, idx) => {
                const primaryType = station.receivers[0]?.type || "WebSDR";
                const typeColor = TYPE_COLORS[primaryType] || "#888";
                let statusDot: string | null = null;
                if (isStationOnline) {
                  const status = isStationOnline(station);
                  if (status === true) statusDot = STATUS_ONLINE;
                  else if (status === false) statusDot = STATUS_OFFLINE;
                }
                return (
                  <button
                    key={idx}
                    onClick={() => handlePickerSelect(station)}
                    className="w-full text-left px-3 py-2 hover:bg-foreground/5 transition-colors flex items-center gap-2 group border-b border-border last:border-0"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: statusDot || typeColor }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-foreground/90 truncate group-hover:text-foreground">
                        {station.label}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9px] font-mono text-muted-foreground/70">{primaryType}</span>
                        <span className="text-[9px] font-mono text-muted-foreground/50">
                          {station.receivers.length} rx
                        </span>
                      </div>
                    </div>
                    <svg className="w-3 h-3 text-muted-foreground/30 group-hover:text-cyan-400 flex-shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-4 px-3 py-2 rounded-lg bg-background/70 border border-border">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-[10px] font-mono text-muted-foreground">{type}</span>
          </div>
        ))}
      </div>

      {/* Station count + zoom level */}
      <div className="absolute bottom-4 left-4 z-10 flex items-center gap-3 px-3 py-1.5 rounded-lg bg-background/70 border border-border">
        <span className="text-[10px] font-mono text-muted-foreground">
          {stations.length} stations
        </span>
        {zoom > 1.1 && (
          <span className="text-[10px] font-mono text-cyan-400/60">
            {zoom.toFixed(1)}x
          </span>
        )}
      </div>
    </div>
  );
}

/** Tooltip content for a single station */
function SingleStationTooltip({
  station,
  isStationOnline,
}: {
  station: Station;
  isStationOnline?: (station: Station) => boolean | null;
}) {
  const bands = detectBands(station).map((b) => {
    const def = BAND_DEFINITIONS.find((d) => d.id === b);
    return def ? def.label : b;
  });

  let statusLabel: string | null = null;
  let statusColor: string | null = null;
  if (isStationOnline) {
    const status = isStationOnline(station);
    if (status === true) {
      statusLabel = "Online";
      statusColor = STATUS_ONLINE;
    } else if (status === false) {
      statusLabel = "Offline";
      statusColor = STATUS_OFFLINE;
    }
  }

  return (
    <>
      <div className="text-xs font-semibold text-foreground/90 truncate">
        {station.label}
      </div>
      <div className="flex items-center gap-2 mt-1">
        {station.receivers
          .map((r) => r.type)
          .filter((v, i, a) => a.indexOf(v) === i)
          .map((type) => (
            <div key={type} className="flex items-center gap-1">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: TYPE_COLORS[type] || "#888" }}
              />
              <span className="text-[10px] text-muted-foreground">{type}</span>
            </div>
          ))}
        <span className="text-[10px] text-muted-foreground/70">
          {station.receivers.length} receiver
          {station.receivers.length !== 1 ? "s" : ""}
        </span>
        {statusLabel && (
          <span className="text-[10px] font-medium" style={{ color: statusColor! }}>
            {statusLabel}
          </span>
        )}
      </div>
      {bands.length > 0 && (
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          {bands.map((b) => (
            <span
              key={b}
              className="text-[8px] font-mono text-cyan-300/70 bg-cyan-500/10 px-1 py-0.5 rounded"
            >
              {b}
            </span>
          ))}
        </div>
      )}
      <div className="text-[9px] text-muted-foreground/50 mt-1 font-mono">
        {station.location.coordinates[1].toFixed(2)},{" "}
        {station.location.coordinates[0].toFixed(2)}
      </div>
      <div className="text-[9px] text-cyan-400/50 mt-0.5">Click to select</div>
    </>
  );
}

/** Tooltip content for a multi-station cluster */
function ClusterTooltip({ cluster }: { cluster: ClusteredStation }) {
  const typeCounts: Record<string, number> = {};
  cluster.stations.forEach((s) => {
    const t = s.receivers[0]?.type || "WebSDR";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });

  return (
    <>
      <div className="text-xs font-semibold text-foreground/90">
        {cluster.stations.length} stations
      </div>
      <div className="flex items-center gap-2 mt-1">
        {Object.entries(typeCounts).map(([type, count]) => (
          <div key={type} className="flex items-center gap-1">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: TYPE_COLORS[type] || "#888" }}
            />
            <span className="text-[10px] text-muted-foreground">
              {count} {type}
            </span>
          </div>
        ))}
      </div>
      <div className="text-[9px] text-cyan-400/50 mt-1">Click to browse stations</div>
    </>
  );
}
