/**
 * IntelChat.tsx — HybridRAG Intelligence Chat Popup
 *
 * Floating chat dialog in the lower-right corner that provides
 * an AI-powered intelligence analyst interface. Uses the RAG engine
 * to query across all Valentine RF data sources.
 *
 * Design: "Ether" dark atmospheric style matching the globe UI.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { motion, AnimatePresence } from "framer-motion";
import { Streamdown } from "streamdown";
import {
  MessageSquare,
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
} from "lucide-react";

interface ChatMsg {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
}

const SUGGESTED_QUERIES = [
  "Give me a system status overview",
  "Show high-severity anomaly alerts",
  "What conflict events have the most fatalities?",
  "List active geofence zones and recent violations",
  "Any targets near active conflict zones?",
  "Show recent sweep results",
];

export default function IntelChat() {
  const { isAuthenticated } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  // tRPC mutations/queries
  const sendMessage = trpc.chat.sendMessage.useMutation();
  const clearHistory = trpc.chat.clearHistory.useMutation();
  const historyQuery = trpc.chat.getHistory.useQuery(undefined, {
    enabled: isAuthenticated && isOpen,
    refetchOnWindowFocus: false,
  });

  // Load history when opening
  useEffect(() => {
    if (historyQuery.data && isOpen) {
      const loaded = historyQuery.data.messages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
      if (loaded.length > 0) {
        setMessages(loaded);
      }
    }
  }, [historyQuery.data, isOpen]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMsg: ChatMsg = {
      id: Date.now(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const result = await sendMessage.mutateAsync({ message: trimmed });
      const assistantMsg: ChatMsg = {
        id: Date.now() + 1,
        role: "assistant",
        content: result.response,
        timestamp: result.timestamp,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      if (!isOpen) {
        setUnreadCount((c) => c + 1);
      }
    } catch (err) {
      const errorMsg: ChatMsg = {
        id: Date.now() + 1,
        role: "assistant",
        content:
          "Connection error. Please check your network and try again.",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, sendMessage, isOpen]);

  const handleClear = useCallback(async () => {
    try {
      await clearHistory.mutateAsync();
      setMessages([]);
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
      setInput(query);
      // Auto-send after a tick
      setTimeout(() => {
        const userMsg: ChatMsg = {
          id: Date.now(),
          role: "user",
          content: query,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, userMsg]);
        setIsLoading(true);
        sendMessage
          .mutateAsync({ message: query })
          .then((result) => {
            setMessages((prev) => [
              ...prev,
              {
                id: Date.now() + 1,
                role: "assistant",
                content: result.response,
                timestamp: result.timestamp,
              },
            ]);
          })
          .catch(() => {
            setMessages((prev) => [
              ...prev,
              {
                id: Date.now() + 1,
                role: "assistant",
                content: "Connection error. Please try again.",
                timestamp: Date.now(),
              },
            ]);
          })
          .finally(() => {
            setIsLoading(false);
            setInput("");
          });
      }, 50);
    },
    [sendMessage]
  );

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => {
      if (!prev) setUnreadCount(0);
      return !prev;
    });
  }, []);

  // ── Render ──────────────────────────────────────────────────────

  return (
    <>
      {/* Floating Toggle Button */}
      <motion.button
        onClick={toggleOpen}
        className="fixed bottom-6 right-6 z-[9999] flex items-center justify-center rounded-full shadow-lg shadow-cyan-500/20 transition-all duration-200"
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
              right: isExpanded ? 16 : 24,
              width: isExpanded ? "min(900px, calc(100vw - 32px))" : "min(440px, calc(100vw - 48px))",
              height: isExpanded ? "calc(100vh - 32px)" : "min(640px, calc(100vh - 120px))",
              background: "linear-gradient(180deg, #0a1628 0%, #060e1a 100%)",
              border: "1px solid rgba(0, 200, 255, 0.15)",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 shrink-0"
              style={{
                background: "linear-gradient(90deg, rgba(0,200,255,0.08) 0%, rgba(0,100,200,0.05) 100%)",
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
                    HybridRAG • All Sources
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
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
                        background: "radial-gradient(circle, rgba(0,200,255,0.15) 0%, transparent 70%)",
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
                        anomalies, geofence zones, or signal fingerprints.
                        I can cross-reference across all data sources.
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
                  {messages.map((msg) => (
                    <MessageBubble key={msg.id} message={msg} />
                  ))}
                  {isLoading && <ThinkingIndicator />}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

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

// ── Sub-Components ────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMsg }) {
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
          <div className="prose prose-invert prose-sm max-w-none [&_table]:text-xs [&_th]:px-2 [&_td]:px-2 [&_th]:py-1 [&_td]:py-1 [&_table]:border-cyan-500/20 [&_th]:border-cyan-500/20 [&_td]:border-cyan-500/20 [&_h1]:text-cyan-200 [&_h2]:text-cyan-200 [&_h3]:text-cyan-200 [&_strong]:text-cyan-200 [&_a]:text-cyan-400 [&_code]:text-amber-300 [&_code]:bg-amber-400/10 [&_pre]:bg-black/30">
            <Streamdown>{message.content}</Streamdown>
          </div>
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
