/**
 * SharedListPanel.tsx — Collaborative target sharing panel
 *
 * Features:
 * - Create shared target lists with invite links
 * - Join shared lists via invite tokens
 * - View and manage list members and targets
 * - Copy invite links for sharing
 */
import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Users,
  Plus,
  Link2,
  Copy,
  Check,
  Trash2,
  Globe2,
  Lock,
  UserPlus,
  ChevronDown,
  ChevronUp,
  Target,
  Crown,
  Eye,
  Edit3,
  ExternalLink,
  Share2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface SharedListPanelProps {
  isOpen: boolean;
  onClose: () => void;
  availableTargets?: Array<{ id: number; label: string; category: string }>;
}

export default function SharedListPanel({
  isOpen,
  onClose,
  availableTargets = [],
}: SharedListPanelProps) {
  const [tab, setTab] = useState<"lists" | "join">("lists");
  const [createMode, setCreateMode] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListDesc, setNewListDesc] = useState("");
  const [newListPermission, setNewListPermission] = useState<"view" | "edit">("view");
  const [newListPublic, setNewListPublic] = useState(false);
  const [selectedTargetIds, setSelectedTargetIds] = useState<number[]>([]);
  const [joinToken, setJoinToken] = useState("");
  const [expandedListId, setExpandedListId] = useState<number | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const listsQuery = trpc.sharing.myLists.useQuery(undefined, {
    enabled: isOpen,
  });

  const createListMut = trpc.sharing.createList.useMutation({
    onSuccess: (data) => {
      utils.sharing.myLists.invalidate();
      setCreateMode(false);
      setNewListName("");
      setNewListDesc("");
      setSelectedTargetIds([]);
      toast.success("Shared list created");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const joinMut = trpc.sharing.joinByToken.useMutation({
    onSuccess: (data) => {
      utils.sharing.myLists.invalidate();
      setJoinToken("");
      setTab("lists");
      toast.success(data.message);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const deleteListMut = trpc.sharing.deleteList.useMutation({
    onSuccess: () => {
      utils.sharing.myLists.invalidate();
      setExpandedListId(null);
      toast.success("List deleted");
    },
  });

  const copyInviteLink = useCallback((token: string) => {
    const url = `${window.location.origin}/join/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedToken(token);
      toast.success("Invite link copied");
      setTimeout(() => setCopiedToken(null), 2000);
    });
  }, []);

  const lists = listsQuery.data ?? [];

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="fixed right-4 top-20 w-[440px] max-h-[calc(100vh-120px)] bg-gray-900/95 backdrop-blur-xl border border-blue-500/20 rounded-xl shadow-2xl shadow-blue-500/5 z-50 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-semibold text-white tracking-wide uppercase">
              Shared Lists
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-white/40 hover:text-white rounded-lg transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/5">
          <button
            onClick={() => setTab("lists")}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              tab === "lists"
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            My Lists ({lists.length})
          </button>
          <button
            onClick={() => setTab("join")}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              tab === "join"
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            Join List
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
          {tab === "lists" && (
            <div className="p-3 space-y-2">
              {/* Create new list button */}
              {!createMode && (
                <button
                  onClick={() => setCreateMode(true)}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-blue-500/30 text-blue-400/70 hover:text-blue-400 hover:border-blue-500/50 hover:bg-blue-500/5 transition-all text-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create New Shared List
                </button>
              )}

              {/* Create form */}
              <AnimatePresence>
                {createMode && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="bg-blue-500/5 border border-blue-500/20 rounded-lg overflow-hidden"
                  >
                    <div className="p-3 space-y-2">
                      <input
                        type="text"
                        value={newListName}
                        onChange={(e) => setNewListName(e.target.value)}
                        placeholder="List name..."
                        className="w-full px-3 py-1.5 bg-black/30 border border-white/10 rounded-md text-xs text-white placeholder-white/30 focus:outline-none focus:border-blue-500/40"
                      />
                      <textarea
                        value={newListDesc}
                        onChange={(e) => setNewListDesc(e.target.value)}
                        placeholder="Description (optional)..."
                        rows={2}
                        className="w-full px-3 py-1.5 bg-black/30 border border-white/10 rounded-md text-xs text-white placeholder-white/30 focus:outline-none focus:border-blue-500/40 resize-none"
                      />

                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-[10px] text-white/50">
                          <select
                            value={newListPermission}
                            onChange={(e) => setNewListPermission(e.target.value as "view" | "edit")}
                            className="bg-black/30 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-white"
                          >
                            <option value="view">View only</option>
                            <option value="edit">Can edit</option>
                          </select>
                          Default permission
                        </label>
                        <label className="flex items-center gap-1.5 text-[10px] text-white/50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newListPublic}
                            onChange={(e) => setNewListPublic(e.target.checked)}
                            className="rounded border-white/20"
                          />
                          Public
                        </label>
                      </div>

                      {/* Target selection */}
                      {availableTargets.length > 0 && (
                        <div>
                          <div className="text-[10px] text-white/40 mb-1">Add targets:</div>
                          <div className="max-h-24 overflow-y-auto space-y-0.5">
                            {availableTargets.map((t) => (
                              <label
                                key={t.id}
                                className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-white/5 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedTargetIds.includes(t.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedTargetIds((prev) => [...prev, t.id]);
                                    } else {
                                      setSelectedTargetIds((prev) => prev.filter((id) => id !== t.id));
                                    }
                                  }}
                                  className="rounded border-white/20"
                                />
                                <span className="text-[10px] text-white/70 truncate">{t.label}</span>
                                <span className="text-[9px] text-white/30 ml-auto">{t.category}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => {
                            if (!newListName.trim()) {
                              toast.error("List name is required");
                              return;
                            }
                            createListMut.mutate({
                              name: newListName.trim(),
                              description: newListDesc.trim() || undefined,
                              defaultPermission: newListPermission,
                              isPublic: newListPublic,
                              targetIds: selectedTargetIds.length > 0 ? selectedTargetIds : undefined,
                            });
                          }}
                          disabled={createListMut.isPending}
                          className="flex items-center gap-1 px-3 py-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-md text-[11px] transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                          Create
                        </button>
                        <button
                          onClick={() => {
                            setCreateMode(false);
                            setNewListName("");
                            setNewListDesc("");
                            setSelectedTargetIds([]);
                          }}
                          className="px-3 py-1 text-white/40 hover:text-white/60 text-[11px] transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Lists */}
              {lists.length === 0 && !createMode ? (
                <div className="flex flex-col items-center justify-center py-10 text-white/30">
                  <Share2 className="w-8 h-8 mb-2" />
                  <p className="text-sm">No shared lists yet</p>
                  <p className="text-xs mt-1">Create a list to share targets with your team</p>
                </div>
              ) : (
                lists.map((list) => {
                  const isExpanded = expandedListId === list.id;
                  return (
                    <motion.div
                      key={list.id}
                      layout
                      className="bg-white/[0.03] border border-white/5 rounded-lg overflow-hidden"
                    >
                      <div
                        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/5 transition-colors"
                        onClick={() => setExpandedListId(isExpanded ? null : list.id)}
                      >
                        {list.isPublic ? (
                          <Globe2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                        ) : (
                          <Lock className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-white truncate">
                              {list.name}
                            </span>
                            {list.isOwner && (
                              <Crown className="w-3 h-3 text-yellow-400" />
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-white/40 mt-0.5">
                            <span className="flex items-center gap-0.5">
                              <Target className="w-2.5 h-2.5" />
                              {list.targetCount} targets
                            </span>
                            <span className="flex items-center gap-0.5">
                              <Users className="w-2.5 h-2.5" />
                              {list.memberCount} members
                            </span>
                            <span className="flex items-center gap-0.5">
                              {list.permission === "owner" ? (
                                <Crown className="w-2.5 h-2.5 text-yellow-400" />
                              ) : list.permission === "edit" ? (
                                <Edit3 className="w-2.5 h-2.5 text-green-400" />
                              ) : (
                                <Eye className="w-2.5 h-2.5 text-blue-400" />
                              )}
                              {list.permission}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              copyInviteLink(list.inviteToken);
                            }}
                            className="p-1 text-white/30 hover:text-blue-400 transition-colors"
                            title="Copy invite link"
                          >
                            {copiedToken === list.inviteToken ? (
                              <Check className="w-3 h-3 text-green-400" />
                            ) : (
                              <Link2 className="w-3 h-3" />
                            )}
                          </button>
                          {isExpanded ? (
                            <ChevronUp className="w-3 h-3 text-white/30" />
                          ) : (
                            <ChevronDown className="w-3 h-3 text-white/30" />
                          )}
                        </div>
                      </div>

                      {/* Expanded details */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="border-t border-white/5"
                          >
                            <div className="px-3 py-2 space-y-2 text-xs">
                              {list.description && (
                                <p className="text-white/40 text-[11px]">{list.description}</p>
                              )}

                              {/* Invite link */}
                              <div className="bg-black/20 rounded-lg p-2">
                                <div className="text-[10px] text-white/40 mb-1 flex items-center gap-1">
                                  <Link2 className="w-3 h-3" />
                                  Invite Link
                                </div>
                                <div className="flex items-center gap-1">
                                  <code className="flex-1 text-[10px] text-blue-300/70 font-mono truncate">
                                    {window.location.origin}/join/{list.inviteToken}
                                  </code>
                                  <button
                                    onClick={() => copyInviteLink(list.inviteToken)}
                                    className="p-1 text-white/30 hover:text-blue-400 transition-colors shrink-0"
                                  >
                                    <Copy className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>

                              {/* Actions */}
                              <div className="flex items-center gap-2 pt-1">
                                {list.isOwner && (
                                  <button
                                    onClick={() => {
                                      if (confirm("Delete this shared list?")) {
                                        deleteListMut.mutate({ listId: list.id });
                                      }
                                    }}
                                    className="flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-red-500/20 text-white/40 hover:text-red-400 rounded-md transition-colors text-[11px]"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    Delete List
                                  </button>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })
              )}
            </div>
          )}

          {tab === "join" && (
            <div className="p-4 space-y-4">
              <div className="text-center py-4">
                <UserPlus className="w-10 h-10 text-blue-400/50 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-white/80 mb-1">
                  Join a Shared List
                </h3>
                <p className="text-xs text-white/40">
                  Paste an invite link or token to join a team's target list
                </p>
              </div>

              <div className="space-y-2">
                <input
                  type="text"
                  value={joinToken}
                  onChange={(e) => {
                    // Extract token from full URL or accept raw token
                    const val = e.target.value;
                    const match = val.match(/\/join\/([a-z0-9]+)/);
                    setJoinToken(match ? match[1] : val);
                  }}
                  placeholder="Paste invite link or token..."
                  className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 focus:outline-none focus:border-blue-500/40"
                />
                <button
                  onClick={() => {
                    if (!joinToken.trim()) {
                      toast.error("Please enter an invite token");
                      return;
                    }
                    joinMut.mutate({ token: joinToken.trim() });
                  }}
                  disabled={joinMut.isPending || !joinToken.trim()}
                  className="w-full flex items-center justify-center gap-2 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                >
                  {joinMut.isPending ? (
                    <>Joining...</>
                  ) : (
                    <>
                      <ExternalLink className="w-3.5 h-3.5" />
                      Join List
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-white/5 text-[10px] text-white/30 text-center">
          Share target lists with team members via invite links
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
