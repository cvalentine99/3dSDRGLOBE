/**
 * useReceiverStatusMap — Hook that triggers batch pre-check on load
 * and polls for results, exposing a Map<normalizedUrl, online> for
 * the Globe component to color dots green/red.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import type { Station } from "@/lib/types";

export interface ReceiverStatusEntry {
  online: boolean;
  checkedAt: number;
}

// Normalize URL to match backend cache keys
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function useReceiverStatusMap(stations: Station[], loading: boolean) {
  const [statusMap, setStatusMap] = useState<Map<string, ReceiverStatusEntry>>(new Map());
  const [progress, setProgress] = useState({ checked: 0, total: 0, running: false });
  const jobStartedRef = useRef(false);
  const pollSinceRef = useRef(0);

  const startMutation = trpc.receiver.startBatchPrecheck.useMutation();

  // Poll for incremental results
  const pollQuery = trpc.receiver.batchPrecheckSince.useQuery(
    { since: pollSinceRef.current },
    {
      enabled: progress.running || (jobStartedRef.current && progress.checked < progress.total),
      refetchInterval: 2000, // Poll every 2 seconds
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

    const { results, checked, total, running } = pollQuery.data;

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
    getStatus,
    isStationOnline,
  };
}
