/**
 * useBlastPlans — create / list / monitor / control Blast Plans (#707).
 *
 * A Blast Plan is an auto-batched Mass Send (ADR-0003): a frozen audience drained
 * over consecutive days. Backend: blast-plan-create (freezes snapshot + fires lot
 * 1), blast-plan-release (daily cron), blast-plan-control (pause/resume/cancel).
 * Tables blast_plans + blast_plan_recipients are RLS-scoped to the caller's org.
 *
 * `as any` on the table names: blast_plans / blast_plan_recipients post-date the
 * last generated types.ts (regen after the migration applies). Same house pattern
 * as useStageLeadIds / useTrashLeads.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  resumirDestinatarios,
  type LinhaDoResumo,
  type ResumoDoDisparo,
} from "@/modules/campaigns/lib/blast-delivery-summary";
import type { TemplateEscolhido } from "@/shared/disparo/template-escolhido";
import { useCurrentTeamMember } from "@/modules/identity";

export type BlastPlanStatus = "active" | "paused" | "completed" | "cancelled";

export interface BlastPlan {
  id: string;
  organization_id: string;
  instance_id: string;
  status: BlastPlanStatus;
  message: string;
  image_url: string | null;
  total_recipients: number;
  lots_total: number;
  lots_released: number;
  release_time: string;
  next_release_date: string | null;
  /**
   * O Template congelado da Meta (#1722). NULL ⇒ regime Chip.
   *
   * É o discriminador de regime do produto, o mesmo que `claim_blast_recipients`
   * usa no servidor. A tela precisa dele para saber se este Disparo TEM custo:
   * só o Canal Oficial é cobrado por mensagem (ADR-0029), e mostrar "custo — / —"
   * num Disparo por Chip afirmaria que existe uma conta que ninguém vai receber.
   *
   * `unknown` e não um tipo estruturado: nenhuma tela lê o conteúdo, só a
   * presença. Modelá-lo aqui seria inventar uma forma que o servidor já tem.
   */
  template: unknown | null;
  created_at: string;
  updated_at: string;
}

export interface BlastPlanLotBreakdown {
  lotIndex: number;
  date: string;
  count: number;
}

/**
 * Post-send destination (wizard "Destino" step): each lead is moved to this
 * funnel stage AT THE MOMENT its message is sent (per lot, over the plan's
 * days). Persisted as blast_plans.post_send_target; validated fail-closed by
 * blast-plan-create against the caller's org.
 */
export interface BlastPostSendTarget {
  /** Funil de destino — `pipelines.id` (QUALQUER funil da org, Fatia B). */
  pipelineId: string;
  /** Etapa de destino — `pipeline_stages.id` (uuid canônico). */
  stageId: string;
  /** Human label, e.g. "Oportunidades · Em negociação" (panel display). */
  label: string;
}

export interface CreateBlastPlanInput {
  /** Legacy single-number path (still accepted by the backend for retrocompat). */
  instance_id?: string;
  /** ADR-0015 multi-number: every selected number. Distributed round-robin per
   *  number per day, each bounded by its own Number Daily Cap. */
  instance_ids?: string[];
  /** Per-number cap override, keyed by instance id. Default: the number's stored
   *  daily_blast_cap. */
  caps?: Record<string, number>;
  /** Per-leva send window (ADR-0015 / #909). Default server-side: Mon–Sat 08–20. */
  window?: { days?: number[]; from_minutes?: number; to_minutes?: number };
  lead_ids: string[];
  /** O texto que a pessoa recebe. No Canal Oficial, o corpo do Template. */
  message: string;
  /**
   * O Template aprovado, quando o Disparo é pelo Canal Oficial (#1722).
   * Ausente em Disparo de Chip. O servidor recusa plano oficial sem ele, e
   * recusa regime misto — a tela barra antes, mas a garantia é do servidor.
   */
  template?: TemplateEscolhido | null;
  delay_min_ms?: number;
  delay_max_ms?: number;
  image_url?: string;
  exclude_blasted_within_days?: number;
  only_non_responders?: boolean;
  /** Time-of-day (HH:MM) the daily releaser fires; defaults server-side to 09:00. */
  release_time?: string;
  /** Audience provenance, recorded for the panel ("Estágio Novo", etc.). */
  source?: Record<string, unknown>;
  /** Optional post-send move: each lead moved to this stage when its message
   *  goes out. Omitted = leads stay where they are. */
  post_send_target?: BlastPostSendTarget;
}

export interface CreateBlastPlanResult {
  ok: true;
  plan_id: string;
  total_recipients: number;
  lots_total: number;
  breakdown: BlastPlanLotBreakdown[];
}

/** Create a Blast Plan: freezes the audience snapshot and fires lot 1 today. */
export function useCreateBlastPlan() {
  const qc = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  return useMutation({
    mutationFn: async (input: CreateBlastPlanInput): Promise<CreateBlastPlanResult> => {
      const { data, error } = await supabase.functions.invoke("blast-plan-create", { body: input });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as CreateBlastPlanResult;
    },
    onSuccess: () => {
      if (teamMember?.organization_id) {
        qc.invalidateQueries({ queryKey: ["blast_plans", teamMember.organization_id] });
      }
    },
  });
}

/** Mesmo tamanho de página do irmão `useBlastPlanRecipients`: o limite do PostgREST. */
const PROGRESS_PAGE = 1000;
const PROGRESS_PAGE_CAP = 20; // 20k destinatários — muito acima de qualquer plano real

/** List the org's Blast Plans (RLS-scoped), newest first. */
export function useBlastPlans() {
  const { data: teamMember } = useCurrentTeamMember();
  const orgId = teamMember?.organization_id;
  return useQuery({
    queryKey: ["blast_plans", orgId],
    queryFn: async (): Promise<BlastPlan[]> => {
      if (!orgId) return [];
      // Filtro explícito de org: master tem policy SELECT cross-org
      // (master_select_all_blast_plans, torque-mcp) — sem o eq, o painel
      // Disparos mostraria os plans de todas as orgs pra usuário master.
      const { data, error } = await supabase
        .from("blast_plans" as any)
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as BlastPlan[];
    },
    enabled: !!orgId,
  });
}

export type BlastPlanProgress = ResumoDoDisparo;

/**
 * Progresso por plano — contagem dos SEIS estados e os dois custos (#1724).
 *
 * ── MULTI-TENANCY (LEIA antes de mexer) ────────────────────────────────────
 * Recebe o `BlastPlan` INTEIRO, nunca um `plan_id` solto, e é fail-closed contra
 * a org corrente — mesmo contrato do irmão `useBlastPlanRecipients`, e pelo mesmo
 * motivo: `blast_plan_recipients` não tem `organization_id`, e a policy
 * master-ghost dá SELECT cross-org a usuário master, então "confiar na RLS" não
 * basta (lição do incidente `useBlastPlans`, changelog 2026-07-02).
 *
 * Isto ficou mais sério nesta fatia: a consulta passou a ler DINHEIRO.
 *
 * ── PAGINADO, e isso não é zelo ────────────────────────────────────────────
 * A versão anterior fazia um `select` só, contra o teto de 1000 linhas do
 * PostgREST. Enquanto contava só pessoas, um total truncado era um número errado;
 * agora a mesma consulta soma dinheiro, e um total truncado não parece truncado —
 * parece um valor. Por isso também há `truncado`: se a audiência passar do teto de
 * páginas, os custos voltam `null` em vez de parciais.
 *
 * ⚠️ `.order()` ANTES do `.range()`, e é obrigatório: `range` sem ordem total é
 * indefinido no Postgres, e a tabela está sendo escrita pelo worker ENQUANTO a
 * tela lê. Sem ordem, páginas podem repetir ou pular linhas — e o sintoma seria
 * um total de fatura errado, silenciosamente. `created_at` empata (o criador
 * insere a audiência em lote), então `id` é o desempate que torna a ordem total.
 *
 * A agregação mora em `blast-delivery-summary.ts`, no cliente e não numa RPC: o
 * frontend deste repo deploya sozinho no merge para a main enquanto a migration é
 * botão do humano, e entre um e outro uma RPC inexistente faria o painel dizer
 * "0 enviados" — a mesma mentira que este ticket recusa para o custo.
 */
export function useBlastPlanProgress(plan: BlastPlan | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const orgId = teamMember?.organization_id;
  const planBelongsToOrg = !!plan && !!orgId && plan.organization_id === orgId;

  return useQuery({
    queryKey: ["blast_plan_recipients", plan?.id, "progress", orgId],
    queryFn: async (): Promise<BlastPlanProgress> => {
      // Fail-closed: nunca soma recipients de plano fora da org selecionada.
      if (!plan || !orgId || plan.organization_id !== orgId) {
        return resumirDestinatarios([]);
      }

      const rows: LinhaDoResumo[] = [];
      let truncado = false;

      for (let page = 0; page <= PROGRESS_PAGE_CAP; page++) {
        if (page === PROGRESS_PAGE_CAP) {
          truncado = true;
          break;
        }
        const from = page * PROGRESS_PAGE;
        const { data, error } = await supabase
          .from("blast_plan_recipients" as any)
          .select("status, estimated_cost, actual_cost")
          .eq("plan_id", plan.id)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + PROGRESS_PAGE - 1);
        if (error) throw error;
        const batch = (data ?? []) as unknown as LinhaDoResumo[];
        rows.push(...batch);
        if (batch.length < PROGRESS_PAGE) break;
      }

      return resumirDestinatarios(rows, truncado);
    },
    enabled: planBelongsToOrg,
  });
}

export interface UpdateBlastPlanInput {
  plan_id: string;
  /** New frozen message template — reaches every not-yet-sent recipient. */
  message?: string;
  /** New daily release time-of-day (HH:MM). */
  release_time?: string;
}

/**
 * Edit a live Blast Plan's message / release_time (#911). The audience is
 * immutable (ADR-0003) so it is never touched. Writes go through the
 * service_role edge fn (blast_plans is SELECT-only for members) which validates
 * the org, guards the tenant, and rejects terminal plans.
 */
export function useUpdateBlastPlan() {
  const qc = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  return useMutation({
    mutationFn: async (input: UpdateBlastPlanInput) => {
      const { data, error } = await supabase.functions.invoke("blast-plan-edit", { body: input });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { ok: true };
    },
    onSuccess: () => {
      if (teamMember?.organization_id) {
        qc.invalidateQueries({ queryKey: ["blast_plans", teamMember.organization_id] });
      }
    },
  });
}

export type BlastPlanAction = "pause" | "resume" | "cancel";

/** Pause / resume / cancel a Blast Plan (writes go through the service_role edge fn). */
export function useBlastPlanControl() {
  const qc = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  return useMutation({
    mutationFn: async (input: { plan_id: string; action: BlastPlanAction }) => {
      const { data, error } = await supabase.functions.invoke("blast-plan-control", { body: input });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { ok: true; status: BlastPlanStatus };
    },
    onSuccess: () => {
      if (teamMember?.organization_id) {
        qc.invalidateQueries({ queryKey: ["blast_plans", teamMember.organization_id] });
      }
    },
  });
}
