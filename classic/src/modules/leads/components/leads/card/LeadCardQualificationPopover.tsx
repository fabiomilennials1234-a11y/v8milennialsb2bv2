import { memo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useUpdateLead } from "@/modules/leads/hooks/useLeads";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import { useLeadActionGates } from "../../lead-detail/hooks/useLeadActionGates";
import { QUALIFICATION_TIERS, type QualificationTier } from "../../lead-detail/modal/types";
import { QUALIFICATION_TIER_CONFIG } from "../../lead-detail/modal/qualification-config";
import { LeadCardAvatar } from "./LeadCardAvatar";

/**
 * Qualificar PELO CARD, sem abrir a ficha.
 *
 * No print do DataCrazy o símbolo do canto — onde o concorrente põe o `#1` —
 * é um BOTÃO. No produto ele era uma `<div role="img">` inerte
 * (`LeadCardAvatar.tsx:42-51`): o dado aparecia, mas mudar exigia abrir a
 * ficha do lead. Num board de 30 cards isso é a diferença entre qualificar a
 * coluna inteira e não qualificar nenhum.
 *
 * São DOIS campos independentes, não um só — e é por isso que o menu tem dois
 * blocos:
 *   `pre_qualification_tier` = pré-venda/SDR  → metade ESQUERDA do símbolo
 *   `qualification_tier`     = venda          → metade DIREITA
 * Quando os dois batem, o símbolo vira um ícone inteiro (`isUnified` em
 * `LeadCardAvatar`); quando divergem, aparece a divisória. Metade vazia
 * desenha `?`, que é o convite a qualificar.
 *
 * Clicar no tier JÁ MARCADO limpa o campo — mesmo gesto do `QualificationSlot`
 * da ficha (`handleSelect`: `next === current ? null : next`). Sem isso não
 * haveria como desqualificar sem sair do card.
 *
 * A permissão é a mesma da ficha: `useLeadActionGates(leadId).canEditField`.
 * O card não inventa regra própria — se o usuário não pode editar o campo na
 * ficha, o gatilho aqui nasce desabilitado.
 */

interface LeadCardQualificationPopoverProps {
  leadId: string;
  preQualTier?: QualificationTier | null;
  qualTier?: QualificationTier | null;
  name?: string | null;
  size?: number;
  className?: string;
}

const BLOCOS = [
  { campo: "pre_qualification_tier", titulo: "Pré-qualificação", ajuda: "Pré-venda · SDR" },
  { campo: "qualification_tier", titulo: "Qualificação", ajuda: "Venda" },
] as const;

export const LeadCardQualificationPopover = memo(function LeadCardQualificationPopover({
  leadId,
  preQualTier,
  qualTier,
  name,
  size = 22,
  className,
}: LeadCardQualificationPopoverProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const updateLead = useUpdateLead();
  const logAction = useLogLeadAction();
  const { canEditField } = useLeadActionGates(leadId);
  const negado = !canEditField.allowed;

  const atual = (campo: (typeof BLOCOS)[number]["campo"]) =>
    campo === "pre_qualification_tier" ? preQualTier ?? null : qualTier ?? null;

  const escolher = async (
    campo: (typeof BLOCOS)[number]["campo"],
    titulo: string,
    tier: QualificationTier | null,
  ) => {
    // Clicar no que já está marcado LIMPA — igual ao QualificationSlot da ficha.
    const valor = tier === atual(campo) ? null : tier;
    await updateLead.mutateAsync(
      { id: leadId, [campo]: valor } as Parameters<typeof updateLead.mutateAsync>[0],
    );
    /**
     * O `useUpdateLead` invalida `["leads"]` e `["pipeline_entries"]` — mas o
     * BOARD não lê de nenhuma das duas: ele lê da RPC `get_pipeline_page`, sob
     * a chave `["pipeline-page", …]` (usePaginatedPipeline.ts:181). Sem esta
     * linha o valor grava no banco e o card continua mostrando o símbolo
     * antigo até alguém recarregar a página — medido, não suposto.
     *
     * As chaves vão como string em vez de importar `invalidateAfterMove` do
     * módulo `pipelines`: esse import reabriria o ciclo leads↔pipelines que o
     * dependency-cruiser barra.
     */
    queryClient.invalidateQueries({ queryKey: ["pipeline-page"] });
    queryClient.invalidateQueries({ queryKey: ["pipeline-stage-counts"] });

    const rotulo = valor ? QUALIFICATION_TIER_CONFIG[valor].label : "Nenhum";
    logAction({ leadId, action: "field_updated", description: `${titulo} alterado para "${rotulo}"` });
    toast.success(`${titulo}: ${rotulo}`);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={negado}
          // dnd-kit: não iniciar arrasto ao abrir o popover.
          onPointerDown={(e) => e.stopPropagation()}
          // O card inteiro tem onClick → abre a ficha. Sem isto, um clique aqui
          // abriria o popover E a ficha por cima dele.
          onClick={(e) => e.stopPropagation()}
          aria-label="Qualificação do lead"
          className={cn(
            "shrink-0 rounded-full transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
            negado ? "cursor-default opacity-70" : "cursor-pointer hover:brightness-125",
            className,
          )}
        >
          <LeadCardAvatar preQualTier={preQualTier} qualTier={qualTier} name={name} size={size} />
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        collisionPadding={8}
        className="w-56 p-1.5"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
      >
        {BLOCOS.map((bloco, i) => {
          const marcado = atual(bloco.campo);
          return (
            <div key={bloco.campo} className={cn(i > 0 && "mt-1.5 border-t border-border/50 pt-1.5")}>
              <div className="flex items-baseline justify-between px-1.5 pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {bloco.titulo}
                </span>
                <span className="text-[9px] text-muted-foreground/60">{bloco.ajuda}</span>
              </div>
              <div className="flex flex-col">
                {QUALIFICATION_TIERS.map((tier) => {
                  const cfg = QUALIFICATION_TIER_CONFIG[tier];
                  const Icone = cfg.icon;
                  const ativo = marcado === tier;
                  return (
                    <button
                      key={tier}
                      type="button"
                      disabled={negado || updateLead.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        void escolher(bloco.campo, bloco.titulo, tier);
                      }}
                      className={cn(
                        "flex items-center gap-2 rounded px-1.5 py-1 text-left text-[11.5px] transition-colors",
                        "disabled:opacity-50",
                        ativo ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/60",
                      )}
                    >
                      {/* `colorClass` é classe Tailwind (text-cyan-300, …), não hex. */}
                      {Icone && <Icone className={cn("size-[13px] shrink-0", cfg.colorClass)} />}
                      <span className="flex-1 truncate">{cfg.label}</span>
                      {/* Dizer que clicar de novo limpa — senão ninguém descobre. */}
                      {ativo && <span className="text-[9px] text-muted-foreground/70">clique p/ limpar</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
});
