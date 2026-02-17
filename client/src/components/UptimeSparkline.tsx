/**
 * UptimeSparkline.tsx — SVG-based sparkline showing receiver uptime history
 *
 * Displays a compact horizontal bar chart where each segment represents
 * a status check result: green = online, red = offline, gray = no data.
 * Also shows uptime percentage and time range labels.
 *
 * Uses the uptime.receiverHistory tRPC endpoint to fetch real data.
 */
import { trpc } from "@/lib/trpc";
import { useMemo } from "react";

interface UptimeSparklineProps {
  receiverUrl: string;
  hoursBack?: number;
  /** Compact mode: just the bar, no labels */
  compact?: boolean;
}

/** Bucket a list of history entries into evenly-spaced time slots */
function bucketize(
  history: { online: boolean; checkedAt: number }[],
  hoursBack: number,
  bucketCount: number
): (boolean | null)[] {
  if (history.length === 0) return new Array(bucketCount).fill(null);

  const now = Date.now();
  const start = now - hoursBack * 60 * 60 * 1000;
  const bucketWidth = (hoursBack * 60 * 60 * 1000) / bucketCount;

  const buckets: (boolean | null)[] = new Array(bucketCount).fill(null);

  for (const entry of history) {
    const idx = Math.floor((entry.checkedAt - start) / bucketWidth);
    if (idx >= 0 && idx < bucketCount) {
      // If any check in this bucket was online, mark it online
      // If all checks were offline, mark it offline
      if (buckets[idx] === null) {
        buckets[idx] = entry.online;
      } else if (entry.online) {
        buckets[idx] = true;
      }
    }
  }

  return buckets;
}

export default function UptimeSparkline({
  receiverUrl,
  hoursBack = 24,
  compact = false,
}: UptimeSparklineProps) {
  const { data: history, isLoading } = trpc.uptime.receiverHistory.useQuery(
    { receiverUrl, hoursBack },
    {
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchInterval: 5 * 60 * 1000,
    }
  );

  const BUCKET_COUNT = compact ? 24 : 48;

  const buckets = useMemo(() => {
    if (!history || history.length === 0) return null;
    return bucketize(history, hoursBack, BUCKET_COUNT);
  }, [history, hoursBack, BUCKET_COUNT]);

  const uptimePercent = useMemo(() => {
    if (!history || history.length === 0) return null;
    const onlineCount = history.filter((h) => h.online).length;
    return Math.round((onlineCount / history.length) * 100);
  }, [history]);

  const totalChecks = history?.length ?? 0;

  // No data yet — show placeholder
  if (isLoading) {
    return (
      <div className={`${compact ? "h-3" : "h-8"} flex items-center`}>
        <div className="w-full h-2 bg-white/5 rounded-full animate-pulse" />
      </div>
    );
  }

  // No history data available
  if (!buckets || totalChecks === 0) {
    return (
      <div className={`${compact ? "" : "py-1"}`}>
        <div className="flex items-center gap-2">
          <svg
            width="100%"
            height={compact ? 6 : 10}
            viewBox={`0 0 ${BUCKET_COUNT} 1`}
            preserveAspectRatio="none"
            className="rounded-sm overflow-hidden"
          >
            {Array.from({ length: BUCKET_COUNT }).map((_, i) => (
              <rect
                key={i}
                x={i}
                y={0}
                width={0.9}
                height={1}
                rx={0.1}
                fill="rgba(255,255,255,0.05)"
              />
            ))}
          </svg>
          {!compact && (
            <span className="text-[9px] font-mono text-muted-foreground/40 shrink-0 w-16 text-right">
              No data
            </span>
          )}
        </div>
      </div>
    );
  }

  // Color mapping
  const getColor = (val: boolean | null): string => {
    if (val === null) return "rgba(255,255,255,0.05)";
    return val ? "rgba(34,197,94,0.7)" : "rgba(239,68,68,0.6)";
  };

  const getHoverColor = (val: boolean | null): string => {
    if (val === null) return "rgba(255,255,255,0.1)";
    return val ? "rgba(34,197,94,1)" : "rgba(239,68,68,1)";
  };

  // Uptime color
  const uptimeColor =
    uptimePercent === null
      ? "text-muted-foreground/40"
      : uptimePercent >= 90
        ? "text-green-400"
        : uptimePercent >= 50
          ? "text-yellow-400"
          : "text-red-400";

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <svg
          width="100%"
          height={6}
          viewBox={`0 0 ${BUCKET_COUNT} 1`}
          preserveAspectRatio="none"
          className="rounded-sm overflow-hidden flex-1"
        >
          {buckets.map((val, i) => (
            <rect
              key={i}
              x={i}
              y={0}
              width={0.85}
              height={1}
              rx={0.1}
              fill={getColor(val)}
            />
          ))}
        </svg>
        {uptimePercent !== null && (
          <span className={`text-[8px] font-mono ${uptimeColor} shrink-0`}>
            {uptimePercent}%
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="py-1 space-y-1">
      {/* Header: label + uptime % */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wider">
          {hoursBack}h Uptime
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-muted-foreground/40">
            {totalChecks} check{totalChecks !== 1 ? "s" : ""}
          </span>
          {uptimePercent !== null && (
            <span className={`text-[10px] font-mono font-semibold ${uptimeColor}`}>
              {uptimePercent}%
            </span>
          )}
        </div>
      </div>

      {/* Sparkline bar */}
      <svg
        width="100%"
        height={10}
        viewBox={`0 0 ${BUCKET_COUNT} 1`}
        preserveAspectRatio="none"
        className="rounded-sm overflow-hidden"
      >
        {buckets.map((val, i) => (
          <rect
            key={i}
            x={i}
            y={0}
            width={0.85}
            height={1}
            rx={0.1}
            fill={getColor(val)}
          >
            <title>
              {val === null
                ? "No data"
                : val
                  ? "Online"
                  : "Offline"}
              {` — ${Math.round((i / BUCKET_COUNT) * hoursBack)}h ago`}
            </title>
          </rect>
        ))}
      </svg>

      {/* Time axis labels */}
      <div className="flex items-center justify-between">
        <span className="text-[8px] font-mono text-muted-foreground/30">
          {hoursBack}h ago
        </span>
        <span className="text-[8px] font-mono text-muted-foreground/30">
          Now
        </span>
      </div>
    </div>
  );
}
