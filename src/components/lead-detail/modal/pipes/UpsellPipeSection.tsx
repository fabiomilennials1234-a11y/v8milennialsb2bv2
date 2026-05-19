import { memo, useState } from "react";
import { ChevronDown, ExternalLink, Briefcase, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useUpsellClientByLeadId } from "@/hooks/useUpsellClientByLeadId";
import { ClientDetailModal } from "@/components/upsell/ClientDetailModal";
import type { PipeProposta } from "@/hooks/usePipePropostas";

interface UpsellPipeSectionProps {
  leadId: string;
  propostaData: PipeProposta | null;
  open: boolean;
  onToggle: () => void;
}

const TIPO_LABEL: Record<string, { label: string; tone: string }> = {
  cliente_atual: { label: "Cliente atual", tone: "bg-green-500/15 text-green-500 border-green-500/30" },
  cliente_recente: { label: "Cliente recente", tone: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
  cliente_antigo: { label: "Cliente antigo", tone: "bg-muted text-muted-foreground border-border" },
  churned: { label: "Churn", tone: "bg-red-500/15 text-red-500 border-red-500/30" },
};

export const UpsellPipeSection = memo(function UpsellPipeSection({
  leadId,
  propostaData,
  open,
  onToggle,
}: UpsellPipeSectionProps) {
  const { data: upsellClient, isLoading } = useUpsellClientByLeadId(leadId);
  const [detailOpen, setDetailOpen] = useState(false);

  const hasClosedSale = propostaData?.status === "vendido";
  const inCarteira = !!upsellClient;

  const statusMeta = upsellClient?.tipo_cliente_tempo
    ? TIPO_LABEL[upsellClient.tipo_cliente_tempo]
    : null;

  return (
    <section
      className={cn(
        "rounded-xl border border-border/40 bg-card overflow-hidden transition-colors",
        open && "ring-1 ring-primary/20",
      )}
      data-testid="upsell-pipe-section"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <Briefcase className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">Carteira</span>
            {!inCarteira && (
              <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">
                Não está na carteira
              </Badge>
            )}
            {statusMeta && (
              <Badge variant="outline" className={cn("text-[10px]", statusMeta.tone)}>
                {statusMeta.label}
              </Badge>
            )}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {isLoading ? (
            <div className="h-16 rounded-lg bg-muted/30 animate-pulse" />
          ) : inCarteira ? (
            <>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="space-y-0.5">
                  <span className="text-muted-foreground">Primeira venda</span>
                  <div className="font-medium">
                    {upsellClient?.first_sale_at
                      ? format(new Date(upsellClient.first_sale_at), "dd/MM/yyyy", { locale: ptBR })
                      : "—"}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <span className="text-muted-foreground">Potencial</span>
                  <div className="font-medium capitalize">{upsellClient?.potencial ?? "—"}</div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 w-full"
                onClick={() => setDetailOpen(true)}
                data-testid="open-client-detail"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Abrir gestão completa
              </Button>
            </>
          ) : (
            <PromoverCta hasClosedSale={hasClosedSale} />
          )}
        </div>
      )}

      {upsellClient && (
        <ClientDetailModal
          open={detailOpen}
          onOpenChange={setDetailOpen}
          clientId={upsellClient.id}
        />
      )}
    </section>
  );
});

function PromoverCta({ hasClosedSale }: { hasClosedSale: boolean }) {
  if (hasClosedSale) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 w-full"
        data-testid="promote-to-carteira-cta"
      >
        <UserPlus className="w-3.5 h-3.5" />
        Promover a Cliente
      </Button>
    );
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block w-full">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 w-full"
              disabled
              data-testid="promote-to-carteira-cta"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Promover a Cliente
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Disponível só quando há venda fechada (status "vendido" no pipe de
          Propostas).
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
