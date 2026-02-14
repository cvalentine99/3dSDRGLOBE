import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
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

  useEffect(() => {
    async function fetchStations() {
      const sources = [
        "/stations.json",
        "https://files.manuscdn.com/user_upload_by_module/session_file/310519663252172531/hiMtJaBqMSSztryK.json",
      ];

      for (const url of sources) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
              setStations(data);
              setLoading(false);
              return;
            }
          }
        } catch {
          // Try next source
        }
      }
      console.error("Failed to fetch stations from all sources");
      setLoading(false);
    }
    fetchStations();
  }, []);

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
