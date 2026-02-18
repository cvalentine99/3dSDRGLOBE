/**
 * FallbackMap.tsx — Lightweight 2D SVG world map fallback
 *
 * Renders an equirectangular world map with SDR station markers when
 * WebGL is unavailable or the context is lost. Zero Three.js dependency.
 * Activates/deactivates based on RenderMode events.
 */
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { onRenderModeChange, getRenderMode } from "@/lib/RenderMode";
import type { Station } from "@/lib/types";

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

/** Geographic clustering grid size in degrees */
const CLUSTER_GRID_SIZE = 5;

interface ClusteredStation {
  lat: number;
  lng: number;
  stations: Station[];
  color: string;
  radius: number;
}

/**
 * Cluster stations by geographic grid when count exceeds threshold.
 */
function clusterStations(
  stations: Station[],
  isStationOnline?: (station: Station) => boolean | null
): ClusteredStation[] {
  if (stations.length <= 500) {
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
    const gridKey = `${Math.floor(lat / CLUSTER_GRID_SIZE)},${Math.floor(lng / CLUSTER_GRID_SIZE)}`;
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

    const radius = Math.min(8, 2 + Math.log2(cell.stations.length) * 1.5);

    clusters.push({
      lat: avgLat,
      lng: avgLng,
      stations: cell.stations,
      color: TYPE_COLORS[dominantType] || TYPE_COLORS.WebSDR,
      radius,
    });
  });

  return clusters;
}

// Simplified world map SVG path — Natural Earth 110m coastlines (simplified)
const WORLD_MAP_PATH = `M 174.8,-41.3 L 175.3,-37.2 L 173.8,-34.4 L 171.2,-34.2
L 166.6,-46.0 L 168.4,-44.1 L 170.5,-43.3 L 172.5,-43.9 L 173.6,-42.5 Z
M 150.7,-34.1 L 152.1,-32.4 L 153.3,-30.1 L 150.8,-27.5 L 153.0,-24.7
L 152.3,-22.3 L 150.6,-22.5 L 148.8,-20.3 L 146.3,-19.0 L 144.5,-14.5
L 141.8,-12.8 L 136.5,-12.1 L 132.5,-12.1 L 130.6,-11.4 L 128.2,-14.8
L 125.1,-14.7 L 124.6,-16.6 L 123.5,-17.6 L 122.2,-18.0 L 118.9,-20.1
L 116.3,-20.9 L 114.1,-22.2 L 113.5,-24.8 L 114.5,-27.5 L 113.5,-28.5
L 114.6,-28.8 L 115.5,-30.7 L 115.5,-31.4 L 115.9,-33.4 L 117.3,-34.8
L 118.3,-35.0 L 121.5,-33.8 L 123.3,-33.9 L 126.7,-31.9 L 129.2,-31.3
L 131.1,-31.5 L 133.6,-32.0 L 134.5,-32.7 L 136.3,-33.8 L 137.5,-33.0
L 138.1,-33.7 L 138.5,-35.0 L 138.5,-34.0 L 140.7,-37.0 L 141.8,-38.0
L 142.9,-38.4 L 145.1,-38.5 L 146.0,-38.7 L 146.4,-39.3 L 147.5,-38.9
L 148.1,-37.5 L 149.5,-37.6 L 150.1,-36.0 Z`;

interface FallbackMapProps {
  stations: Station[];
  isStationOnline?: (station: Station) => boolean | null;
  onSelectStation?: (station: Station) => void;
}

/**
 * 2D SVG fallback map that renders when WebGL is unavailable.
 * Shows all SDR stations as dots on an equirectangular world map projection.
 */
export default function FallbackMap({
  stations,
  isStationOnline,
  onSelectStation,
}: FallbackMapProps) {
  const [visible, setVisible] = useState(getRenderMode() === "fallback");
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    station: Station;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Listen for render mode changes
  useEffect(() => {
    const cleanup = onRenderModeChange((detail) => {
      setVisible(detail.mode === "fallback");
    });
    return cleanup;
  }, []);

  const clusters = useMemo(
    () => clusterStations(stations, isStationOnline),
    [stations, isStationOnline]
  );

  const handleDotHover = useCallback(
    (e: React.MouseEvent, cluster: ClusteredStation) => {
      const station = cluster.stations[0];
      setTooltip({
        x: e.clientX,
        y: e.clientY,
        station,
      });
    },
    []
  );

  const handleDotLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const handleDotClick = useCallback(
    (cluster: ClusteredStation) => {
      if (cluster.stations.length === 1 && onSelectStation) {
        onSelectStation(cluster.stations[0]);
      }
    },
    [onSelectStation]
  );

  if (!visible) return null;

  // Map dimensions (match the viewport)
  const MAP_W = 960;
  const MAP_H = 480;

  return (
    <div
      className="absolute inset-0 z-[6] bg-[#0a0e14]"
      style={{ contain: "layout paint" }}
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
      </div>

      {/* SVG Map */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
        style={{ paddingTop: "32px" }}
      >
        {/* Background */}
        <rect width={MAP_W} height={MAP_H} fill="#0a0e14" />

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

        {/* Simplified continent outlines */}
        <path
          d={WORLD_MAP_PATH}
          fill="none"
          stroke="rgba(100,180,200,0.15)"
          strokeWidth={0.5}
          transform={`scale(${MAP_W / 360},${MAP_H / 180}) translate(180,90)`}
        />

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
          return (
            <g key={i}>
              {/* Glow */}
              <circle
                cx={x}
                cy={y}
                r={cluster.radius * 2}
                fill={cluster.color}
                opacity={0.1}
              />
              {/* Dot */}
              <circle
                cx={x}
                cy={y}
                r={cluster.radius}
                fill={cluster.color}
                opacity={0.8}
                stroke={cluster.color}
                strokeWidth={0.5}
                strokeOpacity={0.5}
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) => handleDotHover(e, cluster)}
                onMouseLeave={handleDotLeave}
                onClick={() => handleDotClick(cluster)}
              />
              {/* Cluster count badge */}
              {isMulti && cluster.stations.length > 2 && (
                <text
                  x={x}
                  y={y + 0.5}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontSize={cluster.radius < 4 ? 4 : 5}
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
          className="fixed z-50 px-3 py-2 rounded-lg bg-black/90 border border-white/15 backdrop-blur-sm pointer-events-none"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y - 8,
            maxWidth: 280,
          }}
        >
          <div className="text-xs font-semibold text-white/90 truncate">
            {tooltip.station.label}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{
                backgroundColor:
                  TYPE_COLORS[tooltip.station.receivers[0]?.type] || "#888",
              }}
            />
            <span className="text-[10px] text-white/60">
              {tooltip.station.receivers[0]?.type || "Unknown"}
            </span>
            <span className="text-[10px] text-white/40">
              {tooltip.station.receivers.length} receiver
              {tooltip.station.receivers.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="text-[9px] text-white/30 mt-1 font-mono">
            {tooltip.station.location.coordinates[1].toFixed(2)},{" "}
            {tooltip.station.location.coordinates[0].toFixed(2)}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-4 px-3 py-2 rounded-lg bg-black/50 border border-white/10">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-[10px] font-mono text-white/50">{type}</span>
          </div>
        ))}
      </div>

      {/* Station count */}
      <div className="absolute bottom-4 left-4 z-10 px-3 py-1.5 rounded-lg bg-black/50 border border-white/10">
        <span className="text-[10px] font-mono text-white/50">
          {stations.length} stations
        </span>
      </div>
    </div>
  );
}
