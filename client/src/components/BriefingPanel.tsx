/**
 * BriefingPanel.tsx — Intelligence Briefing Panel
 *
 * Slide-over panel that displays auto-generated intelligence briefings.
 * Users can generate on-demand briefings (daily/weekly/on-demand),
 * view past briefings, and mark them as read.
 *
 * Design: "Ether" dark atmospheric style matching IntelChat.
 */

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence } from "framer-motion";
import { Streamdown } from "streamdown";
import {
  X,
  FileText,
  Loader2,
  Clock,
  ChevronDown,
  ChevronUp,
  Zap,
  Calendar,
  CalendarDays,
  Download,
  Eye,
  CheckCircle2,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────

interface Briefing {
  id: number | null;
  title: string;
  content: string;
  briefingType: string;
  stats?: Record<string, number> | null;
  dataSources?: string[] | null;
  isRead?: boolean;
  generatedAt: number;
}

// ── Component ───────────────────────────────────────────────────

export default function BriefingPanel({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [selectedBriefing, setSelectedBriefing] = useState<Briefing | null>(
    null
  );
  const [showHistory, setShowHistory] = useState(false);
  const [generatingType, setGeneratingType] = useState<string | null>(null);

  // tRPC
  const latestQuery = trpc.briefings.getLatest.useQuery(undefined, {
    enabled: isOpen,
    refetchOnWindowFocus: false,
  });
  const historyQuery = trpc.briefings.list.useQuery(
    { limit: 20 },
    {
      enabled: isOpen && showHistory,
      refetchOnWindowFocus: false,
    }
  );
  const unreadQuery = trpc.briefings.unreadCount.useQuery(undefined, {
    enabled: isOpen,
    refetchOnWindowFocus: false,
  });
  const generateMutation = trpc.briefings.generate.useMutation({
    onSuccess: (data) => {
      setSelectedBriefing(data);
      setGeneratingType(null);
      latestQuery.refetch();
      unreadQuery.refetch();
      historyQuery.refetch();
    },
    onError: () => {
      setGeneratingType(null);
    },
  });
  const markReadMutation = trpc.briefings.markRead.useMutation({
    onSuccess: () => {
      unreadQuery.refetch();
      historyQuery.refetch();
    },
  });

  const handleGenerate = useCallback(
    (type: "daily" | "weekly" | "on_demand") => {
      setGeneratingType(type);
      generateMutation.mutate({ type });
    },
    [generateMutation]
  );

  const handleSelectBriefing = useCallback(
    (briefing: Briefing) => {
      setSelectedBriefing(briefing);
      if (briefing.id && !briefing.isRead) {
        markReadMutation.mutate({ id: briefing.id });
      }
    },
    [markReadMutation]
  );

  const handleExportBriefing = useCallback((briefing: Briefing) => {
    const blob = new Blob([`# ${briefing.title}\n\n${briefing.content}`], {
      type: "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `briefing-${new Date(briefing.generatedAt).toISOString().split("T")[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const activeBriefing =
    selectedBriefing || latestQuery.data?.briefing || null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="fixed z-[9997] flex flex-col overflow-hidden rounded-xl shadow-2xl shadow-cyan-500/10"
          style={{
            top: 80,
            right: 24,
            width: "min(520px, calc(100vw - 48px))",
            height: "min(700px, calc(100vh - 120px))",
            background:
              "linear-gradient(180deg, #0a1628 0%, #060e1a 100%)",
            border: "1px solid rgba(0, 200, 255, 0.15)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            style={{
              background:
                "linear-gradient(90deg, rgba(255,180,0,0.08) 0%, rgba(0,100,200,0.05) 100%)",
              borderBottom: "1px solid rgba(255, 180, 0, 0.1)",
            }}
          >
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-amber-400" />
              <div>
                <h3 className="text-sm font-semibold text-amber-100 tracking-wide">
                  INTELLIGENCE BRIEFINGS
                </h3>
                <p className="text-[10px] text-amber-500/50 uppercase tracking-widest">
                  Auto-Generated • LLM Digest
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {unreadQuery.data && unreadQuery.data.count > 0 && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {unreadQuery.data.count} unread
                </span>
              )}
              <button
                onClick={onClose}
                className="p-1.5 rounded-md text-amber-500/50 hover:text-amber-300 hover:bg-amber-400/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Generate Buttons */}
          <div
            className="flex gap-2 px-4 py-2.5 shrink-0"
            style={{ borderBottom: "1px solid rgba(0, 200, 255, 0.06)" }}
          >
            {[
              {
                type: "on_demand" as const,
                label: "Quick Brief",
                icon: <Zap className="w-3 h-3" />,
              },
              {
                type: "daily" as const,
                label: "Daily",
                icon: <Calendar className="w-3 h-3" />,
              },
              {
                type: "weekly" as const,
                label: "Weekly",
                icon: <CalendarDays className="w-3 h-3" />,
              },
            ].map(({ type, label, icon }) => (
              <button
                key={type}
                onClick={() => handleGenerate(type)}
                disabled={generatingType !== null}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[11px] font-medium transition-all duration-150"
                style={{
                  background:
                    generatingType === type
                      ? "rgba(255, 180, 0, 0.15)"
                      : "rgba(0, 200, 255, 0.06)",
                  border: `1px solid ${
                    generatingType === type
                      ? "rgba(255, 180, 0, 0.3)"
                      : "rgba(0, 200, 255, 0.1)"
                  }`,
                  color:
                    generatingType === type
                      ? "rgb(255, 210, 100)"
                      : generatingType !== null
                      ? "rgba(100, 200, 255, 0.3)"
                      : "rgb(100, 220, 255)",
                }}
              >
                {generatingType === type ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  icon
                )}
                {label}
              </button>
            ))}
          </div>

          {/* Briefing Content */}
          <div className="flex-1 overflow-y-auto px-4 py-3 scrollbar-thin">
            {generatingType ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center"
                  style={{
                    background:
                      "radial-gradient(circle, rgba(255,180,0,0.15) 0%, transparent 70%)",
                    border: "1px solid rgba(255,180,0,0.2)",
                  }}
                >
                  <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
                </div>
                <p className="text-sm text-amber-300/60">
                  Generating intelligence briefing...
                </p>
                <p className="text-[10px] text-cyan-500/30">
                  Collecting data from all sources and synthesizing analysis
                </p>
              </div>
            ) : activeBriefing ? (
              <div>
                {/* Briefing Header */}
                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-amber-200 mb-1">
                    {activeBriefing.title}
                  </h4>
                  <div className="flex items-center gap-3 text-[10px] text-cyan-500/40">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(activeBriefing.generatedAt).toLocaleString()}
                    </span>
                    <span className="uppercase px-1.5 py-0.5 rounded text-[9px]" style={{
                      background: "rgba(0, 200, 255, 0.08)",
                      border: "1px solid rgba(0, 200, 255, 0.12)",
                    }}>
                      {activeBriefing.briefingType.replace("_", " ")}
                    </span>
                    {activeBriefing.stats && (
                      <span className="text-cyan-500/30">
                        {activeBriefing.stats.receiversOnline}/{activeBriefing.stats.receiversTotal} online
                      </span>
                    )}
                  </div>
                </div>

                {/* Stats Quick View */}
                {activeBriefing.stats && (
                  <div
                    className="grid grid-cols-3 gap-2 mb-4 p-2.5 rounded-lg"
                    style={{
                      background: "rgba(0, 200, 255, 0.04)",
                      border: "1px solid rgba(0, 200, 255, 0.08)",
                    }}
                  >
                    <div className="text-center">
                      <p className="text-lg font-bold text-cyan-300 tabular-nums">
                        {activeBriefing.stats.receiversOnline}
                      </p>
                      <p className="text-[9px] text-cyan-500/40 uppercase">
                        Online
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-amber-300 tabular-nums">
                        {activeBriefing.stats.alertCount}
                      </p>
                      <p className="text-[9px] text-cyan-500/40 uppercase">
                        Alerts
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-red-300 tabular-nums">
                        {activeBriefing.stats.conflictEvents}
                      </p>
                      <p className="text-[9px] text-cyan-500/40 uppercase">
                        Conflicts
                      </p>
                    </div>
                  </div>
                )}

                {/* Briefing Content */}
                <div className="prose prose-invert prose-sm max-w-none [&_table]:text-xs [&_th]:px-2 [&_td]:px-2 [&_th]:py-1 [&_td]:py-1 [&_table]:border-cyan-500/20 [&_th]:border-cyan-500/20 [&_td]:border-cyan-500/20 [&_h1]:text-amber-200 [&_h2]:text-amber-200 [&_h3]:text-cyan-200 [&_strong]:text-cyan-200 [&_a]:text-cyan-400 [&_code]:text-amber-300 [&_code]:bg-amber-400/10 [&_li]:text-cyan-200/80">
                  <Streamdown>{activeBriefing.content}</Streamdown>
                </div>

                {/* Data Sources */}
                {activeBriefing.dataSources && (
                  <div className="mt-4 pt-3" style={{ borderTop: "1px solid rgba(0, 200, 255, 0.06)" }}>
                    <p className="text-[9px] text-cyan-500/30 uppercase tracking-widest mb-1.5">
                      Data Sources
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {activeBriefing.dataSources.map((src, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 rounded text-[9px] text-cyan-400/50"
                          style={{
                            background: "rgba(0, 200, 255, 0.06)",
                            border: "1px solid rgba(0, 200, 255, 0.1)",
                          }}
                        >
                          {src.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Export */}
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => handleExportBriefing(activeBriefing)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-medium text-cyan-400/60 hover:text-cyan-300 transition-colors"
                    style={{
                      background: "rgba(0, 200, 255, 0.06)",
                      border: "1px solid rgba(0, 200, 255, 0.1)",
                    }}
                  >
                    <Download className="w-3 h-3" />
                    Export as Markdown
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <FileText className="w-10 h-10 text-cyan-500/15" />
                <p className="text-sm text-cyan-300/40">
                  No briefings yet
                </p>
                <p className="text-[10px] text-cyan-500/25 max-w-[250px] text-center">
                  Generate your first intelligence briefing using the buttons above
                </p>
              </div>
            )}
          </div>

          {/* History Toggle */}
          <div
            className="shrink-0"
            style={{ borderTop: "1px solid rgba(0, 200, 255, 0.08)" }}
          >
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full flex items-center justify-between px-4 py-2 text-[11px] text-cyan-400/50 hover:text-cyan-300 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                Past Briefings
                {historyQuery.data && (
                  <span className="text-cyan-500/30">
                    ({historyQuery.data.briefings.length})
                  </span>
                )}
              </span>
              {showHistory ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5" />
              )}
            </button>

            <AnimatePresence>
              {showHistory && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <div
                    className="max-h-48 overflow-y-auto px-3 pb-2 space-y-1 scrollbar-thin"
                    style={{
                      borderTop: "1px solid rgba(0, 200, 255, 0.06)",
                    }}
                  >
                    {historyQuery.isLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="w-4 h-4 text-cyan-400/30 animate-spin" />
                      </div>
                    ) : historyQuery.data?.briefings.length === 0 ? (
                      <p className="text-[10px] text-cyan-500/25 text-center py-3">
                        No past briefings
                      </p>
                    ) : (
                      historyQuery.data?.briefings.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => handleSelectBriefing(b)}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all duration-150 hover:scale-[1.01]"
                          style={{
                            background:
                              activeBriefing?.generatedAt === b.generatedAt
                                ? "rgba(255, 180, 0, 0.08)"
                                : "rgba(0, 200, 255, 0.03)",
                            border: `1px solid ${
                              activeBriefing?.generatedAt === b.generatedAt
                                ? "rgba(255, 180, 0, 0.15)"
                                : "rgba(0, 200, 255, 0.06)"
                            }`,
                          }}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] text-cyan-200/70 truncate">
                              {b.title}
                            </p>
                            <p className="text-[9px] text-cyan-500/30">
                              {new Date(b.generatedAt).toLocaleString()}
                            </p>
                          </div>
                          <div className="shrink-0 flex items-center gap-1">
                            {b.isRead ? (
                              <CheckCircle2 className="w-3 h-3 text-emerald-500/40" />
                            ) : (
                              <Eye className="w-3 h-3 text-amber-400/50" />
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
