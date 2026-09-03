/**
 * stage-role — metadados de apresentação do enum `stage_role` (#990/#991).
 *
 * Labels pt-BR + descrição curta + tokens visuais, consumidos pelo modal de
 * etapa (pipelines) e pela tela master de revisão won/lost (identity, via
 * barrel `@/modules/pipelines`). Fonte única de microcopy — o enum em si é
 * governado pelo banco (ADR-0017 §1).
 */

import type { StageRole } from "@/contracts/pipe";

/**
 * TODOS os papéis do enum. Para RENDERIZAR — badge, legenda, tela de revisão.
 * Continua com won/lost porque o enum do banco continua com eles.
 */
export const STAGE_ROLES: readonly StageRole[] = [
  "open",
  "meeting_booked",
  "meeting_held",
  "won",
  "lost",
] as const;

/**
 * Os papéis que o admin pode ATRIBUIR a uma etapa.
 *
 * ── Por que won/lost saíram daqui ─────────────────────────────────────────
 * Desde o B2d (migration `a_coluna_deixa_de_decidir`) a etapa não decide mais
 * ganho nem perda. Quem decide é o desfecho do negócio, pelo botão ou pela
 * automação, e é de lá que TODAS as métricas leem.
 *
 * Marcar uma etapa como "Venda ganha" deixou de fazer qualquer coisa útil e
 * passou a fazer uma coisa ruim: reativa `fn_capture_sale_event` naquela
 * etapa, e o funil volta a registrar venda por arrastar — para uma org só,
 * em silêncio, contra o modelo que o resto do sistema segue. Foi medido
 * acontecendo: uma etapa nasceu com papel `lost` horas depois de a fatia
 * anterior subir, criada pela tela.
 *
 * Opção que não faz nada é ruim; opção que faz o errado é pior. Sai da tela.
 *
 * Os papéis de REUNIÃO ficam: `agendado` e `compareceu` são posição no funil,
 * não dinheiro, e a agenda depende deles.
 */
export const STAGE_ROLES_ATRIBUIVEIS: readonly StageRole[] = [
  "open",
  "meeting_booked",
  "meeting_held",
] as const;

export interface StageRoleMeta {
  label: string;
  /** Descrição curta exibida no dropdown do modal de etapa. */
  description: string;
  /** Classes de badge (dark-first, tom rebaixado + texto vivo). */
  badgeClassName: string;
  /** Cor do dot indicador. */
  dotClassName: string;
}

export const STAGE_ROLE_META: Record<StageRole, StageRoleMeta> = {
  open: {
    label: "Em andamento",
    description: "Etapa intermediária — não gera métrica de reunião nem de venda",
    badgeClassName: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
    dotClassName: "bg-zinc-400",
  },
  meeting_booked: {
    label: "Reunião marcada",
    description: "Lead com reunião agendada — conta no funil de reuniões",
    badgeClassName: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    dotClassName: "bg-blue-400",
  },
  meeting_held: {
    label: "Reunião realizada",
    description: "Lead compareceu à reunião — conta como comparecimento",
    badgeClassName: "bg-violet-500/15 text-violet-400 border-violet-500/30",
    dotClassName: "bg-violet-400",
  },
  won: {
    label: "Ganho (venda)",
    description: "Fecha o negócio — registra a venda e conta receita",
    badgeClassName: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    dotClassName: "bg-emerald-400",
  },
  lost: {
    label: "Perdido",
    description: "Encerra a oportunidade sem venda — conta como perda",
    badgeClassName: "bg-red-500/15 text-red-400 border-red-500/30",
    dotClassName: "bg-red-400",
  },
};

export const STAGE_ROLE_SOURCE_LABEL: Record<string, string> = {
  deterministic: "Nome da etapa",
  ai: "IA",
  flag: "Flag de board",
};
