/**
 * useReceiverStatusMap — Hook that triggers batch pre-check on load
 * and polls for results, exposing a Map<normalizedUrl, online> for
 * the Globe component to color dots green/red.
 *
 * Also handles auto-refresh: when the server starts a new 30-min cycle,
 * this hook detects the new results and updates the globe automatically.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import type { Station } from "@/lib/types";

export interface ReceiverStatusEntry {
  online: boolean;
  checkedAt: number;
}

export interface AutoRefreshInfo {
  active: boolean;
  cycleCount: number;
  nextRefreshAt: number | null;
  lastRefreshCompletedAt: number | null;
}

// Normalize URL to match backend cache keys
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function useReceiverStatusMap(stations: Station[], loading: boolean) {
  const [statusMap, setStatusMap] = useState<Map<string, ReceiverStatusEntry>>(new Map());
  const [progress, setProgress] = useState({ checked: 0, total: 0, running: false });
  const [autoRefresh, setAutoRefresh] = useState<AutoRefreshInfo>({
    active: false,
    cycleCount: 0,
    nextRefreshAt: null,
    lastRefreshCompletedAt: null,
  });
  const jobStartedRef = useRef(false);
  const pollSinceRef = useRef(0);
  const lastCycleCountRef = useRef(0);

  const startMutation = trpc.receiver.startBatchPrecheck.useMutation();

  // Poll for incremental results — keep polling even after initial scan
  // completes so we pick up auto-refresh results
  const pollQuery = trpc.receiver.batchPrecheckSince.useQuery(
    { since: pollSinceRef.current },
    {
      enabled: jobStartedRef.current,
      // Poll every 2s while a batch is running, every 30s when idle
      // (to detect auto-refresh cycles starting)
      refetchInterval: progress.running ? 2000 : 30000,
      refetchIntervalInBackground: false,
    }
  );

  // Start the batch job once stations are loaded
  useEffect(() => {
    if (loading || stations.length === 0 || jobStartedRef.current) return;

    // Build receiver list from all stations
    const receivers: { receiverUrl: string; receiverType: "KiwiSDR" | "OpenWebRX" | "WebSDR"; stationLabel: string }[] = [];
    for (const station of stations) {
      for (const receiver of station.receivers) {
        receivers.push({
          receiverUrl: receiver.url,
          receiverType: receiver.type,
          stationLabel: station.label,
        });
      }
    }

    if (receivers.length === 0) return;

    jobStartedRef.current = true;
    pollSinceRef.current = Date.now() - 1000; // Start polling from just before now

    startMutation.mutate(
      { receivers },
      {
        onSuccess: () => {
          setProgress((prev) => ({ ...prev, running: true }));
        },
        onError: (err) => {
          console.error("[BatchPrecheck] Failed to start:", err);
          jobStartedRef.current = false;
        },
      }
    );
  }, [loading, stations]);

  // Process poll results
  useEffect(() => {
    if (!pollQuery.data) return;

    const { results, checked, total, running, autoRefresh: arStatus } = pollQuery.data;

    // Detect a new auto-refresh cycle starting
    if (arStatus && arStatus.cycleCount > lastCycleCountRef.current) {
      console.log(
        `[AutoRefresh] New cycle detected: #${arStatus.cycleCount}`
      );
      lastCycleCountRef.current = arStatus.cycleCount;
    }

    // Update auto-refresh info
    if (arStatus) {
      setAutoRefresh(arStatus);
    }

    // Merge new results into the status map
    const newEntries = Object.entries(results);
    if (newEntries.length > 0) {
      setStatusMap((prev) => {
        const next = new Map(prev);
        for (const [url, entry] of newEntries) {
          next.set(url, entry);
        }
        return next;
      });

      // Update the "since" timestamp to only get new results next poll
      let maxCheckedAt = pollSinceRef.current;
      for (const [, entry] of newEntries) {
        if (entry.checkedAt > maxCheckedAt) {
          maxCheckedAt = entry.checkedAt;
        }
      }
      pollSinceRef.current = maxCheckedAt;
    }

    setProgress({ checked, total, running });
  }, [pollQuery.data]);

  // Helper to get status for a specific receiver URL
  const getStatus = useCallback(
    (receiverUrl: string): ReceiverStatusEntry | undefined => {
      return statusMap.get(normalizeUrl(receiverUrl));
    },
    [statusMap]
  );

  // Helper to check if a station has any online receiver
  const isStationOnline = useCallback(
    (station: Station): boolean | null => {
      // null means "not yet checked"
      let anyChecked = false;
      for (const receiver of station.receivers) {
        const entry = statusMap.get(normalizeUrl(receiver.url));
        if (entry) {
          anyChecked = true;
          if (entry.online) return true;
        }
      }
      return anyChecked ? false : null;
    },
    [statusMap]
  );

  return {
    statusMap,
    progress,
    autoRefresh,
    getStatus,
    isStationOnline,
  };
}
