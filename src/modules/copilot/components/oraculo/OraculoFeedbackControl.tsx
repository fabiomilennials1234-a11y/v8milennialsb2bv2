import { useId, useState } from "react";
import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export type OraculoFeedbackReason =
  | "wrong_number"
  | "misunderstood"
  | "too_obvious"
  | "not_actionable"
  | "invented";

export interface OraculoFeedbackValue {
  rating: "positive" | "negative";
  reason?: OraculoFeedbackReason | null;
  comment?: string | null;
}

const REASONS: Array<{ value: OraculoFeedbackReason; label: string }> = [
  { value: "wrong_number", label: "Número errado" },
  { value: "misunderstood", label: "Não entendeu" },
  { value: "too_obvious", label: "Óbvio demais" },
  { value: "not_actionable", label: "Não sei o que fazer com isso" },
  { value: "invented", label: "Inventou algo" },
];

interface Props {
  label: "esta resposta" | "esta conversa";
  value?: OraculoFeedbackValue | null;
  busy: boolean;
  onSubmit(value: OraculoFeedbackValue): void;
}

export function OraculoFeedbackControl({ label, value, busy, onSubmit }: Props) {
  const groupId = useId();
  const [negativeOpen, setNegativeOpen] = useState(false);
  const [reason, setReason] = useState<OraculoFeedbackReason | null>(null);
  const [comment, setComment] = useState("");

  if (value) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Check className="size-3" /> Feedback enviado
      </p>
    );
  }

  if (!negativeOpen) {
    return (
      <div className="flex items-center gap-1" aria-label={`Avaliar ${label}`}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label={label === "esta resposta" ? "Resposta útil" : "Conversa útil"}
          disabled={busy}
          onClick={() => onSubmit({ rating: "positive" })}
        >
          <ThumbsUp className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label={label === "esta resposta" ? "Resposta não ajudou" : "Conversa não ajudou"}
          disabled={busy}
          onClick={() => setNegativeOpen(true)}
        >
          <ThumbsDown className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-border/70 bg-background/70 p-3">
      <p className="text-xs font-medium">O que falhou n{label === "esta resposta" ? "esta resposta" : "esta conversa"}?</p>
      <div className="flex flex-wrap gap-1.5">
        {REASONS.map((item) => (
          <label
            key={item.value}
            className="cursor-pointer rounded-full border border-border px-2.5 py-1 text-[11px] has-[:checked]:border-primary has-[:checked]:bg-primary/10"
          >
            <input
              className="sr-only"
              type="radio"
              name={`feedback-${groupId}`}
              value={item.value}
              checked={reason === item.value}
              onChange={() => setReason(item.value)}
            />
            {item.label}
          </label>
        ))}
      </div>
      <Textarea
        aria-label="Detalhe opcional"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        maxLength={2000}
        rows={2}
        placeholder="Contexto opcional"
        className="min-h-16 resize-none text-xs"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setNegativeOpen(false)} disabled={busy}>
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!reason || busy}
          onClick={() => reason && onSubmit({
            rating: "negative",
            reason,
            ...(comment.trim() ? { comment: comment.trim() } : {}),
          })}
        >
          Enviar avaliação
        </Button>
      </div>
    </div>
  );
}
