import { memo, useState } from "react";
import { Send, Loader2, MessageCirclePlus } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useCreateLeadComment } from "../../hooks/useLeadComments";
import { toast } from "sonner";

interface CommentComposerProps {
  leadId: string;
  organizationId: string;
}

export const CommentComposer = memo(function CommentComposer({ leadId, organizationId }: CommentComposerProps) {
  const [body, setBody] = useState("");
  const create = useCreateLeadComment();

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    try {
      await create.mutateAsync({ leadId, organizationId, body: trimmed });
      setBody("");
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
