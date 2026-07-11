import { useState } from "react";
import { ThumbsUp, ThumbsDown, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useArticleFeedback } from "@/modules/platform/hooks/useArticleFeedback";

/**
 * "Este artigo foi útil?" — o voto 👍/👎 do leitor, ao pé do artigo.
 *
 * Um voto por usuário, trocável; o botão do voto atual fica realçado ao reabrir.
 *
 * Fatia B2 — motivo do 👎: o voto conta no clique (não espera texto). Um 👎
 * revela um "O que faltou?" opcional; enviar grava o motivo. Trocar pra 👍
 * esconde o campo e o hook limpa o motivo.
 */
export function ArticleFeedback({ articleId }: { articleId: string }) {
  const { myVote, submit, isPending } = useArticleFeedback(articleId);
  const [reason, setReason] = useState("");

  const showReason = myVote === false;

  const handleUp = () => {
    setReason("");
    submit({ helpful: true });
  };

  const handleDown = () => {
    // O voto conta agora; o motivo é um refinamento opcional depois.
    submit({ helpful: false });
  };

  const handleSendReason = () => {
    const trimmed = reason.trim();
    submit({ helpful: false, reason: trimmed || null });
  };

  return (
    <div className="mt-8 border-t border-border/60 pt-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Este artigo foi útil?</span>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Foi útil"
            aria-pressed={myVote === true}
            disabled={isPending}
            onClick={handleUp}
            className={cn(
              "grid h-9 w-10 place-items-center rounded-lg border transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              myVote === true
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <ThumbsUp className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Não foi útil"
            aria-pressed={myVote === false}
            disabled={isPending}
            onClick={handleDown}
            className={cn(
              "grid h-9 w-10 place-items-center rounded-lg border transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              myVote === false
                ? "border-destructive/50 bg-destructive/10 text-destructive"
                : "border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <ThumbsDown className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {showReason && (
        <div className="mt-3 space-y-2">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="O que faltou? (opcional)"
            aria-label="O que faltou?"
            rows={2}
            className="resize-none text-sm"
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={handleSendReason}
              className="gap-1.5"
            >
              <Send className="h-3.5 w-3.5" aria-hidden />
              Enviar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
