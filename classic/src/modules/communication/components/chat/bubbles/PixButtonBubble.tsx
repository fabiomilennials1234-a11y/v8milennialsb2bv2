/**
 * PixButtonBubble — renderiza bubble de pagamento PIX enviado via sendPixButton.
 *
 * Para outgoing (nossa instância enviou): mostra valor + chave + label "Tap to pay".
 * Para incoming (resposta paymentResponseMessage): mostra status recebido.
 */
import { QrCode, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  content: string | null;
  rawPayload?: unknown;
  isOutgoing: boolean;
  status?: string | null;
}

function extractPixMeta(raw: unknown): {
  amount?: number;
  pixkey?: string;
  merchant?: string;
} {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, any>;
  return {
    amount: typeof obj.amount === "number" ? obj.amount : undefined,
    pixkey: typeof obj.pixkey === "string" ? obj.pixkey : undefined,
    merchant: typeof obj.merchantName === "string" ? obj.merchantName : undefined,
  };
}

export function PixButtonBubble({
  content,
  rawPayload,
  isOutgoing,
  status,
}: Props) {
  const meta = extractPixMeta(rawPayload);
  const isPaid = status === "paid" || status === "completed";

  return (
    <div
      className={cn(
        "rounded-md border p-3 space-y-2",
        isOutgoing
          ? "bg-primary/5 border-primary/30"
          : "bg-muted/40 border-border/40"
      )}
    >
      <div className="flex items-center gap-2">
        {isPaid ? (
          <CheckCircle2 className="h-5 w-5 text-green-600" />
        ) : (
          <QrCode className="h-5 w-5 text-primary" />
        )}
        <span className="font-medium text-sm">
          {isPaid ? "Pagamento confirmado" : "Cobrança PIX"}
        </span>
      </div>

      {content && <p className="text-sm whitespace-pre-wrap">{content}</p>}

      {meta.amount != null && (
        <div className="text-2xl font-bold text-primary">
          R$ {meta.amount.toFixed(2).replace(".", ",")}
        </div>
      )}

      {meta.merchant && (
        <div className="text-xs text-muted-foreground">
          Recebedor: <span className="font-medium">{meta.merchant}</span>
        </div>
      )}

      {!isPaid && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1 border-t border-border/40">
          <Clock className="h-3 w-3" />
          Aguardando pagamento
        </div>
      )}
    </div>
  );
}
