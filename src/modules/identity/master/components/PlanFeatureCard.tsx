/**
 * PlanFeatureCard — card de toggle de feature.
 *
 * Usado em DOIS contextos, e é a prop `delta` que os separa:
 *
 *   - editor de PLANO (PlanEditor): não existe "plano base" contra o qual
 *     comparar, então `delta` não é passado e o card se comporta como sempre;
 *   - montagem de PROPOSTA (SCRUM-288): existe base, e o card marca o que foi
 *     concedido a mais ou retirado a menos.
 *
 * A DIREÇÃO É O SINAL, NÃO O TIPO (decisão do Prisma). Feature ligada a mais e
 * limite acima do base usam o MESMO amarelo; feature desligada e limite abaixo
 * usam o MESMO prateado. Dois pesos para três eixos: o operador aprende
 * "amarelo = você deu mais" em vez de decorar seis casos.
 *
 * Por que "a mais" pesa mais que "a menos": não é que conceder seja perigoso em
 * abstrato — é que o operador SABE o que está tirando, porque o cliente
 * reclama. O que escapa dele é o que ACRESCENTOU, porque conceder parece
 * generoso e sem custo no momento. E aqui feature ligada também é PERMISSÃO
 * concedida, então "a mais" é superfície de segurança, não só de preço.
 *
 * Ouro não entra em nenhum dos dois: ouro é dinheiro e ação primária, e gastá-lo
 * aqui apagaria o sinal onde ele importa.
 */

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  Zap, GitBranch, Wrench, Fuel, DollarSign, Trophy, BarChart2, Package,
  Tv, Bot, MousePointer, Sparkles, Send, Code, Palette, Phone,
  ArrowUp, ArrowDown, RotateCcw,
} from "lucide-react";
import type { FeatureMeta } from "@/modules/platform/lib/feature-registry";
import type { Direction } from "@/modules/billing/lib/package-diff";

const ICON_MAP: Record<string, React.ElementType> = {
  Zap, GitBranch, Wrench, Fuel, DollarSign, Trophy, BarChart2, Package,
  Tv, Bot, MousePointer, Sparkles, Send, Code, Palette, Phone,
};

interface PlanFeatureCardProps {
  feature: FeatureMeta;
  enabled: boolean;
  onToggle: (key: string, value: boolean) => void;
  /**
   * Diferença vs plano base. Ausente = editor de plano, que não tem base.
   *
   * O tipo vem do módulo compartilhado, não daqui: `PlanLimitRow` usa o MESMO
   * vocabulário, e dois enums paralelos para a mesma ideia divergem no primeiro
   * estado novo — foi o que quase aconteceu com o comparador.
   */
  delta?: Direction;
}

export function PlanFeatureCard({ feature, enabled, onToggle, delta }: PlanFeatureCardProps) {
  // O catálogo gerado admite feature sem ícone; o fallback cobre esse caso e o de um nome
  // de ícone que não está no mapa.
  const Icon = ICON_MAP[feature.icon ?? ""] ?? Zap;

  return (
    <div
      className={cn(
        // A borda esquerda de 3px existe SEMPRE, transparente quando não há
        // marca. Sem isso o conteúdo desloca 3px no instante em que a feature
        // vira diferença, e a lista inteira treme ao mexer num switch.
        "flex items-center justify-between p-3 rounded-lg border border-l-[3px] border-l-transparent transition-colors",
        delta === "up" && "border-l-warning bg-warning/[0.06] hover:bg-warning/10",
        delta === "down" && "border-l-silver/70 hover:bg-muted/50",
        (!delta || delta === "same" || delta === "settled") && "hover:bg-muted/50",
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={`h-8 w-8 rounded-md flex items-center justify-center flex-shrink-0 ${
          enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
        }`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{feature.label}</p>
          <p className="text-xs text-muted-foreground truncate">{feature.description}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {delta === "up" && <DeltaBadge direction="up" label="A mais" />}
        {delta === "down" && <DeltaBadge direction="down" label="A menos" />}
        {delta === "settled" && <SettledBadge />}
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => onToggle(feature.key, checked)}
        />
      </div>
    </div>
  );
}

/**
 * O selo da diferença.
 *
 * O TEXTO é `--foreground`, nunca `text-warning`: warning sobre o creme do tema
 * claro dá ~2,3:1 e reprova AA. Matiz marca, foreground fala.
 *
 * E a seta não é enfeite — cor não pode ser sinal único.
 */
function DeltaBadge({ direction, label }: { direction: "up" | "down"; label: string }) {
  const Arrow = direction === "up" ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium border",
        direction === "up"
          ? "bg-warning/15 border-warning/30 text-foreground"
          : "bg-muted border-border text-muted-foreground",
      )}
    >
      <Arrow className={cn("h-3 w-3", direction === "up" ? "text-warning" : "text-silver")} />
      {label}
    </span>
  );
}

/**
 * O selo de quem VOLTOU ao base com o filtro ligado.
 *
 * Ele existe para que nada saia da lista debaixo do dedo do operador (R1 do
 * Prisma): com o filtro ligado, todo card visível é uma diferença, então mexer
 * em qualquer um o faria desaparecer — e desfazer ficaria impossível, porque o
 * card recém-clicado já não estaria na tela.
 *
 * Tracejado, e não sólido: sinaliza estado TRANSITÓRIO. Ele desaparece no
 * próximo retrato, que só é tirado quando o operador desliga e religa o filtro.
 */
function SettledBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium border border-dashed border-border bg-transparent text-muted-foreground">
      <RotateCcw className="h-3 w-3 text-silver" />
      Voltou ao base
    </span>
  );
}
