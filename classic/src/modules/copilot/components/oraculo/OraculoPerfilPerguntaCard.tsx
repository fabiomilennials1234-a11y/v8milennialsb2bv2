import { useState } from "react";
import { Check, Loader2, MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { OraculoPerguntaPerfil } from "../../hooks/useOraculoTurno";

interface Props {
  question: OraculoPerguntaPerfil;
  onAnswer: (questionId: string, answer: string) => void;
  onSkip: (questionId: string) => void;
  busy: boolean;
}

export function OraculoPerfilPerguntaCard({ question, onAnswer, onSkip, busy }: Props) {
  const [answer, setAnswer] = useState("");

  if (question.status === "answered") {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5 text-primary" />
        Perfil atualizado. Você pode revisar em Configurações.
      </div>
    );
  }
  if (question.status === "skipped") return null;

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-primary/25 bg-background/70 p-3 shadow-sm">
      <div className="flex gap-2">
        <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-primary">
            Confirme a medição
          </p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">{question.prompt}</p>
        </div>
      </div>
      <Textarea
        aria-label="Sua resposta sobre a operação"
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        placeholder="Conte o que acontece na prática…"
        rows={2}
        maxLength={2000}
        disabled={busy}
        className="min-h-[64px] resize-none bg-background text-xs"
      />
      {question.error && <p className="text-[11px] text-destructive">{question.error}</p>}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onSkip(question.id)}>
          Agora não
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy || !answer.trim()}
          onClick={() => onAnswer(question.id, answer.trim())}
        >
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Responder
        </Button>
      </div>
    </div>
  );
}
