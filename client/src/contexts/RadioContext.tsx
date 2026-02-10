import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
import type { Station, Receiver, ReceiverType, BandType } from "@/lib/types";
import { detectBands } from "@/lib/types";

interface RadioContextType {
  stations: Station[];
  loading: boolean;
  selectedStation: Station | null;
  selectedReceiver: Receiver | null;
  filterType: ReceiverType;
  filterBand: BandType;
  searchQuery: string;
  isPlaying: boolean;
  showPanel: boolean;
  hoveredStation: Station | null;
  selectStation: (station: Station | null) => void;
  selectReceiver: (receiver: Receiver | null) => void;
  setFilterType: (type: ReceiverType) => void;
  setFilterBand: (band: BandType) => void;
  setSearchQuery: (query: string) => void;
  setIsPlaying: (playing: boolean) => void;
  setShowPanel: (show: boolean) => void;
  setHoveredStation: (station: Station | null) => void;
  filteredStations: Station[];
  bandCounts: Record<BandType, number>;
  typeCounts: Record<ReceiverType, number>;
}

const RadioContext = createContext<RadioContextType | null>(null);

export function RadioProvider({ children }: { children: ReactNode }) {
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [selectedReceiver, setSelectedReceiver] = useState<Receiver | null>(null);
  const [filterType, setFilterType] = useState<ReceiverType>("all");
  const [filterBand, setFilterBand] = useState<BandType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [hoveredStation, setHoveredStation] = useState<Station | null>(null);

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

  // Compute counts for each type and band
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

  const filteredStations = useMemo(() => {
    return stations.filter((s) => {
      // Type filter
      const matchesType =
        filterType === "all" ||
        s.receivers.some((r) => r.type === filterType);

      // Band filter
      const matchesBand =
        filterBand === "all" ||
        (stationBands.get(s) || []).includes(filterBand);

      // Search filter
      const matchesSearch =
        !searchQuery ||
        s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.receivers.some((r) =>
          r.label.toLowerCase().includes(searchQuery.toLowerCase())
        );

      return matchesType && matchesBand && matchesSearch;
    });
  }, [stations, filterType, filterBand, searchQuery, stationBands]);

  return (
    <RadioContext.Provider
      value={{
        stations,
        loading,
        selectedStation,
        selectedReceiver,
        filterType,
        filterBand,
        searchQuery,
        isPlaying,
        showPanel,
        hoveredStation,
        selectStation,
        selectReceiver,
        setFilterType,
        setFilterBand,
        setSearchQuery,
        setIsPlaying,
        setShowPanel,
        setHoveredStation,
        filteredStations,
        bandCounts,
        typeCounts,
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
