import { useState } from "react";
import { Copy, MessageCircle, Sparkles, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
import { formatDateLong } from "@/lib/format";
import { toast } from "@/components/ui/use-toast";
import { useRetentionSuggestion, useGenerateRetentionSuggestion } from "@/modules/carteira/hooks/useRetentionSuggestion";
import type { Tables } from "@/integrations/supabase/types";
import { IconChip } from "@/components/ui/bento";
import { notifyError } from "@/shared/errors";

interface ClienteCopilotSuggestionProps {
  clientId?: string;
  /** Lead vinculado ao cliente. Sem ele não há Conversa do Lead a abrir. */
  leadId?: string | null;
  clientName: string;
  phone: string | null;
  alerts: Tables<"client_alerts">[];
  lastOrder: Tables<"upsell_orders"> | null;
  nextOrderExpected: string | null;
}

const daysSince = (iso: string | null): number => {
  if (!iso) return 0;
  return Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
};

function buildFallbackSuggestion(
  clientName: string,
  alerts: Tables<"client_alerts">[],
  lastOrder: Tables<"upsell_orders"> | null,
  nextOrderExpected: string | null,
): string {
  const firstName = clientName.split(" ")[0];
  const overdueAlert = alerts.find((a) => a.alert_type === "reorder_overdue");
  const decliningAlert = alerts.find((a) => a.alert_type === "ticket_declining");

  if (overdueAlert) {
    const productName = lastOrder?.product_name ?? "seu produto";
    const days = lastOrder?.sold_at ? daysSince(lastOrder.sold_at) : null;
    const daysText = days ? ` há ${days} dias` : "";
    return `Olá ${firstName}! Vi que seu último pedido de ${productName} foi${daysText}. Gostaria de repetir o pedido? Posso verificar disponibilidade agora mesmo.`;
  }

  if (decliningAlert) {
    return `Olá ${firstName}! Notamos que os últimos pedidos tiveram um valor menor que o habitual. Podemos ajudar com condições especiais ou montar um pedido completo para você?`;
  }

  const nextDate = formatDateLong(nextOrderExpected);
  return `Tudo certo com ${firstName}! Próximo pedido previsto para ${nextDate}. Posso adiantar o contato ou aguardar a data?`;
}

const ACTION_LABELS: Record<string, string> = {
  follow_up: "Follow-up",
  offer: "Oferta especial",
  escalate: "Escalar",
  reactivate: "Reativação",
  upsell: "Upsell",
};

export function ClienteCopilotSuggestion({
  clientId,
  leadId,
  clientName,
  phone,
  alerts,
  lastOrder,
  nextOrderExpected,
}: ClienteCopilotSuggestionProps) {
  const { data: aiSuggestion, isLoading: loadingCached } = useRetentionSuggestion(clientId);
  const generateMutation = useGenerateRetentionSuggestion();
  const [showReasoning, setShowReasoning] = useState(false);

  const isAI = !!aiSuggestion;
  const message = aiSuggestion?.message ?? buildFallbackSuggestion(clientName, alerts, lastOrder, nextOrderExpected);
  const actionType = aiSuggestion?.action_type;

  const handleCopy = () => {
    navigator.clipboard.writeText(message);
    toast({ title: "Mensagem copiada!", description: "Cole no WhatsApp ou onde preferir." });
  };

  const handleGenerate = () => {
    if (!clientId) return;
    generateMutation.mutate(clientId, {
      onError: (error: unknown) => {
        notifyError(error, { fallback: "Não foi possível gerar sugestão." });
      },
    });
  };

  const generating = generateMutation.isPending;

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconChip icon={Sparkles} tone="gold" />
            <span className="text-[15px] font-bold tracking-[-0.02em] text-card-foreground">
              {isAI ? "Sugestão IA" : "Sugestão Copilot"}
            </span>
            {actionType && (
              <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10.5px] font-semibold text-primary-soft-foreground">
                {ACTION_LABELS[actionType] ?? actionType}
              </span>
            )}
          </div>
          {clientId && (
            <Button
              size="icon"
              variant="ghost"
              aria-label="Gerar sugestão IA"
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
              onClick={handleGenerate}
              disabled={generating || loadingCached}
              title="Gerar sugestão IA"
            >
              {generating ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
            </Button>
          )}
        </div>

        {generating ? (
          <div className="flex items-center gap-2 py-4 justify-center text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Analisando contexto do cliente...
          </div>
        ) : (
          <>
            <p className="rounded-xl bg-sunken px-3.5 py-3 text-sm leading-relaxed text-card-foreground">
              {message}
            </p>

            {isAI && aiSuggestion.reasoning && (
              <button
                onClick={() => setShowReasoning(!showReasoning)}
                className="text-left text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                {showReasoning ? "Ocultar raciocínio" : "Ver raciocínio da IA"}
              </button>
            )}
            {showReasoning && aiSuggestion?.reasoning && (
              <p className="rounded-xl border border-border/70 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                {aiSuggestion.reasoning}
              </p>
            )}
          </>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-9 flex-1 gap-1.5 text-xs"
            onClick={handleCopy}
            disabled={generating}
          >
            <Copy size={12} />
            Copiar
          </Button>
          {/* A sugestão vai como DRAFT no composer, nunca como mensagem enviada
              (decisão 10 da spec): texto de IA que sai sem o vendedor reler é
              como sugestão vira erro em cliente real.
              Exige `leadId`: cliente de carteira sem lead vinculado não tem
              Conversa do Lead, e aí o botão não aparece. */}
          {leadId && (
            <AbrirConversaButton
              leadId={leadId}
              phone={phone}
              draft={message}
              size="sm"
              variant="ink"
              disabled={!phone || generating}
              className="h-9 flex-1 gap-1.5 text-xs"
            >
              <MessageCircle size={12} />
              Abrir com a sugestão
            </AbrirConversaButton>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
