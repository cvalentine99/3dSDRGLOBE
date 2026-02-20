import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { Station, Receiver, ReceiverType, BandType, ContinentType, RegionType } from "@/lib/types";
import { detectBands, detectContinent, detectRegion, CONTINENT_DEFINITIONS } from "@/lib/types";

// Globe rotation target — set by context, consumed by Globe component
export type GlobeTarget = { lat: number; lng: number; zoom?: number } | null;

// Unique key for a station (label + coordinates)
function stationKey(station: Station): string {
  return `${station.label}|${station.location.coordinates[0]}|${station.location.coordinates[1]}`;
}

const FAVORITES_STORAGE_KEY = "valentine-rf-favorites";

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch {
    // ignore
  }
  return new Set();
}

function saveFavorites(favs: Set<string>) {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(favs)));
  } catch {
    // ignore
  }
}

interface RadioContextType {
  stations: Station[];
  loading: boolean;
  selectedStation: Station | null;
  selectedReceiver: Receiver | null;
  filterType: ReceiverType;
  filterBand: BandType;
  filterContinent: ContinentType;
  filterRegion: RegionType;
  searchQuery: string;
  isPlaying: boolean;
  showPanel: boolean;
  hoveredStation: Station | null;
  globeTarget: GlobeTarget;
  selectStation: (station: Station | null) => void;
  selectReceiver: (receiver: Receiver | null) => void;
  setFilterType: (type: ReceiverType) => void;
  setFilterBand: (band: BandType) => void;
  setFilterContinent: (continent: ContinentType) => void;
  setFilterRegion: (region: RegionType) => void;
  setSearchQuery: (query: string) => void;
  setIsPlaying: (playing: boolean) => void;
  setShowPanel: (show: boolean) => void;
  setHoveredStation: (station: Station | null) => void;
  clearGlobeTarget: () => void;
  setGlobeTarget: (target: GlobeTarget) => void;
  filteredStations: Station[];
  bandCounts: Record<BandType, number>;
  typeCounts: Record<ReceiverType, number>;
  continentCounts: Record<ContinentType, number>;
  regionCounts: Record<RegionType, number>;
  stationContinents: Map<Station, ContinentType>;
  stationRegions: Map<Station, RegionType>;
  // Favorites
  favorites: Set<string>;
  isFavorite: (station: Station) => boolean;
  toggleFavorite: (station: Station) => void;
  favoriteCount: number;
  // Receiver highlight (from IntelChat globe actions)
  highlightedStationLabel: string | null;
  setHighlightedStationLabel: (label: string | null) => void;
  // Overlay toggles (registered by Home.tsx, consumed by IntelChat)
  overlayToggles: React.MutableRefObject<Record<string, (value?: boolean) => void>>;
  // Directory aggregation
  newStationLabels: Set<string>;
  directorySources: DirectorySourceInfo[];
  refreshDirectories: () => void;
  directoryRefreshing: boolean;
}

export interface DirectorySourceInfo {
  name: string;
  fetched: number;
  newStations: number;
  errors: string[];
}

const RadioContext = createContext<RadioContextType | null>(null);

export function RadioProvider({ children }: { children: ReactNode }) {
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [selectedReceiver, setSelectedReceiver] = useState<Receiver | null>(null);
  const [filterType, setFilterType] = useState<ReceiverType>("all");
  const [filterBand, setFilterBand] = useState<BandType>("all");
  const [filterContinent, setFilterContinentRaw] = useState<ContinentType>("all");
  const [filterRegion, setFilterRegion] = useState<RegionType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [hoveredStation, setHoveredStation] = useState<Station | null>(null);
  const [globeTarget, setGlobeTarget] = useState<GlobeTarget>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [highlightedStationLabel, setHighlightedStationLabel] = useState<string | null>(null);
  const overlayTogglesRef = useRef<Record<string, (value?: boolean) => void>>({});
  const [newStationLabels, setNewStationLabels] = useState<Set<string>>(new Set());
  const [directorySources, setDirectorySources] = useState<DirectorySourceInfo[]>([]);
  const [directoryRefreshing, setDirectoryRefreshing] = useState(false);
  const staticDataRef = useRef<Station[]>([]);

  const clearGlobeTarget = useCallback(() => setGlobeTarget(null), []);

  // Favorites helpers
  const isFavorite = useCallback(
    (station: Station) => favorites.has(stationKey(station)),
    [favorites]
  );

  const toggleFavorite = useCallback(
    (station: Station) => {
      setFavorites((prev) => {
        const next = new Set(prev);
        const key = stationKey(station);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        saveFavorites(next);
        return next;
      });
    },
    []
  );

  const favoriteCount = useMemo(() => favorites.size, [favorites]);

  // When continent changes, reset region and rotate globe
  const setFilterContinent = useCallback((continent: ContinentType) => {
    setFilterContinentRaw(continent);
    setFilterRegion("all");
    if (continent === "all") {
      setGlobeTarget({ lat: 20, lng: 0, zoom: 1 });
    } else {
      const def = CONTINENT_DEFINITIONS.find((c) => c.id === continent);
      if (def) {
        setGlobeTarget({ lat: def.center.lat, lng: def.center.lng, zoom: def.zoom });
      }
    }
  }, []);

  // Shared function to fetch directory aggregation and update state
  const fetchDirectoryAggregation = useCallback(async (baseStations: Station[], isRefresh = false) => {
    if (isRefresh) setDirectoryRefreshing(true);
    try {
      // If refreshing, clear the server cache first
      if (isRefresh) {
        await fetch("/api/trpc/receiver.clearDirectoryCache", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ json: {} }),
        });
      }

      const res = await fetch("/api/trpc/receiver.aggregateDirectories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          json: {
            existingStations: baseStations.map((s) => ({
              label: s.label,
              location: s.location,
              receivers: s.receivers.map((r) => ({
                label: r.label,
                url: r.url,
                type: r.type,
                version: r.version,
              })),
            })),
          },
        }),
      });
      if (res.ok) {
        const body = await res.json();
        const result = body?.result?.data?.json;
        if (result?.stations && result.stations.length > baseStations.length) {
          const staticLabels = new Set(baseStations.map((s) => s.label));
          const merged: Station[] = result.stations.map((s: any) => ({
            label: s.label,
            location: s.location,
            receivers: s.receivers.map((r: any) => ({
              label: r.label,
              url: r.url,
              type: r.type,
              version: r.version,
            })),
          }));
          setStations(merged);

          // Track which stations are new (not in static data)
          const newLabels = new Set<string>();
          merged.forEach((s) => {
            if (!staticLabels.has(s.label)) newLabels.add(s.label);
          });
          setNewStationLabels(newLabels);

          // Track directory source info
          if (result.sources) {
            setDirectorySources(
              result.sources.map((src: any) => ({
                name: src.name,
                fetched: src.fetched,
                newStations: src.newStations,
                errors: src.errors || [],
              }))
            );
          }

          console.log(
            `[RadioContext] Directory aggregation: ${baseStations.length} \u2192 ${merged.length} stations (+${result.totalNew} new)`
          );
        } else if (result?.sources) {
          // Even if no new stations, update source info
          setDirectorySources(
            result.sources.map((src: any) => ({
              name: src.name,
              fetched: src.fetched,
              newStations: src.newStations,
              errors: src.errors || [],
            }))
          );
        }
      }
    } catch (err) {
      console.warn("[RadioContext] Directory aggregation failed:", err);
    } finally {
      if (isRefresh) setDirectoryRefreshing(false);
    }
  }, []);

  const refreshDirectories = useCallback(() => {
    if (staticDataRef.current.length > 0) {
      fetchDirectoryAggregation(staticDataRef.current, true);
    }
  }, [fetchDirectoryAggregation]);

  useEffect(() => {
    async function fetchStations() {
      const sources = [
        "/stations.json",
        "https://files.manuscdn.com/user_upload_by_module/session_file/310519663252172531/hiMtJaBqMSSztryK.json",
      ];

      let staticData: Station[] = [];
      for (const url of sources) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
              staticData = data;
              staticDataRef.current = data;
              setStations(data);
              setLoading(false);
              break;
            }
          }
        } catch {
          // Try next source
        }
      }

      if (staticData.length === 0) {
        console.error("Failed to fetch stations from all sources");
        setLoading(false);
        return;
      }

      // After showing static data, fetch additional receivers from directory aggregator
      fetchDirectoryAggregation(staticData);
    }
    fetchStations();
  }, [fetchDirectoryAggregation]);

  const selectStation = useCallback((station: Station | null) => {
    setSelectedStation(station);
    if (station) {
      setShowPanel(true);
      setSelectedReceiver(station.receivers[0] || null);
    } else {
      setSelectedReceiver(null);
      setShowPanel(false);
    }
  }, []);

  const selectReceiver = useCallback((receiver: Receiver | null) => {
    setSelectedReceiver(receiver);
    setIsPlaying(false);
  }, []);

  // Pre-compute band info for all stations
  const stationBands = useMemo(() => {
    const map = new Map<Station, BandType[]>();
    stations.forEach((s) => {
      map.set(s, detectBands(s));
    });
    return map;
  }, [stations]);

  // Pre-compute continent/region for all stations
  const stationContinents = useMemo(() => {
    const map = new Map<Station, ContinentType>();
    stations.forEach((s) => {
      const [lng, lat] = s.location.coordinates;
      map.set(s, detectContinent(lat, lng));
    });
    return map;
  }, [stations]);

  const stationRegions = useMemo(() => {
    const map = new Map<Station, RegionType>();
    stations.forEach((s) => {
      const [lng, lat] = s.location.coordinates;
      map.set(s, detectRegion(lat, lng));
    });
    return map;
  }, [stations]);

  // Compute counts
  const typeCounts = useMemo(() => {
    const counts: Record<ReceiverType, number> = {
      all: stations.length,
      KiwiSDR: 0,
      OpenWebRX: 0,
      WebSDR: 0,
    };
    stations.forEach((s) => {
      const types = new Set(s.receivers.map((r) => r.type));
      if (types.has("KiwiSDR")) counts.KiwiSDR++;
      if (types.has("OpenWebRX")) counts.OpenWebRX++;
      if (types.has("WebSDR")) counts.WebSDR++;
    });
    return counts;
  }, [stations]);

  const bandCounts = useMemo(() => {
    const counts: Record<BandType, number> = {
      all: stations.length,
      HF: 0,
      VHF: 0,
      UHF: 0,
      "LF/MF": 0,
      Airband: 0,
      CB: 0,
    };
    stations.forEach((s) => {
      const bands = stationBands.get(s) || [];
      bands.forEach((b) => {
        counts[b]++;
      });
    });
    return counts;
  }, [stations, stationBands]);

  const continentCounts = useMemo(() => {
    const counts = { all: stations.length } as Record<ContinentType, number>;
    CONTINENT_DEFINITIONS.forEach((c) => {
      counts[c.id] = 0;
    });
    stations.forEach((s) => {
      const c = stationContinents.get(s);
      if (c && c !== "all") counts[c]++;
    });
    return counts;
  }, [stations, stationContinents]);

  const regionCounts = useMemo(() => {
    const counts = { all: stations.length } as Record<RegionType, number>;
    CONTINENT_DEFINITIONS.forEach((c) => {
      c.regions.forEach((r) => {
        counts[r.id] = 0;
      });
    });
    stations.forEach((s) => {
      const r = stationRegions.get(s);
      if (r && r !== "all") counts[r] = (counts[r] || 0) + 1;
    });
    return counts;
  }, [stations, stationRegions]);

  const filteredStations = useMemo(() => {
    return stations.filter((s) => {
      const matchesType =
        filterType === "all" ||
        s.receivers.some((r) => r.type === filterType);

      const matchesBand =
        filterBand === "all" ||
        (stationBands.get(s) || []).includes(filterBand);

      const matchesContinent =
        filterContinent === "all" ||
        stationContinents.get(s) === filterContinent;

      const matchesRegion =
        filterRegion === "all" ||
        stationRegions.get(s) === filterRegion;

      const matchesSearch =
        !searchQuery ||
        s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.receivers.some((r) =>
          r.label.toLowerCase().includes(searchQuery.toLowerCase())
        );

      return matchesType && matchesBand && matchesContinent && matchesRegion && matchesSearch;
    });
  }, [stations, filterType, filterBand, filterContinent, filterRegion, searchQuery, stationBands, stationContinents, stationRegions]);

  return (
    <RadioContext.Provider
      value={{
        stations,
        loading,
        selectedStation,
        selectedReceiver,
        filterType,
        filterBand,
        filterContinent,
        filterRegion,
        searchQuery,
        isPlaying,
        showPanel,
        hoveredStation,
        globeTarget,
        selectStation,
        selectReceiver,
        setFilterType,
        setFilterBand,
        setFilterContinent,
        setFilterRegion,
        setSearchQuery,
        setIsPlaying,
        setShowPanel,
        setHoveredStation,
        clearGlobeTarget,
        setGlobeTarget,
        filteredStations,
        bandCounts,
        typeCounts,
        continentCounts,
        regionCounts,
        stationContinents,
        stationRegions,
        favorites,
        isFavorite,
        toggleFavorite,
        favoriteCount,
        highlightedStationLabel,
        setHighlightedStationLabel,
        overlayToggles: overlayTogglesRef,
        newStationLabels,
        directorySources,
        refreshDirectories,
        directoryRefreshing,
      }}
    >
      {children}
    </RadioContext.Provider>
  );
}

export function useRadio() {
  const ctx = useContext(RadioContext);
  if (!ctx) throw new Error("useRadio must be used within RadioProvider");
  return ctx;
}
