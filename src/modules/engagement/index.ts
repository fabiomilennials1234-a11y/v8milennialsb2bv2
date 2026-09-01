/**
 * Module engagement — API pública.
 *
 * Public surface do bounded context (engajamento de vendedores).
 * Tudo cross-module passa por aqui. Internals (components/, pages/) são
 * privados — ESLint `boundaries` impede import direto fora da API pública.
 *
 * Status: Active (populado em slice 11 — feat/modularizacao/10-engagement).
 *
 * Domínios cobertos:
 * - Activities & Activity Log (call/email/meeting/note/task/whatsapp_msg/system)
 * - Agenda & Meetings (unified calendar de 5 fontes)
 * - Follow-ups (manual + automation rules)
 * - Call Logs (ligações manuais ou via API telefonia)
 * - Checklists & Templates (itens repetitivos do vendedor)
 * - Approvals (gates de aprovação para ações sensíveis)
 * - Gamification (badges + awards + competitions + level + streak)
 * - Ranking (vendedor ranking + transitions/historico)
 * - Goals (vendedor + team) e Daily Priorities (ações do dia)
 * - Coaching Suggestions (IA — sugestões de melhoria por conversa)
 * - Performance (closer + SDR perspective)
 * - Commissions (vendedor financial perf — não folha pagamento)
 * - Recent Activity / Recent Items / Seller Activity (lead feed)
 * - Next Best Actions (IA prio)
 * - Milestone auto-unlock (badges automáticos)
 *
 * Pages NÃO são re-exportadas — App.tsx faz deep-import via React.lazy
 * (padrão dos slices 4-10):
 *   @/modules/engagement/pages/Agenda
 *   @/modules/engagement/pages/ChecklistPage
 *   @/modules/engagement/pages/Comissoes
 *   @/modules/engagement/pages/Revisao
 */

// ────────────────────────────────────────────────────────────────────────
// Hooks — Activities (timeline de toques + outcome)
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useActivities";
// useRecentActivity tem `Activity` distinto do de useActivities — re-export
// nominal pra evitar colisão de barrel. Consumidores que precisam do tipo
// devem importar via deep-path `@/modules/engagement/hooks/useRecentActivity`.
export { useRecentActivity } from "./hooks/useRecentActivity";
export * from "./hooks/useRecentItems";
export * from "./hooks/useSellerActivity";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Agenda & Meetings (calendário unificado interno)
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useAgendaEvents";
export * from "./hooks/useMeetings";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Follow-ups (toques agendados — manual + automation rules)
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useFollowUps";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Call Logs (ligações)
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useCallLogs";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Checklists & Templates
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useChecklists";
export * from "./hooks/useChecklistTemplates";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Approvals (gates de aprovação)
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useApprovals";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Gamification (badges + awards + competitions)
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useBadges";
export * from "./hooks/useAwards";
export * from "./hooks/useCompetitions";
export * from "./hooks/useMilestoneAutoUnlock";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Ranking (vendedor ranking + history)
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useVendedorRanking";
export * from "./hooks/useRankingTransitions";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Goals & Daily Priorities
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useGoals";
export * from "./hooks/useDailyPriorities";
export * from "./hooks/useAcoesDoDia";
export * from "./hooks/useNextBestActions";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Coaching Suggestions (IA por conversa)
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useCoachingSuggestions";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Performance (closer + SDR)
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useCloserPerformance";
export * from "./hooks/useSDRPerformance";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Commissions (financial perf do vendedor)
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useCommissions";

// ────────────────────────────────────────────────────────────────────────
// Components — Agenda
// ────────────────────────────────────────────────────────────────────────

/**
 * `CreateMeetingDialog` sai do módulo porque marcar reunião deixou de ser
 * exclusividade da Agenda: o card do funil abre o MESMO diálogo, com o lead já
 * escolhido. Duplicar o formulário faria as duas cópias divergirem na primeira
 * correção — foi assim que o seletor de lead antigo ficou preso a 50 leads.
 *
 * Export NOMEADO, não `export *`: o barrel é dublado em teste
 * (`vi.mock("@/modules/engagement")`) e `export *` de um componente arrasta
 * junto tipos e constantes internas que a fábrica do dublê teria de repetir.
 */
export { CreateMeetingDialog } from "./components/agenda/CreateMeetingDialog";
