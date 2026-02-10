import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { Station, Receiver, ReceiverType } from "@/lib/types";

interface RadioContextType {
  stations: Station[];
  loading: boolean;
  selectedStation: Station | null;
  selectedReceiver: Receiver | null;
  filterType: ReceiverType;
  searchQuery: string;
  isPlaying: boolean;
  showPanel: boolean;
  hoveredStation: Station | null;
  selectStation: (station: Station | null) => void;
  selectReceiver: (receiver: Receiver | null) => void;
  setFilterType: (type: ReceiverType) => void;
  setSearchQuery: (query: string) => void;
  setIsPlaying: (playing: boolean) => void;
  setShowPanel: (show: boolean) => void;
  setHoveredStation: (station: Station | null) => void;
  filteredStations: Station[];
}

const RadioContext = createContext<RadioContextType | null>(null);

export function RadioProvider({ children }: { children: ReactNode }) {
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [selectedReceiver, setSelectedReceiver] = useState<Receiver | null>(null);
  const [filterType, setFilterType] = useState<ReceiverType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [hoveredStation, setHoveredStation] = useState<Station | null>(null);

  useEffect(() => {
    async function fetchStations() {
      // Try multiple sources for station data
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

  const filteredStations = stations.filter((s) => {
    const matchesType =
      filterType === "all" ||
      s.receivers.some((r) => r.type === filterType);
    const matchesSearch =
      !searchQuery ||
      s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.receivers.some((r) =>
        r.label.toLowerCase().includes(searchQuery.toLowerCase())
      );
    return matchesType && matchesSearch;
  });

  return (
    <RadioContext.Provider
      value={{
        stations,
        loading,
        selectedStation,
        selectedReceiver,
        filterType,
        searchQuery,
        isPlaying,
        showPanel,
        hoveredStation,
        selectStation,
        selectReceiver,
        setFilterType,
        setSearchQuery,
        setIsPlaying,
        setShowPanel,
        setHoveredStation,
        filteredStations,
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
