import { memo, useState } from "react";
import { Plus, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { QUALIFICATION_TIERS, type QualificationTier } from "../lead-detail/modal/types";
import { QUALIFICATION_TIER_CONFIG } from "../lead-detail/modal/qualification-config";

/**
 * Qualificação **do negócio** — a nota desta oportunidade.
 *
 * Distinta da pré-qualificação, que vive no modal do lead e qualifica a PESSOA:
 *
 *   pré-qualificação → "vale a pena falar com esta pessoa?"   `leads`
 *   qualificação     → "esta oportunidade é boa?"             `deals`
 *
 * Um lead com três negócios tem uma pré-qualificação e pode ter três notas
 * diferentes — a reposição trimestral é ouro, o teste de amostra é bronze.
 * Enquanto as duas dividiam a coluna do lead, avaliar o segundo apagava o
 * primeiro.
 *
 * ⚠ ISTO NÃO MEXE EM `leads.qualification_tier`, e é de propósito: quatro
 * medidas do motor leem aquela coluna (`leads_avaliados`, `leads_nao_avaliados`,
 * `boas_avaliacoes`, `taxa_qualidade`). Repontá-las para o negócio muda o
 * número delas e é decisão de produto, não efeito colateral de um popover.
 *
 * Mesma paleta e mesmo vocabulário do slot da pessoa — duas escalas para a
 * mesma ideia obrigariam o vendedor a aprender duas.
 */

interface DealQualificationSlotProps {
  /** `deals.id`. Ausente = card ainda sem negócio; o slot fica desabilitado. */
  dealId: string | null;
  leadId: string;
  current: QualificationTier | null;
  /** Gate de permissão do modal — o mesmo que governa os outros campos. */
  locked?: boolean;
}

export const DealQualificationSlot = memo(function DealQualificationSlot({
  dealId,
  leadId,
  current,
  locked = false,
}: DealQualificationSlotProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const gravar = useMutation({
    mutationFn: async (tier: QualificationTier | null) => {
      if (!dealId) throw new Error("Este card ainda não tem negócio.");
      const { error } = await supabase
        .from("deals")
        // Coluna nasce na migration 20270813120000, que ainda não está em
        // produção — `types.ts` é gerado a partir de PROD e não a conhece. A
        // diretiva se auto-remove quando o apply e o `gen types` acontecerem.
        // @ts-expect-error coluna ausente de types.ts até o apply em produção
        .update({ qualification_tier: tier })
        .eq("id", dealId);
      if (error) throw new Error(error.message);
      return tier;
    },
    onSuccess: (tier) => {
      // A lista de negócios do lead é quem carrega a nota — invalidar ela é o
      // que faz o popover e o card concordarem sem recarregar a página.
      void queryClient.invalidateQueries({ queryKey: ["leads-deals"] });
      void queryClient.invalidateQueries({ queryKey: ["lead-detail", leadId] });
      toast.success(
        tier ? `Qualificação do negócio: ${QUALIFICATION_TIER_CONFIG[tier].label}` : "Qualificação removida",
      );
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível qualificar"),
  });

  const config = current ? QUALIFICATION_TIER_CONFIG[current] : null;
  const Icon = config?.icon;
  const desabilitado = locked || !dealId || gravar.isPending;

  return (
    <Popover open={open} onOpenChange={(o) => !desabilitado && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={desabilitado}
          data-testid="deal-qualification"
          aria-label={
            !dealId
              ? "Qualificação do negócio — indisponível: card sem negócio"
              : `Qualificação do negócio${current ? `: ${config?.label}` : " — avaliar"}`
          }
          title={
            !dealId
              ? "Este card ainda não virou negócio"
              : `Qualificação do negócio${config ? `: ${config.label}` : ""}`
          }
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-full border px-2.5 shrink-0 transition-all",
            config
              ? cn(config.bgClass, config.borderClass, "hover:scale-[1.03]")
              : "border-dashed border-border/60 hover:border-primary/60 hover:bg-primary/5",
            desabilitado && "cursor-not-allowed opacity-50 hover:scale-100",
          )}
        >
          {Icon ? (
            <Icon className={cn("h-3.5 w-3.5", config?.colorClass)} />
          ) : (
            <Plus className="h-3.5 w-3.5 text-muted-foreground/70" />
          )}
          <span className={cn("text-[11px] font-semibold", config?.colorClass)}>
            {config?.label ?? "Qualificar"}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-52 p-1.5">
        <div className="space-y-0.5">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Qualificação do negócio
          </div>
          {QUALIFICATION_TIERS.map((tier) => {
            const c = QUALIFICATION_TIER_CONFIG[tier];
            const TierIcon = c.icon;
            return (
              <button
                key={tier}
                type="button"
                onClick={() => gravar.mutate(tier === current ? null : tier)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-muted",
                  current === tier && "bg-muted",
                )}
              >
                <TierIcon className={cn("h-3.5 w-3.5", c.colorClass)} />
                <span>{c.label}</span>
              </button>
            );
          })}
          {current && (
            <button
              type="button"
              onClick={() => gravar.mutate(null)}
              className="mt-1 flex w-full items-center gap-2 rounded border-t border-border/40 px-2 py-1.5 pt-2 text-xs text-destructive hover:bg-destructive/10"
            >
              <X className="h-3.5 w-3.5" /> Remover
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
});
