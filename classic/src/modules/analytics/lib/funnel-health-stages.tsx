/**
 * Definições compartilhadas do Funil de Saúde (coorte por data de criação).
 *
 * Semântica travada no grill (CONTEXT.md: Funnel Health Indicator). Metas fixas
 * do produto: 90/40/30/65/25. Extraído de TabSaude para ser reusado também no
 * Analytics do Funil de Qualificação (pipelines) — fonte única, sem drift.
 */
import type React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { FunnelHealthStages } from "@/modules/analytics/hooks/useFunnelHealth";

export type HealthStatus = "ok" | "warn" | "bad";
export type StageKey = keyof FunnelHealthStages;

export interface StageDef {
  key: StageKey;
  label: string;
  tooltip: string;
  /** meta de conversão sobre a etapa anterior (%); null na primeira etapa */
  goal: number | null;
}

export const STAGE_DEFS: StageDef[] = [
  {
    key: "entraram",
    label: "Entraram",
    tooltip:
      "Todo lead criado no período, de qualquer origem: anúncio, formulário do site, WhatsApp, importação ou cadastro manual.",
    goal: null,
  },
  {
    key: "avaliados",
    label: "Avaliados",
    tooltip:
      'Leads que receberam uma classificação de qualidade — pela IA (pré-qualificação) ou pelo vendedor (qualificação final). Qualquer nota conta, até "desqualificado": significa que alguém olhou.',
    goal: 90,
  },
  {
    key: "bons",
    label: "Bons leads",
    tooltip:
      "Leads classificados como Prata, Ouro ou Diamante — os que valem o esforço comercial. Bronze e desqualificados ficam de fora. Se a IA e o vendedor classificaram diferente, vale a do vendedor.",
    goal: 40,
  },
  {
    key: "reuniao",
    label: "Reunião marcada",
    tooltip:
      'Leads que tiveram reunião agendada — pelo time (card movido para "Agendado"), pela IA ou pela agenda integrada. Conta o histórico: vale mesmo que o lead já tenha avançado de etapa.',
    goal: 30,
  },
  {
    key: "compareceram",
    label: "Compareceram",
    tooltip: 'Leads cuja reunião de fato aconteceu — card movido para "Compareceu".',
    goal: 65,
  },
  {
    key: "compraram",
    label: "Compraram",
    tooltip: "Leads que fecharam negócio — chegaram à etapa de venda no funil de fechamento.",
    goal: 25,
  },
];

export const TRANSITION_TOOLTIPS: Record<string, string> = {
  "Entraram → Avaliados":
    "De cada 10 leads que entraram, quantos receberam avaliação de qualidade (da IA ou do vendedor).",
  "Avaliados → Bons":
    "De cada 10 leads avaliados, quantos foram classificados como Prata, Ouro ou Diamante.",
  "Bons → Reunião": "De cada 10 bons leads, quantos chegaram a ter uma reunião marcada.",
  "Reunião → Compareceu": "De cada 10 reuniões marcadas, quantas de fato aconteceram.",
  "Compareceu → Venda": "De cada 10 leads que compareceram à reunião, quantos fecharam negócio.",
};

export const TRANSITION_LABELS = [
  "Entraram → Avaliados",
  "Avaliados → Bons",
  "Bons → Reunião",
  "Reunião → Compareceu",
  "Compareceu → Venda",
];

export function statusOf(conv: number, goal: number): HealthStatus {
  if (conv >= goal) return "ok";
  if (conv >= goal * 0.7) return "warn";
  return "bad";
}

export const STATUS_TEXT: Record<HealthStatus, string> = {
  ok: "text-emerald-500",
  warn: "text-primary",
  bad: "text-red-500",
};

export const STATUS_LED: Record<HealthStatus, string> = {
  ok: "bg-emerald-500 shadow-[0_0_8px_hsl(152_76%_40%/.55)]",
  warn: "bg-primary shadow-[0_0_8px_hsl(47_100%_50%/.55)]",
  bad: "bg-red-500 shadow-[0_0_8px_hsl(0_72%_51%/.6)]",
};

export const STATUS_CHIP: Record<HealthStatus, { label: string; cls: string }> = {
  ok: { label: "Saudável", cls: "bg-emerald-500/10 text-emerald-500" },
  warn: { label: "Atenção", cls: "bg-primary/10 text-primary" },
  bad: { label: "Gargalo", cls: "bg-red-500/15 text-red-500" },
};

export function fmtPct(v: number) {
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function HelpTip({
  text,
  children,
  align = "start",
}: {
  text: string;
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help border-b border-dashed border-muted-foreground/50 pb-px">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent align={align} className="max-w-[300px] p-3.5 leading-relaxed">
        <span className="mb-1.5 block text-[9.5px] font-bold uppercase tracking-[0.16em] text-primary">
          O que conta aqui
        </span>
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export function StatusChip({ status }: { status: HealthStatus }) {
  const chip = STATUS_CHIP[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        chip.cls
      )}
    >
      <i className="h-1.5 w-1.5 rounded-full bg-current" />
      {chip.label}
    </span>
  );
}
