import { memo, useEffect, useRef, useState } from "react";
import { Send, Loader2, MessageCirclePlus } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useCreateLeadComment } from "../../hooks/useLeadComments";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface CommentComposerProps {
  leadId: string;
  organizationId: string;
}

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SAVE_DEBOUNCE_MS = 500;

interface DraftEntry {
  body: string;
  savedAt: number;
}

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
  } catch {
    return "";
  }
}

function writeDraft(key: string, body: string): void {
  if (typeof window === "undefined") return;
  try {
    if (!body) {
      window.localStorage.removeItem(key);
      return;
    }
    const entry: DraftEntry = { body, savedAt: Date.now() };
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // localStorage cheio / desabilitado — degrada sem falhar.
  }
}

export const CommentComposer = memo(function CommentComposer({ leadId, organizationId }: CommentComposerProps) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const key = draftKey(userId, leadId);

  const [body, setBody] = useState<string>(() => readDraft(key));
  const create = useCreateLeadComment();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore draft when the active key changes (switching leads or users).
  useEffect(() => {
    setBody(readDraft(key));
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [key]);

  // Debounced save on every keystroke.
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => writeDraft(key, body), SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [body, key]);

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    try {
      await create.mutateAsync({ leadId, organizationId, body: trimmed });
      setBody("");
      writeDraft(key, ""); // limpa draft imediatamente após sucesso
      toast.success("Comentário publicado");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao comentar";
      toast.error(msg);
    }
  };

  return (
    <div className="relative rounded-xl border border-border/40 bg-card/40 focus-within:border-border focus-within:bg-card/60 transition-colors">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Escreva um comentário…  acompanha o lead em toda a jornada."
        rows={2}
        className="resize-none border-0 bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0 pr-14 pb-9"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        data-testid="comment-composer-textarea"
      />
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
