/**
 * Estado de thread que NÃO carregou — o que antes caía em `ChatEmptyState`.
 *
 * ── Por que este componente existe ──
 * A thread é `SELECT` direto em `whatsapp_messages`; a LISTA vem da RPC
 * `get_whatsapp_conversation_list`, que é `SECURITY DEFINER` e lê
 * `whatsapp_conversation_summary`. Dois caminhos, duas tabelas, dois controles
 * de acesso — então "a lista mostra a conversa e a thread vem vazia" é um
 * estado ALCANÇÁVEL, e não uma impossibilidade lógica.
 *
 * Até aqui a tela respondia a esse estado com "Comece a conversa / Primeira
 * interação com X". Isso é uma afirmação FALSA sempre que a lista já mostrou
 * uma última mensagem para o mesmo contato — e falsa do jeito pior, porque
 * convida o operador a remandar algo que o cliente já recebeu.
 *
 * Duas causas, mesma aparência, por isso os dois motivos:
 *   `error`        — a query falhou (RLS, PostgREST, rede). `isError` do
 *                    react-query NUNCA era lido: o `data = []` do default
 *                    virava "conversa nova".
 *   `inconsistent` — a query voltou 0 linhas SEM erro, mas o contato tem
 *                    `last_message_time`. Negativa de RLS devolve zero linhas,
 *                    não erro; `.in("instance_id", …)` não casa `NULL`, e há
 *                    385.828 linhas órfãs em prod (2026-08-10). Nos dois casos
 *                    a mensagem existe e a tela não a alcança.
 */
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ChatThreadUnavailableReason = "error" | "inconsistent";

interface ChatThreadUnavailableProps {
  reason: ChatThreadUnavailableReason;
  contactName: string;
  onRetry: () => void;
  isRetrying?: boolean;
}

const COPY: Record<
  ChatThreadUnavailableReason,
  { title: string; body: (contact: string) => string }
> = {
  error: {
    title: "Não consegui carregar o histórico",
    body: (contact) =>
      `A conversa com ${contact} existe, mas a busca das mensagens falhou. Nada foi perdido — as mensagens seguem no banco.`,
  },
  inconsistent: {
    title: "Histórico indisponível nesta caixa",
    body: (contact) =>
      `A lista registra mensagens com ${contact}, mas nenhuma foi encontrada nesta caixa. Isso NÃO é uma conversa nova — não remande o que o cliente já recebeu.`,
  },
};

export function ChatThreadUnavailable({
  reason,
  contactName,
  onRetry,
  isRetrying = false,
}: ChatThreadUnavailableProps) {
  const copy = COPY[reason];

  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center py-16 px-6 text-center"
    >
      <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
        <AlertTriangle
          className="w-8 h-8 text-destructive/70"
          strokeWidth={1.5}
        />
      </div>
      <h3 className="text-base font-semibold mb-1.5">{copy.title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm leading-relaxed mb-5">
        {copy.body(contactName)}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        disabled={isRetrying}
      >
        <RefreshCw
          className={`w-4 h-4 mr-2 ${isRetrying ? "animate-spin" : ""}`}
        />
        Tentar de novo
      </Button>
    </div>
  );
}
