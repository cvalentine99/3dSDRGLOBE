/**
 * IntelChat.tsx — HybridRAG Intelligence Chat Popup
 *
 * Floating chat dialog in the lower-left corner that provides
 * an AI-powered intelligence analyst interface. Uses SSE streaming
 * for token-by-token response rendering. Messages are persisted in DB.
 * Supports globe actions (fly-to, highlight, overlay toggle).
 *
 * Design: "Ether" dark atmospheric style matching the globe UI.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useRadio } from "@/contexts/RadioContext";
import { getLoginUrl } from "@/const";
import { motion, AnimatePresence } from "framer-motion";
import { Streamdown } from "streamdown";
import {
  X,
  Send,
  Trash2,
  Loader2,
  Bot,
  User,
  Minimize2,
  Maximize2,
  AlertTriangle,
  Sparkles,
  MapPin,
  Radio,
  Layers,
  Navigation,
  Download,
  Database,
  ArrowRight,
  Bookmark,
  FileText,
  Info,
} from "lucide-react";
import SavedQueriesSidebar from "./SavedQueriesSidebar";
import BriefingPanel from "./BriefingPanel";

// ── Types ────────────────────────────────────────────────────────

interface GlobeAction {
  type: "FLY_TO" | "HIGHLIGHT" | "OVERLAY";
  params: string;
  label: string;
}

interface FollowUpSuggestion {
  text: string;
}

interface ToolResultPreview {
  toolName: string;
  summary: string;
  preview?: { count?: number; highlights?: string[] };
}

interface ChatMsg {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  globeActions?: GlobeAction[];
  suggestions?: FollowUpSuggestion[];
  toolResults?: ToolResultPreview[];
  timestamp?: number;
  isStreaming?: boolean;
  statusText?: string;
}

// ── Globe Action Parser ──────────────────────────────────────────

const GLOBE_ACTION_REGEX = /\[GLOBE:(FLY_TO|HIGHLIGHT|OVERLAY):([^:]+):([^\]]+)\]/g;
const SUGGESTION_REGEX = /\[SUGGESTION:([^\]]+)\]/g;
const SOURCE_REGEX = /\[SOURCE:([^\]]+)\]/g;

function parseGlobeActions(text: string): GlobeAction[] {
  const actions: GlobeAction[] = [];
  let match;
  const regex = new RegExp(GLOBE_ACTION_REGEX.source, "g");
  while ((match = regex.exec(text)) !== null) {
    actions.push({
      type: match[1] as GlobeAction["type"],
      params: match[2],
      label: match[3],
    });
  }
  return actions;
}

function parseSuggestions(text: string): FollowUpSuggestion[] {
  const suggestions: FollowUpSuggestion[] = [];
  let match;
  const regex = new RegExp(SUGGESTION_REGEX.source, "g");
  while ((match = regex.exec(text)) !== null) {
    suggestions.push({ text: match[1].trim() });
  }
  return suggestions;
}

function stripGlobeActions(text: string): string {
  return text
    .replace(GLOBE_ACTION_REGEX, "")
    .replace(SUGGESTION_REGEX, "")
    .replace(SOURCE_REGEX, "")
    .replace(/---\s*\n\*\*Suggested follow-ups:\*\*\s*/g, "")
    .trim();
}

function parseSources(text: string): string[] {
  const sources: string[] = [];
  let match;
  const regex = new RegExp(SOURCE_REGEX.source, "g");
  while ((match = regex.exec(text)) !== null) {
    const src = match[1].trim();
    if (!sources.includes(src)) sources.push(src);
  }
  return sources;
}

/** Map source labels to colors */
const SOURCE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  "DB": { bg: "rgba(0, 200, 255, 0.1)", border: "rgba(0, 200, 255, 0.25)", text: "rgb(100, 220, 255)" },
  "UCDP": { bg: "rgba(255, 80, 80, 0.1)", border: "rgba(255, 80, 80, 0.25)", text: "rgb(255, 140, 140)" },
  "DIR": { bg: "rgba(100, 255, 150, 0.1)", border: "rgba(100, 255, 150, 0.25)", text: "rgb(130, 255, 170)" },
  "SWEEP": { bg: "rgba(255, 180, 0, 0.1)", border: "rgba(255, 180, 0, 0.25)", text: "rgb(255, 210, 100)" },
  "CROSS-REF": { bg: "rgba(180, 100, 255, 0.1)", border: "rgba(180, 100, 255, 0.25)", text: "rgb(200, 150, 255)" },
};

function getSourceColor(source: string) {
  const prefix = source.split("/")[0];
  return SOURCE_COLORS[prefix] || SOURCE_COLORS["DB"];
}

// ── Constants ────────────────────────────────────────────────────

const SUGGESTED_QUERIES = [
  "Give me a system status overview",
  "Show high-severity anomaly alerts",
  "What conflict events have the most fatalities?",
  "List active geofence zones and recent violations",
  "Any targets near active conflict zones?",
  "Show recent sweep results",
];

// ── Main Component ───────────────────────────────────────────────

export default function IntelChat() {
  const { isAuthenticated } = useAuth();
  const { setGlobeTarget, filteredStations, setHighlightedStationLabel, overlayToggles } = useRadio();
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const [showSavedQueries, setShowSavedQueries] = useState(false);
  const [showBriefings, setShowBriefings] = useState(false);

  // tRPC queries
  const clearHistory = trpc.chat.clearHistory.useMutation();
  const historyQuery = trpc.chat.getHistory.useQuery(undefined, {
    enabled: isAuthenticated && isOpen,
    refetchOnWindowFocus: false,
  });

  // Load history from DB when opening
  useEffect(() => {
    if (historyQuery.data && isOpen) {
      const loaded = historyQuery.data.messages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        globeActions: (m.globeActions as GlobeAction[] | null) || undefined,
      }));
      if (loaded.length > 0) {
        setMessages(loaded);
      }
    }
  }, [historyQuery.data, isOpen]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, statusText]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // ── SSE Streaming Send ─────────────────────────────────────────

  const sendStreaming = useCallback(
    async (messageText: string) => {
      if (isLoading) return;

      const userMsg: ChatMsg = {
        id: Date.now(),
        role: "user",
        content: messageText,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsLoading(true);
      setStatusText("Connecting...");

      // Create a placeholder for the streaming assistant message
      const assistantId = Date.now() + 1;
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          isStreaming: true,
          timestamp: Date.now(),
        },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: messageText }),
          credentials: "include",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") break;

            try {
              const event = JSON.parse(data);

              if (event.type === "status") {
                setStatusText(event.data);
              } else if (event.type === "tool_result") {
                // Show tool result preview as a mini data card
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          toolResults: [
                            ...(m.toolResults || []),
                            {
                              toolName: event.toolName || "unknown",
                              summary: event.data,
                              preview: event.preview,
                            },
                          ],
                        }
                      : m
                  )
                );
              } else if (event.type === "token") {
                fullContent += event.data;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: fullContent }
                      : m
                  )
                );
              } else if (event.type === "done") {
                // Parse globe actions and suggestions from final content
                const actions = parseGlobeActions(fullContent);
                const suggestions = parseSuggestions(fullContent);
                const cleanContent = stripGlobeActions(fullContent);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          content: cleanContent,
                          isStreaming: false,
                          globeActions:
                            actions.length > 0 ? actions : undefined,
                          suggestions:
                            suggestions.length > 0 ? suggestions : undefined,
                        }
                      : m
                  )
                );
              } else if (event.type === "error") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          content:
                            event.data ||
                            "An error occurred during analysis.",
                          isStreaming: false,
                        }
                      : m
                  )
                );
              }
            } catch {
              // Skip malformed SSE data
            }
          }
        }

        // Finalize if not already done
        if (fullContent) {
          const actions = parseGlobeActions(fullContent);
          const suggestions = parseSuggestions(fullContent);
          const cleanContent = stripGlobeActions(fullContent);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: cleanContent || m.content,
                    isStreaming: false,
                    globeActions: actions.length > 0 ? actions : m.globeActions,
                    suggestions: suggestions.length > 0 ? suggestions : m.suggestions,
                  }
                : m
            )
          );
        }

        if (!isOpen) {
          setUnreadCount((c) => c + 1);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content:
                    "Connection error. Please check your network and try again.",
                  isStreaming: false,
                }
              : m
          )
        );
      } finally {
        setIsLoading(false);
        setStatusText("");
        abortRef.current = null;
      }
    },
    [isLoading, isOpen]
  );

  // ── Handlers ───────────────────────────────────────────────────

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    sendStreaming(trimmed);
  }, [input, isLoading, sendStreaming]);

  const handleClear = useCallback(async () => {
    try {
      if (abortRef.current) abortRef.current.abort();
      await clearHistory.mutateAsync();
      setMessages([]);
      setIsLoading(false);
      setStatusText("");
    } catch {
      // ignore
    }
  }, [clearHistory]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleSuggestionClick = useCallback(
    (query: string) => {
      sendStreaming(query);
    },
    [sendStreaming]
  );

  const handleGlobeAction = useCallback(
    (action: GlobeAction) => {
      switch (action.type) {
        case "FLY_TO": {
          const [latStr, lngStr] = action.params.split(",");
          const lat = parseFloat(latStr);
          const lng = parseFloat(lngStr);
          if (!isNaN(lat) && !isNaN(lng)) {
            setGlobeTarget({ lat, lng, zoom: 3 });
          }
          break;
        }
        case "HIGHLIGHT": {
          // Find the station by label (params may be label or partial match)
          const receiverLabel = action.params.trim();
          const station = filteredStations.find(
            (s) =>
              s.label === receiverLabel ||
              s.label.toLowerCase().includes(receiverLabel.toLowerCase())
          );
          if (station) {
            // Set the highlight in context — Globe will render the glow
            setHighlightedStationLabel(station.label);
            // Fly to the station
            const [lng, lat] = station.location.coordinates;
            setGlobeTarget({ lat, lng, zoom: 3 });
            // Auto-clear highlight after 10 seconds
            setTimeout(() => setHighlightedStationLabel(null), 10000);
          } else {
            console.warn(`[IntelChat] Station not found: ${receiverLabel}`);
          }
          break;
        }
        case "OVERLAY": {
          const overlay = action.params.toLowerCase().trim();
          // Match overlay name to registered toggle callback
          const toggles = overlayToggles.current;
          // Try exact match first, then partial match
          const key = Object.keys(toggles).find(
            (k) => k === overlay || overlay.includes(k) || k.includes(overlay)
          );
          if (key && toggles[key]) {
            toggles[key]();
            console.log(`[IntelChat] Toggled overlay: ${key}`);
          } else {
            console.warn(`[IntelChat] Unknown overlay: ${overlay}. Available: ${Object.keys(toggles).join(", ")}`);
          }
          break;
        }
      }
    },
    [setGlobeTarget, filteredStations, setHighlightedStationLabel, overlayToggles]
  );

  // ── Export Conversation ─────────────────────────────────────────

  const handleExport = useCallback(() => {
    if (messages.length === 0) return;

    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toTimeString().split(" ")[0].replace(/:/g, "");

    let md = `# Valentine RF Intelligence Chat Export\n`;
    md += `**Date:** ${now.toLocaleString()}\n`;
    md += `**Messages:** ${messages.length}\n\n---\n\n`;

    for (const msg of messages) {
      const role = msg.role === "user" ? "\u{1F464} **User**" : "\u{1F916} **Intel Analyst**";
      md += `### ${role}\n\n`;
      md += `${msg.content}\n\n`;
      if (msg.globeActions && msg.globeActions.length > 0) {
        md += `**Globe Actions:**\n`;
        for (const a of msg.globeActions) {
          md += `- ${a.type}: ${a.label} (${a.params})\n`;
        }
        md += `\n`;
      }
      md += `---\n\n`;
    }

    md += `\n*Exported from Valentine RF SIGINT Platform*\n`;

    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `intel-chat-${dateStr}-${timeStr}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [messages]);

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => {
      if (!prev) setUnreadCount(0);
      return !prev;
    });
  }, []);

  // ── Render ─────────────────────────────────────────────────────

  return (
    <>
      {/* Floating Toggle Button */}
      <motion.button
        onClick={toggleOpen}
        className="fixed bottom-6 left-6 z-[9999] flex items-center justify-center rounded-full shadow-lg shadow-cyan-500/20 transition-all duration-200"
        style={{
          width: 56,
          height: 56,
          background: "linear-gradient(135deg, #0a1628 0%, #0d2847 100%)",
          border: "1px solid rgba(0, 200, 255, 0.3)",
        }}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        title="Intelligence Analyst Chat"
      >
        {isOpen ? (
          <X className="w-6 h-6 text-cyan-400" />
        ) : (
          <>
            <Bot className="w-6 h-6 text-cyan-400" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                {unreadCount}
              </span>
            )}
          </>
        )}
      </motion.button>

      {/* Chat Dialog */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed z-[9998] flex flex-col overflow-hidden rounded-xl shadow-2xl shadow-cyan-500/10"
            style={{
              bottom: isExpanded ? 16 : 80,
              left: isExpanded ? 16 : 24,
              width: isExpanded
                ? "min(900px, calc(100vw - 32px))"
                : "min(440px, calc(100vw - 48px))",
              height: isExpanded
                ? "calc(100vh - 32px)"
                : "min(640px, calc(100vh - 120px))",
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
                  "linear-gradient(90deg, rgba(0,200,255,0.08) 0%, rgba(0,100,200,0.05) 100%)",
                borderBottom: "1px solid rgba(0, 200, 255, 0.1)",
              }}
            >
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Bot className="w-5 h-5 text-cyan-400" />
                  <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-cyan-100 tracking-wide">
                    INTEL ANALYST
                  </h3>
                  <p className="text-[10px] text-cyan-500/60 uppercase tracking-widest">
                    HybridRAG • SSE Stream • DB Persist
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowSavedQueries(!showSavedQueries)}
                  className={`p-1.5 rounded-md transition-colors ${
                    showSavedQueries
                      ? "text-amber-400 bg-amber-400/10"
                      : "text-cyan-500/50 hover:text-amber-400 hover:bg-amber-400/10"
                  }`}
                  title="Saved queries"
                >
                  <Bookmark className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowBriefings(!showBriefings)}
                  className={`p-1.5 rounded-md transition-colors ${
                    showBriefings
                      ? "text-amber-400 bg-amber-400/10"
                      : "text-cyan-500/50 hover:text-amber-400 hover:bg-amber-400/10"
                  }`}
                  title="Intelligence briefings"
                >
                  <FileText className="w-4 h-4" />
                </button>
                <button
                  onClick={handleExport}
                  className="p-1.5 rounded-md text-cyan-500/50 hover:text-emerald-400 hover:bg-emerald-400/10 transition-colors"
                  title="Export conversation as Markdown"
                  disabled={messages.length === 0}
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={handleClear}
                  className="p-1.5 rounded-md text-cyan-500/50 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                  title="Clear conversation"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="p-1.5 rounded-md text-cyan-500/50 hover:text-cyan-300 hover:bg-cyan-400/10 transition-colors"
                  title={isExpanded ? "Minimize" : "Expand"}
                >
                  {isExpanded ? (
                    <Minimize2 className="w-4 h-4" />
                  ) : (
                    <Maximize2 className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={toggleOpen}
                  className="p-1.5 rounded-md text-cyan-500/50 hover:text-cyan-300 hover:bg-cyan-400/10 transition-colors"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Main Content Area with optional sidebar */}
            <div className="flex flex-1 overflow-hidden">
              {/* Saved Queries Sidebar */}
              <AnimatePresence>
                {showSavedQueries && (
                  <SavedQueriesSidebar
                    isOpen={showSavedQueries}
                    onToggle={() => setShowSavedQueries(false)}
                    onRunQuery={handleSuggestionClick}
                    currentInput={input}
                  />
                )}
              </AnimatePresence>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin">
              {!isAuthenticated ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <AlertTriangle className="w-8 h-8 text-amber-400/60" />
                  <p className="text-sm text-cyan-300/60">
                    Authentication required to use the Intelligence Analyst.
                  </p>
                  <a
                    href={getLoginUrl()}
                    className="text-xs text-cyan-400 hover:text-cyan-300 underline"
                  >
                    Sign in to continue
                  </a>
                </div>
              ) : messages.length === 0 && !isLoading ? (
                <div className="flex flex-col h-full">
                  {/* Welcome */}
                  <div className="flex-1 flex flex-col items-center justify-center gap-4">
                    <div
                      className="w-14 h-14 rounded-full flex items-center justify-center"
                      style={{
                        background:
                          "radial-gradient(circle, rgba(0,200,255,0.15) 0%, transparent 70%)",
                        border: "1px solid rgba(0,200,255,0.2)",
                      }}
                    >
                      <Sparkles className="w-7 h-7 text-cyan-400" />
                    </div>
                    <div className="text-center">
                      <h4 className="text-sm font-semibold text-cyan-200 mb-1">
                        Valentine RF Intelligence Analyst
                      </h4>
                      <p className="text-xs text-cyan-500/50 max-w-[280px]">
                        Ask me about receivers, targets, conflict events,
                        anomalies, geofence zones, or signal fingerprints. I
                        can cross-reference across all data sources.
                      </p>
                    </div>
                  </div>

                  {/* Suggested Queries */}
                  <div className="pb-2">
                    <p className="text-[10px] text-cyan-500/40 uppercase tracking-widest mb-2">
                      Suggested Queries
                    </p>
                    <div className="grid grid-cols-1 gap-1.5">
                      {SUGGESTED_QUERIES.map((q, i) => (
                        <button
                          key={i}
                          onClick={() => handleSuggestionClick(q)}
                          className="text-left text-xs px-3 py-2 rounded-lg text-cyan-300/70 hover:text-cyan-200 transition-colors truncate"
                          style={{
                            background: "rgba(0, 200, 255, 0.04)",
                            border: "1px solid rgba(0, 200, 255, 0.08)",
                          }}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((msg, idx) => (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      onGlobeAction={handleGlobeAction}
                      onSuggestionClick={handleSuggestionClick}
                      isLastAssistant={
                        msg.role === "assistant" &&
                        idx === messages.length - 1
                      }
                    />
                  ))}
                  {isLoading && statusText && (
                    <StatusIndicator text={statusText} />
                  )}
                  {isLoading && !statusText && <ThinkingIndicator />}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>
            </div>

            {/* Briefing Panel */}
            <BriefingPanel
              isOpen={showBriefings}
              onClose={() => setShowBriefings(false)}
            />

            {/* Input Area */}
            {isAuthenticated && (
              <div
                className="shrink-0 px-3 py-2"
                style={{
                  borderTop: "1px solid rgba(0, 200, 255, 0.1)",
                  background: "rgba(0, 10, 20, 0.5)",
                }}
              >
                <div
                  className="flex items-end gap-2 rounded-lg px-3 py-2"
                  style={{
                    background: "rgba(0, 200, 255, 0.04)",
                    border: "1px solid rgba(0, 200, 255, 0.1)",
                  }}
                >
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask the Intelligence Analyst..."
                    rows={1}
                    className="flex-1 bg-transparent text-sm text-cyan-100 placeholder-cyan-500/30 resize-none outline-none max-h-24"
                    style={{ lineHeight: "1.5" }}
                    disabled={isLoading}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                    className="p-1.5 rounded-md transition-all duration-150 shrink-0"
                    style={{
                      color:
                        input.trim() && !isLoading
                          ? "rgb(0, 200, 255)"
                          : "rgba(0, 200, 255, 0.2)",
                      background:
                        input.trim() && !isLoading
                          ? "rgba(0, 200, 255, 0.1)"
                          : "transparent",
                    }}
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[9px] text-cyan-500/25 mt-1 text-center">
                  Shift+Enter for new line • Enter to send
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Sub-Components ───────────────────────────────────────────────

function MessageBubble({
  message,
  onGlobeAction,
  onSuggestionClick,
  isLastAssistant,
}: {
  message: ChatMsg;
  onGlobeAction: (action: GlobeAction) => void;
  onSuggestionClick: (query: string) => void;
  isLastAssistant: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
          style={{
            background: "rgba(0, 200, 255, 0.1)",
            border: "1px solid rgba(0, 200, 255, 0.15)",
          }}
        >
          <Bot className="w-3.5 h-3.5 text-cyan-400" />
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
          isUser ? "rounded-br-sm" : "rounded-bl-sm"
        }`}
        style={
          isUser
            ? {
                background: "rgba(0, 100, 200, 0.2)",
                border: "1px solid rgba(0, 150, 255, 0.15)",
                color: "rgb(180, 220, 255)",
              }
            : {
                background: "rgba(0, 200, 255, 0.05)",
                border: "1px solid rgba(0, 200, 255, 0.08)",
                color: "rgb(200, 230, 255)",
              }
        }
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : (
          <>
            {/* Tool Result Data Previews */}
            {message.toolResults && message.toolResults.length > 0 && (
              <div className="mb-2 space-y-1">
                {message.toolResults.map((tr, i) => (
                  <div
                    key={i}
                    className="rounded-md px-2.5 py-1.5 text-[11px]"
                    style={{
                      background: "rgba(0, 200, 255, 0.06)",
                      border: "1px solid rgba(0, 200, 255, 0.12)",
                    }}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Database className="w-3 h-3 text-cyan-500/60" />
                      <span className="text-cyan-400/80 font-medium">
                        {tr.toolName.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                      </span>
                      {tr.preview?.count !== undefined && (
                        <span className="ml-auto text-cyan-500/50 tabular-nums">
                          {tr.preview.count} results
                        </span>
                      )}
                    </div>
                    <p className="text-cyan-300/60">{tr.summary}</p>
                    {tr.preview?.highlights && tr.preview.highlights.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {tr.preview.highlights.map((h, j) => (
                          <span
                            key={j}
                            className="inline-block px-1.5 py-0.5 rounded text-[10px] text-cyan-300/70"
                            style={{ background: "rgba(0, 200, 255, 0.08)" }}
                          >
                            {h}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="prose prose-invert prose-sm max-w-none [&_table]:text-xs [&_th]:px-2 [&_td]:px-2 [&_th]:py-1 [&_td]:py-1 [&_table]:border-cyan-500/20 [&_th]:border-cyan-500/20 [&_td]:border-cyan-500/20 [&_h1]:text-cyan-200 [&_h2]:text-cyan-200 [&_h3]:text-cyan-200 [&_strong]:text-cyan-200 [&_a]:text-cyan-400 [&_code]:text-amber-300 [&_code]:bg-amber-400/10 [&_pre]:bg-black/30">
              <Streamdown>{message.content}</Streamdown>
            </div>
            {message.isStreaming && (
              <span className="inline-block w-1.5 h-4 bg-cyan-400 animate-pulse ml-0.5 align-text-bottom" />
            )}
            {/* Source Citations */}
            {!message.isStreaming && (() => {
              const sources = parseSources(message.content);
              if (sources.length === 0) return null;
              return (
                <div className="mt-2 pt-1.5 flex flex-wrap gap-1" style={{ borderTop: "1px solid rgba(0, 200, 255, 0.06)" }}>
                  <span className="text-[9px] text-cyan-500/30 uppercase tracking-widest mr-1 self-center flex items-center gap-0.5">
                    <Info className="w-2.5 h-2.5" /> Sources
                  </span>
                  {sources.map((src, i) => {
                    const color = getSourceColor(src);
                    return (
                      <span
                        key={i}
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium"
                        style={{
                          background: color.bg,
                          border: `1px solid ${color.border}`,
                          color: color.text,
                        }}
                      >
                        {src}
                      </span>
                    );
                  })}
                </div>
              );
            })()}
            {/* Globe Action Buttons */}
            {message.globeActions && message.globeActions.length > 0 && (
              <div className="mt-2 pt-2 flex flex-wrap gap-1.5" style={{ borderTop: "1px solid rgba(0, 200, 255, 0.08)" }}>
                {message.globeActions.map((action, i) => (
                  <GlobeActionButton
                    key={i}
                    action={action}
                    onClick={() => onGlobeAction(action)}
                  />
                ))}
              </div>
            )}
            {/* Follow-Up Suggestion Chips */}
            {isLastAssistant && !message.isStreaming && message.suggestions && message.suggestions.length > 0 && (
              <div className="mt-2 pt-2 space-y-1" style={{ borderTop: "1px solid rgba(0, 200, 255, 0.08)" }}>
                <p className="text-[9px] text-cyan-500/40 uppercase tracking-widest mb-1">Follow-up</p>
                {message.suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => onSuggestionClick(s.text)}
                    className="flex items-center gap-1.5 w-full text-left text-[11px] px-2.5 py-1.5 rounded-md text-cyan-300/70 hover:text-cyan-200 transition-all duration-150 hover:scale-[1.01] group"
                    style={{
                      background: "rgba(0, 200, 255, 0.04)",
                      border: "1px solid rgba(0, 200, 255, 0.08)",
                    }}
                  >
                    <ArrowRight className="w-3 h-3 text-cyan-500/40 group-hover:text-cyan-400 transition-colors shrink-0" />
                    <span className="truncate">{s.text}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {isUser && (
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
          style={{
            background: "rgba(0, 100, 200, 0.15)",
            border: "1px solid rgba(0, 150, 255, 0.15)",
          }}
        >
          <User className="w-3.5 h-3.5 text-blue-300" />
        </div>
      )}
    </div>
  );
}

function GlobeActionButton({
  action,
  onClick,
}: {
  action: GlobeAction;
  onClick: () => void;
}) {
  const iconMap = {
    FLY_TO: <Navigation className="w-3 h-3" />,
    HIGHLIGHT: <Radio className="w-3 h-3" />,
    OVERLAY: <Layers className="w-3 h-3" />,
  };

  const colorMap = {
    FLY_TO: {
      bg: "rgba(0, 200, 255, 0.1)",
      border: "rgba(0, 200, 255, 0.2)",
      text: "rgb(100, 220, 255)",
      hoverBg: "rgba(0, 200, 255, 0.2)",
    },
    HIGHLIGHT: {
      bg: "rgba(255, 180, 0, 0.1)",
      border: "rgba(255, 180, 0, 0.2)",
      text: "rgb(255, 200, 80)",
      hoverBg: "rgba(255, 180, 0, 0.2)",
    },
    OVERLAY: {
      bg: "rgba(100, 255, 150, 0.1)",
      border: "rgba(100, 255, 150, 0.2)",
      text: "rgb(130, 255, 170)",
      hoverBg: "rgba(100, 255, 150, 0.2)",
    },
  };

  const colors = colorMap[action.type];

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all duration-150 hover:scale-[1.02]"
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        color: colors.text,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = colors.hoverBg;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = colors.bg;
      }}
      title={`${action.type}: ${action.params}`}
    >
      {iconMap[action.type]}
      <span className="truncate max-w-[150px]">{action.label}</span>
      <MapPin className="w-2.5 h-2.5 opacity-50" />
    </button>
  );
}

function StatusIndicator({ text }: { text: string }) {
  return (
    <div className="flex gap-2 justify-start">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
        style={{
          background: "rgba(0, 200, 255, 0.1)",
          border: "1px solid rgba(0, 200, 255, 0.15)",
        }}
      >
        <Bot className="w-3.5 h-3.5 text-cyan-400" />
      </div>
      <div
        className="rounded-xl rounded-bl-sm px-4 py-3 flex items-center gap-2"
        style={{
          background: "rgba(0, 200, 255, 0.05)",
          border: "1px solid rgba(0, 200, 255, 0.08)",
        }}
      >
        <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
        <span className="text-xs text-cyan-400/60">{text}</span>
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex gap-2 justify-start">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
        style={{
          background: "rgba(0, 200, 255, 0.1)",
          border: "1px solid rgba(0, 200, 255, 0.15)",
        }}
      >
        <Bot className="w-3.5 h-3.5 text-cyan-400" />
      </div>
      <div
        className="rounded-xl rounded-bl-sm px-4 py-3 flex items-center gap-2"
        style={{
          background: "rgba(0, 200, 255, 0.05)",
          border: "1px solid rgba(0, 200, 255, 0.08)",
        }}
      >
        <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
        <span className="text-xs text-cyan-400/60">
          Analyzing data sources...
        </span>
      </div>
    </div>
  );
}
