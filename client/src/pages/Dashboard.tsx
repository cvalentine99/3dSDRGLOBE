/**
 * Dashboard.tsx — Analytics dashboard for Valentine RF - SigINT
 * Shows summary stats, category distribution, anomaly trends,
 * job activity, top fingerprints, and recent activity feed.
 * Optimized for ultrawide monitors with responsive grid layout.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";
import {
  Crosshair,
  Target,
  Radio,
  AlertTriangle,
  Fingerprint,
  Users,
  Activity,
  ArrowLeft,
  Wifi,
  WifiOff,
  Radar,
  Clock,
  TrendingUp,
  BarChart3,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ── Category color map ── */
const CATEGORY_COLORS: Record<string, string> = {
  time_signal: "#f59e0b",
  broadcast: "#3b82f6",
  utility: "#8b5cf6",
  military: "#ef4444",
  amateur: "#22c55e",
  maritime: "#06b6d4",
  aviation: "#f97316",
  numbers: "#ec4899",
  unknown: "#6b7280",
  other: "#a3a3a3",
  custom: "#14b8a6",
};

const CATEGORY_LABELS: Record<string, string> = {
  time_signal: "Time Signal",
  broadcast: "Broadcast",
  utility: "Utility",
  military: "Military",
  amateur: "Amateur",
  maritime: "Maritime",
  aviation: "Aviation",
  numbers: "Numbers",
  unknown: "Unknown",
  other: "Other",
  custom: "Custom",
};

/* ── Activity type icons ── */
const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  job: <Crosshair className="w-3.5 h-3.5 text-cyan-400" />,
  anomaly: <AlertTriangle className="w-3.5 h-3.5 text-red-400" />,
  target: <Target className="w-3.5 h-3.5 text-amber-400" />,
  recording: <Radio className="w-3.5 h-3.5 text-green-400" />,
  fingerprint: <Fingerprint className="w-3.5 h-3.5 text-purple-400" />,
};

const ACTIVITY_COLORS: Record<string, string> = {
  job: "border-cyan-500/30 bg-cyan-500/5",
  anomaly: "border-red-500/30 bg-red-500/5",
  target: "border-amber-500/30 bg-amber-500/5",
  recording: "border-green-500/30 bg-green-500/5",
  fingerprint: "border-purple-500/30 bg-purple-500/5",
};

export default function Dashboard() {
  const [trendDays, setTrendDays] = useState(30);

  const { data: summary, isLoading: summaryLoading } =
    trpc.analytics.summary.useQuery();
  const { data: targetsByCategory, isLoading: catLoading } =
    trpc.analytics.targetsByCategory.useQuery();
  const { data: anomalyTrend, isLoading: anomalyTrendLoading } =
    trpc.analytics.anomalyTrend.useQuery({ days: trendDays });
  const { data: jobTrend, isLoading: jobTrendLoading } =
    trpc.analytics.jobTrend.useQuery({ days: trendDays });
  const { data: topFingerprints, isLoading: fpLoading } =
    trpc.analytics.topFingerprints.useQuery({ limit: 10 });
  const { data: recentActivity, isLoading: activityLoading } =
    trpc.analytics.recentActivity.useQuery({ limit: 25 });
  const { data: receiverStats, isLoading: receiverLoading } =
    trpc.analytics.receiverStats.useQuery();

  /* ── Chart configs ── */
  const anomalyChartConfig: ChartConfig = {
    low: { label: "Low", color: "oklch(0.7 0.15 150)" },
    medium: { label: "Medium", color: "oklch(0.7 0.15 60)" },
    high: { label: "High", color: "oklch(0.65 0.22 25)" },
  };

  const jobChartConfig: ChartConfig = {
    complete: { label: "Complete", color: "oklch(0.78 0.15 195)" },
    error: { label: "Error", color: "oklch(0.65 0.22 25)" },
    pending: { label: "Pending", color: "oklch(0.7 0.02 260)" },
  };

  /* ── Pie chart data ── */
  const pieData = useMemo(() => {
    if (!targetsByCategory) return [];
    return targetsByCategory.map((item) => ({
      name: CATEGORY_LABELS[item.category] ?? item.category,
      value: item.count,
      color: CATEGORY_COLORS[item.category] ?? "#6b7280",
    }));
  }, [targetsByCategory]);

  /* ── Receiver pie data ── */
  const receiverPieData = useMemo(() => {
    if (!receiverStats) return [];
    return receiverStats.byType.map((item) => ({
      name: item.type,
      value: item.count,
      color:
        item.type === "KiwiSDR"
          ? "#22c55e"
          : item.type === "OpenWebRX"
            ? "#3b82f6"
            : "#f59e0b",
    }));
  }, [receiverStats]);

  const isLoading =
    summaryLoading ||
    catLoading ||
    anomalyTrendLoading ||
    jobTrendLoading ||
    fpLoading ||
    activityLoading ||
    receiverLoading;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Header ── */}
      <div className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="max-w-[2400px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="w-4 h-4" />
                Globe
              </Button>
            </Link>
            <div className="h-5 w-px bg-border/50" />
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              <h1 className="text-lg font-semibold tracking-tight">
                Analytics Dashboard
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">
              Trend period:
            </span>
            <Select
              value={String(trendDays)}
              onValueChange={(v) => setTrendDays(Number(v))}
            >
              <SelectTrigger className="w-[100px] h-8 text-xs bg-secondary/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="14">14 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="60">60 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="max-w-[2400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* ── Summary stat cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
          <StatCard
            title="Targets"
            value={summary?.totalTargets ?? 0}
            icon={<Target className="w-4 h-4" />}
            color="text-amber-400"
            loading={summaryLoading}
          />
          <StatCard
            title="TDoA Jobs"
            value={summary?.totalJobs ?? 0}
            subtitle={`${summary?.completedJobs ?? 0} complete`}
            icon={<Crosshair className="w-4 h-4" />}
            color="text-cyan-400"
            loading={summaryLoading}
          />
          <StatCard
            title="Receivers"
            value={summary?.receiversTotal ?? 0}
            subtitle={`${summary?.receiversOnline ?? 0} online`}
            icon={<Wifi className="w-4 h-4" />}
            color="text-green-400"
            loading={summaryLoading}
          />
          <StatCard
            title="Recordings"
            value={summary?.totalRecordings ?? 0}
            icon={<Radio className="w-4 h-4" />}
            color="text-blue-400"
            loading={summaryLoading}
          />
          <StatCard
            title="Fingerprints"
            value={summary?.totalFingerprints ?? 0}
            icon={<Fingerprint className="w-4 h-4" />}
            color="text-purple-400"
            loading={summaryLoading}
          />
          <StatCard
            title="Anomalies"
            value={summary?.activeAnomalies ?? 0}
            subtitle={`${summary?.totalAnomalies ?? 0} total`}
            icon={<AlertTriangle className="w-4 h-4" />}
            color="text-red-400"
            loading={summaryLoading}
          />
          <StatCard
            title="Shared Lists"
            value={summary?.sharedLists ?? 0}
            icon={<Users className="w-4 h-4" />}
            color="text-teal-400"
            loading={summaryLoading}
          />
          <StatCard
            title="Members"
            value={summary?.totalMembers ?? 0}
            icon={<Users className="w-4 h-4" />}
            color="text-indigo-400"
            loading={summaryLoading}
          />
        </div>

        {/* ── Charts row 1: Job trend + Anomaly trend ── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Job Activity Trend */}
          <Card className="bg-card/60 backdrop-blur border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                TDoA Job Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {jobTrendLoading ? (
                <LoadingPlaceholder height="h-[260px]" />
              ) : (
                <ChartContainer
                  config={jobChartConfig}
                  className="h-[260px] w-full"
                >
                  <AreaChart data={jobTrend ?? []}>
                    <defs>
                      <linearGradient
                        id="fillComplete"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="var(--color-complete)"
                          stopOpacity={0.4}
                        />
                        <stop
                          offset="95%"
                          stopColor="var(--color-complete)"
                          stopOpacity={0}
                        />
                      </linearGradient>
                      <linearGradient
                        id="fillError"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="var(--color-error)"
                          stopOpacity={0.4}
                        />
                        <stop
                          offset="95%"
                          stopColor="var(--color-error)"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="oklch(0.25 0.02 260 / 30%)"
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => v.slice(5)}
                      stroke="oklch(0.5 0.02 260)"
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      stroke="oklch(0.5 0.02 260)"
                      allowDecimals={false}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="complete"
                      stackId="1"
                      stroke="var(--color-complete)"
                      fill="url(#fillComplete)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="error"
                      stackId="1"
                      stroke="var(--color-error)"
                      fill="url(#fillError)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {/* Anomaly Trend */}
          <Card className="bg-card/60 backdrop-blur border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                Anomaly Frequency
              </CardTitle>
            </CardHeader>
            <CardContent>
              {anomalyTrendLoading ? (
                <LoadingPlaceholder height="h-[260px]" />
              ) : (
                <ChartContainer
                  config={anomalyChartConfig}
                  className="h-[260px] w-full"
                >
                  <BarChart data={anomalyTrend ?? []}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="oklch(0.25 0.02 260 / 30%)"
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => v.slice(5)}
                      stroke="oklch(0.5 0.02 260)"
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      stroke="oklch(0.5 0.02 260)"
                      allowDecimals={false}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="high"
                      stackId="a"
                      fill="var(--color-high)"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="medium"
                      stackId="a"
                      fill="var(--color-medium)"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="low"
                      stackId="a"
                      fill="var(--color-low)"
                      radius={[2, 2, 0, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Charts row 2: Category pie + Receiver pie + Top fingerprints ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {/* Target Categories */}
          <Card className="bg-card/60 backdrop-blur border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Target className="w-4 h-4 text-amber-400" />
                Targets by Category
              </CardTitle>
            </CardHeader>
            <CardContent>
              {catLoading ? (
                <LoadingPlaceholder height="h-[240px]" />
              ) : pieData.length === 0 ? (
                <EmptyState text="No targets yet" height="h-[240px]" />
              ) : (
                <div className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                        stroke="none"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload;
                          return (
                            <div className="bg-popover text-popover-foreground border border-border rounded-md px-3 py-2 text-xs shadow-lg">
                              <div className="font-medium">{d.name}</div>
                              <div className="text-muted-foreground">
                                {d.value} target{d.value !== 1 ? "s" : ""}
                              </div>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-2 justify-center -mt-2">
                    {pieData.map((item) => (
                      <div
                        key={item.name}
                        className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                      >
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        {item.name}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Receiver Breakdown */}
          <Card className="bg-card/60 backdrop-blur border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Radar className="w-4 h-4 text-green-400" />
                Receiver Network
              </CardTitle>
            </CardHeader>
            <CardContent>
              {receiverLoading ? (
                <LoadingPlaceholder height="h-[240px]" />
              ) : (
                <div className="space-y-4">
                  {/* Online/Offline bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Wifi className="w-3 h-3 text-green-400" />
                        Online: {receiverStats?.byStatus.online ?? 0}
                      </span>
                      <span className="flex items-center gap-1">
                        <WifiOff className="w-3 h-3 text-red-400" />
                        Offline: {receiverStats?.byStatus.offline ?? 0}
                      </span>
                    </div>
                    <div className="h-3 rounded-full bg-secondary/50 overflow-hidden flex">
                      {receiverStats &&
                        (receiverStats.byStatus.online +
                          receiverStats.byStatus.offline) >
                          0 && (
                          <>
                            <div
                              className="h-full bg-green-500/70 transition-all duration-500"
                              style={{
                                width: `${(receiverStats.byStatus.online / (receiverStats.byStatus.online + receiverStats.byStatus.offline)) * 100}%`,
                              }}
                            />
                            <div
                              className="h-full bg-red-500/40 transition-all duration-500"
                              style={{
                                width: `${(receiverStats.byStatus.offline / (receiverStats.byStatus.online + receiverStats.byStatus.offline)) * 100}%`,
                              }}
                            />
                          </>
                        )}
                    </div>
                  </div>

                  {/* By type */}
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground font-medium">
                      By Type
                    </div>
                    {receiverPieData.length === 0 ? (
                      <div className="text-xs text-muted-foreground/60 text-center py-4">
                        No receivers scanned
                      </div>
                    ) : (
                      <div className="h-[160px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={receiverPieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={40}
                              outerRadius={65}
                              paddingAngle={2}
                              dataKey="value"
                              stroke="none"
                            >
                              {receiverPieData.map((entry, index) => (
                                <Cell
                                  key={`rcell-${index}`}
                                  fill={entry.color}
                                />
                              ))}
                            </Pie>
                            <Tooltip
                              content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const d = payload[0].payload;
                                return (
                                  <div className="bg-popover text-popover-foreground border border-border rounded-md px-3 py-2 text-xs shadow-lg">
                                    <div className="font-medium">{d.name}</div>
                                    <div className="text-muted-foreground">
                                      {d.value} receiver
                                      {d.value !== 1 ? "s" : ""}
                                    </div>
                                  </div>
                                );
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="flex flex-wrap gap-2 justify-center -mt-2">
                          {receiverPieData.map((item) => (
                            <div
                              key={item.name}
                              className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                            >
                              <div
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: item.color }}
                              />
                              {item.name}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Fingerprints */}
          <Card className="bg-card/60 backdrop-blur border-border/50 lg:col-span-1 xl:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Fingerprint className="w-4 h-4 text-purple-400" />
                Top Fingerprinted Targets
              </CardTitle>
            </CardHeader>
            <CardContent>
              {fpLoading ? (
                <LoadingPlaceholder height="h-[240px]" />
              ) : !topFingerprints || topFingerprints.length === 0 ? (
                <EmptyState
                  text="No fingerprints extracted yet"
                  height="h-[240px]"
                />
              ) : (
                <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1 custom-scrollbar">
                  {topFingerprints.map((fp, i) => (
                    <div
                      key={fp.targetId}
                      className="flex items-center gap-3 px-3 py-2 rounded-md bg-secondary/30 hover:bg-secondary/50 transition-colors"
                    >
                      <span className="text-xs font-mono text-muted-foreground w-5 text-right">
                        {i + 1}.
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">
                          {fp.label}
                        </div>
                        <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className="text-[9px] px-1 py-0"
                            style={{
                              borderColor:
                                CATEGORY_COLORS[fp.category] ?? "#6b7280",
                              color:
                                CATEGORY_COLORS[fp.category] ?? "#6b7280",
                            }}
                          >
                            {CATEGORY_LABELS[fp.category] ?? fp.category}
                          </Badge>
                          {fp.frequencyKhz && (
                            <span>{fp.frequencyKhz} kHz</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold font-mono text-purple-400">
                          {fp.fingerprintCount}
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          prints
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Activity feed ── */}
        <Card className="bg-card/60 backdrop-blur border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <LoadingPlaceholder height="h-[200px]" />
            ) : !recentActivity || recentActivity.length === 0 ? (
              <EmptyState
                text="No activity recorded yet"
                height="h-[200px]"
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
                {recentActivity.map((item, i) => (
                  <motion.div
                    key={`${item.type}-${item.id}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className={`flex items-start gap-2.5 px-3 py-2.5 rounded-md border transition-colors ${ACTIVITY_COLORS[item.type] ?? "border-border/30 bg-secondary/20"}`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {ACTIVITY_ICONS[item.type]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">
                        {item.label}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {item.detail}
                      </div>
                    </div>
                    <div className="text-[9px] text-muted-foreground/60 shrink-0 tabular-nums">
                      {formatRelativeTime(item.timestamp)}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function StatCard({
  title,
  value,
  subtitle,
  icon,
  color,
  loading,
}: {
  title: string;
  value: number;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
  loading: boolean;
}) {
  return (
    <Card className="bg-card/60 backdrop-blur border-border/50 hover:border-border/80 transition-colors">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            {title}
          </span>
          <span className={color}>{icon}</span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="text-2xl font-bold font-mono tabular-nums">
              {value.toLocaleString()}
            </div>
            {subtitle && (
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {subtitle}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingPlaceholder({ height }: { height: string }) {
  return (
    <div
      className={`${height} flex items-center justify-center text-muted-foreground`}
    >
      <Loader2 className="w-5 h-5 animate-spin" />
    </div>
  );
}

function EmptyState({ text, height }: { text: string; height: string }) {
  return (
    <div
      className={`${height} flex flex-col items-center justify-center text-muted-foreground/60`}
    >
      <BarChart3 className="w-8 h-8 mb-2 opacity-40" />
      <span className="text-xs">{text}</span>
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
