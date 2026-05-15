import { Copy, MessageCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDateLong } from "@/lib/format";
import { toast } from "@/components/ui/use-toast";
import type { Tables } from "@/integrations/supabase/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClienteCopilotSuggestionProps {
  clientName: string;
  phone: string | null;
  alerts: Tables<"client_alerts">[];
  lastOrder: Tables<"upsell_orders"> | null;
  nextOrderExpected: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const daysSince = (iso: string | null): number => {
  if (!iso) return 0;
  return Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
};

function buildSuggestion(
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

// ─── Component ───────────────────────────────────────────────────────────────

export function ClienteCopilotSuggestion({
  clientName,
  phone,
  alerts,
  lastOrder,
  nextOrderExpected,
}: ClienteCopilotSuggestionProps) {
  const message = buildSuggestion(clientName, alerts, lastOrder, nextOrderExpected);

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

  return (
    <Card className={cn(
      "relative overflow-hidden border",
      "border-[hsl(47_100%_50%/0.2)] bg-zinc-900",
    )}>
      {/* Gold gradient accent line */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[hsl(47_100%_50%/0.6)] to-transparent" />

      <CardContent className="p-4 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[hsl(47_100%_50%/0.15)]">
            <Sparkles size={13} className="text-[hsl(47_100%_60%)]" />
          </div>
          <span className="text-xs font-semibold text-zinc-300">Sugestão Copilot</span>
        </div>

        {/* Message preview */}
        <p className="text-sm text-zinc-300 leading-relaxed bg-zinc-800/60 rounded-lg px-3 py-2.5 border border-zinc-700/50">
          {message}
        </p>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1.5 border-zinc-700 hover:bg-zinc-800 text-xs h-8"
            onClick={handleCopy}
          >
            <Copy size={12} />
            Copiar
          </Button>
          <Button
            size="sm"
            className={cn(
              "flex-1 gap-1.5 text-xs h-8 font-semibold",
              phone
                ? "bg-[hsl(47_100%_50%)] hover:bg-[hsl(47_100%_45%)] text-black"
                : "bg-zinc-800 text-zinc-500 cursor-not-allowed",
            )}
            onClick={handleWhatsApp}
            disabled={!phone}
          >
            <MessageCircle size={12} />
            Enviar via WhatsApp
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
