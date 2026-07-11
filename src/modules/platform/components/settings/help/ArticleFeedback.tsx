import { ThumbsUp, ThumbsDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useArticleFeedback } from "@/modules/platform/hooks/useArticleFeedback";

/**
 * "Este artigo foi útil?" — o voto 👍/👎 do leitor, ao pé do artigo.
 *
 * Um voto por usuário, trocável; o botão do voto atual fica realçado ao reabrir.
 * O campo "o que faltou?" do 👎 é a fatia B2 — aqui só o voto.
 */
export function ArticleFeedback({ articleId }: { articleId: string }) {
  const { myVote, submit, isPending } = useArticleFeedback(articleId);

  return (
    <div className="mt-8 flex items-center justify-between border-t border-border/60 pt-4">
      <span className="text-sm text-muted-foreground">Este artigo foi útil?</span>
      <div className="flex gap-2">
        <button
          type="button"
          aria-label="Foi útil"
          aria-pressed={myVote === true}
          disabled={isPending}
          onClick={() => submit({ helpful: true })}
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
          onClick={() => submit({ helpful: false })}
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
  );
}
