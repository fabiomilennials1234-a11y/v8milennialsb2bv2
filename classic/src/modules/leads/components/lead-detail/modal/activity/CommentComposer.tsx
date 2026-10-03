import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Send, Loader2, MessageCirclePlus } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useCreateLeadComment } from "../../hooks/useLeadComments";
import { useAuth } from "@/modules/identity";
import { useTeamMembers } from "@/modules/identity";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CommentComposerProps {
  leadId: string;
  organizationId: string;
}

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 500;

interface DraftEntry { body: string; savedAt: number; }

function draftKey(userId: string | null | undefined, leadId: string): string {
  return `lead-comment-draft:${userId ?? "anon"}:${leadId}`;
}

function readDraft(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as DraftEntry;
    if (!parsed || typeof parsed.body !== "string") return "";
    if (Date.now() - (parsed.savedAt ?? 0) > DRAFT_TTL_MS) {
      window.localStorage.removeItem(key);
      return "";
    }
    return parsed.body;
  } catch { return ""; }
}

function writeDraft(key: string, body: string): void {
  if (typeof window === "undefined") return;
  try {
    if (!body) { window.localStorage.removeItem(key); return; }
    const entry: DraftEntry = { body, savedAt: Date.now() };
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch { /* degrade */ }
}

interface MentionMatch { start: number; query: string; }

function detectMentionPrompt(body: string, cursor: number): MentionMatch | null {
  if (cursor <= 0) return null;
  let i = cursor - 1;
  while (i >= 0) {
    const ch = body[i];
    if (ch === "@") {
      const before = i === 0 ? " " : body[i - 1];
      if (/\s/.test(before) || i === 0) {
        return { start: i, query: body.slice(i + 1, cursor) };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    i -= 1;
  }
  return null;
}

interface MentionRef { userId: string; display: string; }

function deriveMentionsFromBody(body: string, map: Map<string, MentionRef>): string[] {
  const userIds = new Set<string>();
  for (const ref of map.values()) {
    const token = `@${ref.display}`;
    if (body.includes(token)) userIds.add(ref.userId);
  }
  return Array.from(userIds);
}

export const CommentComposer = memo(function CommentComposer({ leadId, organizationId }: CommentComposerProps) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const key = draftKey(userId, leadId);

  const [body, setBody] = useState<string>(() => readDraft(key));
  const [mentionPrompt, setMentionPrompt] = useState<MentionMatch | null>(null);
  const [highlight, setHighlight] = useState(0);
  const create = useCreateLeadComment();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionMap = useRef<Map<string, MentionRef>>(new Map());

  const { data: teamMembers = [] } = useTeamMembers();

  type Member = { id: string; name: string | null; user_id?: string | null };
  const filteredMembers = useMemo(() => {
    if (!mentionPrompt) return [];
    const q = mentionPrompt.query.toLowerCase();
    return (teamMembers as Member[])
      .filter((m) => !!m.name && !!m.user_id)
      .filter((m) => (m.name ?? "").toLowerCase().includes(q))
      .slice(0, 6);
  }, [teamMembers, mentionPrompt]);

  useEffect(() => {
    setBody(readDraft(key));
    mentionMap.current = new Map();
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [key]);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => writeDraft(key, body), SAVE_DEBOUNCE_MS);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [body, key]);

  const onBodyChange = (value: string, cursor: number) => {
    setBody(value);
    setMentionPrompt(detectMentionPrompt(value, cursor));
    setHighlight(0);
  };

  const insertMention = (member: Member) => {
    if (!mentionPrompt || !member.name || !member.user_id) return;
    const before = body.slice(0, mentionPrompt.start);
    const cursor = textareaRef.current?.selectionEnd ?? mentionPrompt.start + 1 + mentionPrompt.query.length;
    const after = body.slice(cursor);
    const token = `@${member.name}`;
    const next = before + token + " " + after;
    mentionMap.current.set(member.name, { userId: member.user_id, display: member.name });
    setBody(next);
    setMentionPrompt(null);
    setHighlight(0);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const pos = (before + token + " ").length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    try {
      const mentions = deriveMentionsFromBody(body, mentionMap.current);
      await create.mutateAsync({ leadId, organizationId, body: trimmed, mentions });
      setBody("");
      mentionMap.current = new Map();
      writeDraft(key, "");
      toast.success("Comentário publicado");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao comentar";
      toast.error(msg);
    }
  };

  return (
    <div className="relative rounded-xl border border-border/40 bg-card/40 focus-within:border-border focus-within:bg-card/60 transition-colors">
      <Textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => onBodyChange(e.target.value, e.target.selectionEnd ?? e.target.value.length)}
        onClick={(e) => {
          const el = e.currentTarget;
          setMentionPrompt(detectMentionPrompt(el.value, el.selectionEnd ?? el.value.length));
        }}
        placeholder="Escreva um comentário…  use @ para mencionar."
        rows={2}
        className="resize-none border-0 bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0 pr-14 pb-9"
        onKeyDown={(e) => {
          if (mentionPrompt && filteredMembers.length > 0) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => (h + 1) % filteredMembers.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => (h - 1 + filteredMembers.length) % filteredMembers.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              insertMention(filteredMembers[highlight]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setMentionPrompt(null);
              return;
            }
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        data-testid="comment-composer-textarea"
      />
      {mentionPrompt && filteredMembers.length > 0 && (
        <div
          className="absolute left-3 bottom-12 z-10 w-60 rounded-lg border border-border/60 bg-popover shadow-lg overflow-hidden"
          data-testid="mention-combobox"
        >
          {filteredMembers.map((m, i) => (
            <button
              key={m.id}
              type="button"
              className={cn(
                "w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50",
                i === highlight && "bg-primary/10 text-primary",
              )}
              onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
              data-testid={`mention-option-${m.user_id}`}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
      <div className="absolute left-3 bottom-2 flex items-center gap-1 text-[10px] text-muted-foreground/50">
        <MessageCirclePlus className="w-3 h-3" />
        <span>⌘/Ctrl + Enter para publicar</span>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="absolute right-2 bottom-2 h-8 w-8 hover:bg-primary/10 hover:text-primary"
        onClick={submit}
        disabled={!body.trim() || create.isPending}
        aria-label="Publicar comentário"
      >
        {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
      </Button>
    </div>
  );
});
