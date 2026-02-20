/**
 * DirectorySourcesPanel.tsx — Directory Sources status indicator
 * Design: "Ether" dark atmospheric theme
 *
 * Shows which external SDR directories were successfully fetched,
 * how many new receivers each contributed, and any errors.
 * Includes a manual refresh button to force re-fetch all directories.
 */
import { useState } from "react";
import { useRadio, type DirectorySourceInfo } from "@/contexts/RadioContext";
import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Database,
  Globe,
  Radio,
  Satellite,
  BookOpen,
  Loader2,
} from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Icon for each known directory source */
function sourceIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes("kiwi")) return <Radio className="w-3.5 h-3.5 text-emerald-400" />;
  if (n.includes("websdr")) return <Satellite className="w-3.5 h-3.5 text-rose-400" />;
  if (n.includes("sdr-list")) return <Globe className="w-3.5 h-3.5 text-violet-400" />;
  if (n.includes("receiver")) return <BookOpen className="w-3.5 h-3.5 text-amber-400" />;
  if (n.includes("static")) return <Database className="w-3.5 h-3.5 text-muted-foreground" />;
  return <Globe className="w-3.5 h-3.5 text-muted-foreground" />;
}

/** Color class for status dot */
function statusDot(src: DirectorySourceInfo) {
  if (src.errors.length > 0 && src.fetched === 0) return "bg-red-500";
  if (src.errors.length > 0) return "bg-amber-500";
  if (src.fetched > 0) return "bg-emerald-500";
  return "bg-muted-foreground/40";
}

export default function DirectorySourcesPanel({ open, onClose }: Props) {
  const { directorySources, refreshDirectories, directoryRefreshing, newStationLabels } = useRadio();
  const [expandedErrors, setExpandedErrors] = useState<Set<number>>(new Set());

  const totalNew = directorySources.reduce((n, s) => n + s.newStations, 0);
  const totalFetched = directorySources.reduce((n, s) => n + s.fetched, 0);
  const hasErrors = directorySources.some((s) => s.errors.length > 0);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 30 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="absolute top-16 right-4 z-50 w-[360px] max-h-[70vh] rounded-xl border border-border bg-background/95 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-foreground tracking-tight">
                Directory Sources
              </h3>
              {directorySources.length > 0 && (
                <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                  {totalNew} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={refreshDirectories}
                disabled={directoryRefreshing}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
                title="Refresh all directories"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${directoryRefreshing ? "animate-spin" : ""}`} />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Summary bar */}
          {directorySources.length > 0 && (
            <div className="px-4 py-2 border-b border-border/50 bg-muted/10">
              <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                <span>{totalFetched} fetched across {directorySources.length} sources</span>
                <span className="text-cyan-400">{newStationLabels.size} unique new on globe</span>
              </div>
              {hasErrors && (
                <div className="flex items-center gap-1 mt-1 text-[10px] text-amber-400">
                  <AlertTriangle className="w-3 h-3" />
                  <span>Some sources reported errors</span>
                </div>
              )}
            </div>
          )}

          {/* Source list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {directoryRefreshing && directorySources.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">Fetching directories...</span>
              </div>
            )}

            {!directoryRefreshing && directorySources.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Database className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs">No directory data yet.</p>
                <p className="text-[10px] mt-1">Directories are fetched on page load.</p>
              </div>
            )}

            {directorySources.map((src, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-border/50 bg-muted/10 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-center gap-2.5 px-3 py-2">
                  {/* Status dot */}
                  <div className={`w-2 h-2 rounded-full shrink-0 ${statusDot(src)}`} />

                  {/* Icon */}
                  {sourceIcon(src.name)}

                  {/* Name & stats */}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground truncate">
                      {src.name}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground mt-0.5">
                      <span>{src.fetched} fetched</span>
                      {src.newStations > 0 && (
                        <>
                          <span className="w-px h-2.5 bg-foreground/10" />
                          <span className="text-cyan-400">+{src.newStations} new</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Status icon */}
                  {src.errors.length > 0 ? (
                    <button
                      onClick={() => {
                        setExpandedErrors((prev) => {
                          const next = new Set(prev);
                          if (next.has(idx)) next.delete(idx);
                          else next.add(idx);
                          return next;
                        });
                      }}
                      className="p-1 rounded text-amber-400 hover:bg-amber-500/10 transition-colors"
                      title="View errors"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                    </button>
                  ) : src.fetched > 0 ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : null}
                </div>

                {/* Error details (expandable) */}
                <AnimatePresence>
                  {expandedErrors.has(idx) && src.errors.length > 0 && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 pb-2 pt-0.5">
                        {src.errors.map((err, errIdx) => (
                          <p
                            key={errIdx}
                            className="text-[10px] font-mono text-red-400/80 leading-relaxed"
                          >
                            {err}
                          </p>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>

          {/* Footer */}
          {directorySources.length > 0 && (
            <div className="px-4 py-2 border-t border-border/50 bg-muted/10">
              <p className="text-[10px] text-muted-foreground/60 text-center">
                Directories refresh automatically every hour
              </p>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
