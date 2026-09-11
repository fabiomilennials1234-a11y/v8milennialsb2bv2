/**
 * useBlastPlanRecipients — lista a audiência congelada de um Blast Plan pro
 * drill-down do painel Disparos (#944 / PRD #941), com o nome atual do lead
 * via embed (`leads(name)`).
 *
 * ── Multi-tenancy (LEIA antes de reusar) ─────────────────────────────────────
 * `blast_plan_recipients` NÃO tem coluna organization_id — o tenant vem do plano
 * pai (RLS `tenant_isolation_select` via blast_plans). Mas a tabela está coberta
 * pela policy master-ghost (20261222000000_torque_mcp_master_ghost_policies.sql):
 * usuário master enxerga recipients de TODAS as orgs, então "confiar na RLS" não
 * basta (lição do incidente useBlastPlans, changelog 2026-07-02). O contrato aqui:
 *
 *   1. O caller passa o `BlastPlan` inteiro (vindo do useBlastPlans, que filtra
 *      `.eq("organization_id", orgId)` explicitamente) — nunca um plan_id solto.
 *   2. O hook só habilita a query quando `plan.organization_id` === org corrente
 *      (guard duplicado no queryFn, fail-closed).
 *
 * Recipients filtrados por plan_id de um plano já validado contra a org são
 * org-safe por construção — o plan_id é a fronteira de tenant.
 *
 * `as any` no nome da tabela: mesmo house pattern do useBlastPlans (tabela
 * pós-data o types.ts gerado).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import type { BlastPlan } from "@/modules/campaigns/hooks/useBlastPlans";

/**
 * Os SEIS estados do CHECK (`20270823000000_...sql:46`). Grupos mutuamente
 * exclusivos — um lead nunca aparece em duas abas ao mesmo tempo.
 *
 * `sent` é otimista: quer dizer "aceito pela fila" (ADR-0016), não "entregue".
 * No Chip, o poll do mass-send-status pode reclassificá-lo para `failed` minutos
 * depois; no Canal Oficial, quem o move é o callback de status (#1724), para
 * `delivered` ou `failed`.
 *
 * `unconfirmed` é o fim de linha de quem saiu e nunca teve confirmação dentro do
 * TTL de 30 dias da Meta. NÃO é entrega e NÃO é falha: a Meta descarta em
 * silêncio, sem callback, então o que se tem é ausência de informação — e o nome
 * não pode alegar mais do que se sabe (#1721).
 */
export type BlastRecipientStatus =
  | "pending"
  | "sent"
  | "skipped"
  | "failed"
  | "delivered"
  | "unconfirmed";

export interface BlastPlanRecipient {
  id: string;
  /** null quando o lead foi excluído do CRM (FK ON DELETE SET NULL). */
  lead_id: string | null;
  phone: string | null;
  lot_index: number;
  status: BlastRecipientStatus;
  reason: string | null;
  /** Nome atual do lead — null quando o lead foi excluído. */
  name: string | null;
}

/** Audiências grandes: pagina o fetch em blocos de 1000 (limite do PostgREST). */
const FETCH_PAGE = 1000;
const FETCH_PAGE_CAP = 20; // 20k recipients — muito acima de qualquer plano real

export function useBlastPlanRecipients(plan: BlastPlan | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const orgId = teamMember?.organization_id;
  const planBelongsToOrg = !!plan && !!orgId && plan.organization_id === orgId;

  return useQuery({
    queryKey: ["blast_plan_recipients", plan?.id, "list", orgId],
    queryFn: async (): Promise<BlastPlanRecipient[]> => {
      // Fail-closed: nunca busca recipients de plano fora da org selecionada
      // (policy master-ghost daria SELECT cross-org pra master).
      if (!plan || !orgId || plan.organization_id !== orgId) return [];
      const rows: BlastPlanRecipient[] = [];
      for (let page = 0; page < FETCH_PAGE_CAP; page++) {
        const from = page * FETCH_PAGE;
        const { data, error } = await supabase
          .from("blast_plan_recipients" as any)
          .select("id, lead_id, phone, lot_index, status, reason, leads(name)")
          .eq("plan_id", plan.id)
          .order("lot_index", { ascending: true })
          .order("created_at", { ascending: true })
          .range(from, from + FETCH_PAGE - 1);
        if (error) throw error;
        const batch = (data ?? []) as unknown as Array<
          Omit<BlastPlanRecipient, "name"> & { leads: { name: string | null } | null }
        >;
        for (const r of batch) {
          rows.push({
            id: r.id,
            lead_id: r.lead_id,
            phone: r.phone,
            lot_index: r.lot_index,
            status: r.status,
            reason: r.reason,
            name: r.leads?.name ?? null,
          });
        }
        if (batch.length < FETCH_PAGE) break;
      }
      return rows;
    },
    enabled: planBelongsToOrg,
    // Semântica assíncrona sent → failed (ADR-0016): o cron sincroniza falhas
    // a cada minuto; com o sheet aberto, o refetch no mesmo cadence garante que
    // o lead migra de Enviados pra Falha no refresh seguinte ao sync — sem
    // realtime (blast_plan_recipients não tem organization_id pro filtro do
    // canal padrão). staleTime curto pra reabertura do sheet não servir cache
    // de 5min do default global.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
