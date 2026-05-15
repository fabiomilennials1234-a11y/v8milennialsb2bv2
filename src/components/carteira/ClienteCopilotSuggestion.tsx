import { useState } from "react";
import { Copy, MessageCircle, Sparkles, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDateLong } from "@/lib/format";
import { toast } from "@/components/ui/use-toast";
import { useRetentionSuggestion, useGenerateRetentionSuggestion } from "@/hooks/useRetentionSuggestion";
import type { Tables } from "@/integrations/supabase/types";

interface ClienteCopilotSuggestionProps {
  clientId?: string;
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

  const handleWhatsApp = () => {
    if (!phone) return;
    const clean = phone.replace(/\D/g, "");
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/${clean}?text=${encoded}`, "_blank");
  };

  const handleGenerate = () => {
    if (!clientId) return;
    generateMutation.mutate(clientId, {
      onError: () => {
        toast({ title: "Erro ao gerar sugestão", description: "Tente novamente em alguns instantes.", variant: "destructive" });
      },
    });
  };

  const generating = generateMutation.isPending;

  return (
    <Card className={cn(
      "relative overflow-hidden border",
      isAI
        ? "border-[hsl(47_100%_50%/0.3)] bg-zinc-900"
        : "border-[hsl(47_100%_50%/0.2)] bg-zinc-900",
    )}>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[hsl(47_100%_50%/0.6)] to-transparent" />

      <CardContent className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[hsl(47_100%_50%/0.15)]">
              <Sparkles size={13} className="text-[hsl(47_100%_60%)]" />
            </div>
            <span className="text-xs font-semibold text-zinc-300">
              {isAI ? "Sugestão IA" : "Sugestão Copilot"}
            </span>
            {actionType && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[hsl(47_100%_50%/0.15)] text-[hsl(47_100%_60%)]">
                {ACTION_LABELS[actionType] ?? actionType}
              </span>
            )}
          </div>
          {clientId && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-zinc-500 hover:text-zinc-200"
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
          <div className="flex items-center gap-2 py-4 justify-center text-xs text-zinc-500">
            <Loader2 size={14} className="animate-spin" />
            Analisando contexto do cliente...
          </div>
        ) : (
          <>
            <p className="text-sm text-zinc-300 leading-relaxed bg-zinc-800/60 rounded-lg px-3 py-2.5 border border-zinc-700/50">
              {message}
            </p>

            {isAI && aiSuggestion.reasoning && (
              <button
                onClick={() => setShowReasoning(!showReasoning)}
                className="text-[10px] text-zinc-500 hover:text-zinc-400 text-left transition-colors"
              >
                {showReasoning ? "Ocultar raciocínio" : "Ver raciocínio da IA"}
              </button>
            )}
            {showReasoning && aiSuggestion?.reasoning && (
              <p className="text-[11px] text-zinc-500 leading-relaxed bg-zinc-800/30 rounded px-2.5 py-2 border border-zinc-800">
                {aiSuggestion.reasoning}
              </p>
            )}
          </>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1.5 border-zinc-700 hover:bg-zinc-800 text-xs h-8"
            onClick={handleCopy}
            disabled={generating}
          >
            <Copy size={12} />
            Copiar
          </Button>
          <Button
            size="sm"
            className={cn(
              "flex-1 gap-1.5 text-xs h-8 font-semibold",
              phone && !generating
                ? "bg-[hsl(47_100%_50%)] hover:bg-[hsl(47_100%_45%)] text-black"
                : "bg-zinc-800 text-zinc-500 cursor-not-allowed",
            )}
            onClick={handleWhatsApp}
            disabled={!phone || generating}
          >
            <MessageCircle size={12} />
            Enviar via WhatsApp
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
