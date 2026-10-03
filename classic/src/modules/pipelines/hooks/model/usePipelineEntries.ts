import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeSubscription, type RealtimeHandlers } from "@/shared/realtime/useRealtimeSubscription";
import { useOrganization } from "@/modules/identity";
export type PipelineType = "whatsapp" | "confirmacao" | "propostas";

export const LEAD_SELECT = `
  id, name, company, email, phone, origin, segment, faturamento, urgency, notes, compromisso_date, ai_disabled,
  avatar_url, pre_qualification_tier, qualification_tier,
  sdr_id, closer_id, responsible_id, pre_sale_responsible_id, sale_responsible_id,
  responsible:team_members!leads_responsible_id_fkey(id, name, avatar_url),
  sdr:team_members!leads_sdr_id_fkey(id, name, avatar_url),
  closer:team_members!leads_closer_id_fkey(id, name, avatar_url),
  pre_sale_responsible:team_members!leads_pre_sale_responsible_id_fkey(id, name, avatar_url),
  sale_responsible:team_members!leads_sale_responsible_id_fkey(id, name, avatar_url),
  lead_tags(tag:tags(id, name, color))
`;

const realtimeHandlers: RealtimeHandlers = {
  onUpdate: (updated, oldData) =>
    oldData.map((item) =>
      item.id === updated.id ? { ...item, ...updated } : item
    ),
  onDelete: (deleted, oldData) =>
    oldData.filter((item) => item.id !== deleted.id),
};

/**
 * Teto de linhas lidas por `(pipeline_id, lead_id)` — espelha
 * `PIPE_ENTRY_READ_CAP` em `supabase/functions/_shared/pipeline-adapter.ts`.
 * Hoje irrelevante (o unique garante ≤1); depois do M1 evita leitura sem limite.
 */
const PIPELINE_ENTRY_READ_CAP = 50;

/**
 * Lê TODAS as entries de `(pipeline_id, lead_id)` e devolve a que representa o
 * lead no funil — tolerando N linhas.
 *
 * Por que não `.maybeSingle()`: com mais de uma linha o postgrest-js **zera o
 * `data`** e devolve `PGRST116` — verificado na cópia instalada,
 * `node_modules/@supabase/postgrest-js/dist/index.mjs:107-119`
 * (`if (isMaybeSingle && method === "GET" && data.length > 1) { error = …; data = null; }`).
 * O swallow que vira "vazio" (linha 137-141) só cobre `details` com `"0 rows"`,
 * então "existem 2" era indistinguível de "não existe" — e a chamada seguinte
 * inseria mais uma linha, virando duplicador determinístico (2 → 3 → 4).
 *
 * Critério de escolha (aberto primeiro, depois mais recente) e a medição que o
 * sustenta estão documentados em `pickActiveEntry`, em
 * `supabase/functions/_shared/pipeline-adapter.ts` — mesma regra dos dois lados
 * de propósito: o kanban e o Copilot precisam concordar sobre QUAL negócio é o
 * corrente, senão a UI mostra um e a automação move outro.
 *
 * Lança em erro de leitura em vez de devolver "não existe" (ver
 * `findOrCreatePipelineEntry`).
 */
async function readActivePipelineEntry(pipelineId: string, leadId: string) {
  const { data, error } = await supabase
    .from("pipeline_entries")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .eq("lead_id", leadId)
    .order("closed_at", { ascending: false, nullsFirst: true })
    .order("stage_changed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PIPELINE_ENTRY_READ_CAP);

  if (error) throw error;

  const rows = data ?? [];
  if (rows.length > 1) {
    // Sinal explícito de "existem N" — o que `.maybeSingle()` apagava.
    console.warn(
      `[pipeline_entries] ${rows.length} entries para pipeline=${pipelineId} lead=${leadId}; usando a primeira ABERTA, ou a mais recente se todas estiverem fechadas.`,
    );
  }
  return rows.find((r) => r.closed_at == null) ?? rows[0] ?? null;
}

/**
 * Create idempotente para `pipeline_entries`.
 *
 * Hoje `pipeline_entries` tem DOIS cadeados sobre a mesma chave —
 * `uq_pipeline_entries_pipeline_lead` (constraint) e
 * `idx_pipeline_entries_pipeline_lead` (índice único parcial,
 * `WHERE lead_id IS NOT NULL`). Vários call sites (mover no Kanban, modais,
 * auto-create em `compareceu`) repetem ou correm o create; o pré-check evita o
 * insert e o ramo 23505 recupera a corrida.
 *
 * ⚠️ **A idempotência aqui é best-effort e deixa de ter rede depois do M1.**
 * Quem garante "no máximo um" hoje é o banco, não este código: o pré-check e o
 * insert são duas viagens separadas, sem lock. Quando o M1 derrubar os cadeados,
 * dois cliques concorrentes em "Criar Proposta" passam a criar dois negócios e
 * nada os impede — o que, no modelo Lead ↔ Negócio, é o comportamento pretendido,
 * não um bug. Esta função só garante que uma chamada SEQUENCIAL não duplique.
 *
 * Devolve `{ entry, created }` para o caller decidir se dispara automação de
 * follow-up (só em `created`).
 */
export async function findOrCreatePipelineEntry(params: {
  pipelineId: string;
  leadId: string;
  organizationId: string;
  stageKey: string;
  assignedTo: string | null;
  metadata: Record<string, unknown>;
  notes?: string | null;
}): Promise<{ entry: any; created: boolean }> {
  const { pipelineId, leadId, organizationId, stageKey, assignedTo, metadata, notes } = params;

  // ⚠️ MUDANÇA DE COMPORTAMENTO — não é no-op, e é deliberada.
  //
  // Antes o erro era descartado (`const { data: existing } = …`), então falha de
  // leitura virava "não existe" e seguia para o INSERT. Hoje o unique barra o
  // estrago (23505 → ramo de recuperação abaixo); depois do M1 esse mesmo caminho
  // criaria um negócio duplicado a cada falha transitória de leitura.
  //
  // Agora a falha propaga: a mutation falha, o usuário vê o erro e clica de novo.
  // O delta observável hoje é estreito — só "leitura falhou E não existia entry",
  // que antes criava a entry e agora levanta. Trocamos de propósito: negócio
  // duplicado é permanente e aparece no kanban do cliente; create que falhou é
  // visível, recuperável e o usuário reexecuta.
  const existing = await readActivePipelineEntry(pipelineId, leadId);

  if (existing) return { entry: existing, created: false };

  const insertPayload: Record<string, unknown> = {
    pipeline_id: pipelineId,
    lead_id: leadId,
    stage_key: stageKey,
    assigned_to: assignedTo,
    organization_id: organizationId,
    metadata,
  };
  if (notes !== undefined) insertPayload.notes = notes;

  const { data, error } = await supabase
    .from("pipeline_entries")
    .insert(insertPayload)
    .select()
    .single();

  if (!error) return { entry: data, created: true };

  // Recuperação de corrida: outro cliente inseriu entre o pré-check e este insert,
  // e um dos dois uniques devolveu 23505. Continua load-bearing HOJE.
  //
  // Depois do M1 este ramo deixa de ser alcançável para `(pipeline_id, lead_id)`:
  // sem unique não há 23505 — o insert passa e o segundo negócio é criado (que é a
  // intenção do M1). Mantido porque o M1 ainda NÃO foi aplicado e removê-lo agora
  // seria regressão real; continua correto caso outro unique entre na tabela.
  if ((error as { code?: string }).code === "23505") {
    const raced = await readActivePipelineEntry(pipelineId, leadId);
    if (raced) return { entry: raced, created: false };
  }

  throw error;
}

export function usePipelineId(slug: PipelineType) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["pipeline_id", slug, organizationId],
    queryFn: async () => {
      if (!organizationId) return null;

      const { data } = await supabase
        .from("pipelines")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("slug", slug)
        .eq("type", "system")
        .maybeSingle();

      if (data?.id) return data.id;

      await supabase.rpc("create_default_pipelines", { p_org_id: organizationId });

      const { data: created } = await supabase
        .from("pipelines")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("slug", slug)
        .eq("type", "system")
        .maybeSingle();

      return created?.id ?? null;
    },
    enabled: isReady && !!organizationId,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function flattenMetadata(entry: any) {
  const meta = (entry.metadata as Record<string, any>) ?? {};
  return {
    ...entry,
    status: entry.stage_key,
    sdr_id: meta.sdr_id ?? entry.lead?.sdr_id ?? null,
    responsible_id: meta.responsible_id ?? entry.lead?.responsible_id ?? null,
    closer_id: meta.closer_id ?? entry.lead?.closer_id ?? null,
    pre_sale_responsible_id: meta.pre_sale_responsible_id ?? null,
    sale_responsible_id: meta.sale_responsible_id ?? null,
    scheduled_date: meta.scheduled_date ?? null,
    meeting_date: meta.meeting_date ?? null,
    meet_link: meta.meet_link ?? null,
    is_confirmed: meta.is_confirmed ?? false,
    sale_value: meta.sale_value ?? null,
    product_id: meta.product_id ?? null,
    product_type: meta.product_type ?? null,
    // `calor` saiu da INTERFACE em 2026-09-03 (card, chip e CalorBars). O dado
    // segue em `metadata` e continua mapeado aqui porque o único leitor restante
    // é o payload do Coach IA da TV (`useTVDashboardData.propostasQuentes` →
    // edge fn `oraculo-comercial`), que não é superfície visível.
    calor: meta.calor ?? null,
    loss_reason_id: meta.loss_reason_id ?? null,
    commitment_date: meta.commitment_date ?? null,
    contract_duration: meta.contract_duration ?? null,
    metrics_period_at: meta.metrics_period_at ?? null,
    responsible: entry.lead?.responsible ?? null,
    sdr: entry.lead?.sdr ?? null,
    closer: entry.lead?.closer ?? null,
    pre_sale_responsible: entry.lead?.pre_sale_responsible ?? null,
    sale_responsible: entry.lead?.sale_responsible ?? null,
    stage_entered_at: entry.stage_changed_at,
  };
}

export function usePipelineEntries(slug: PipelineType) {
  const { organizationId, isReady } = useOrganization();
  const { data: pipelineId } = usePipelineId(slug);

  useRealtimeSubscription("pipeline_entries", ["pipeline_entries", slug, organizationId], realtimeHandlers);

  return useQuery({
    queryKey: ["pipeline_entries", slug, organizationId, pipelineId],
    queryFn: async ({ signal }) => {
      if (!organizationId || !pipelineId) return [];

      const { data, error } = await supabase
        .from("pipeline_entries")
        .select(`*, lead:leads!pipeline_entries_lead_id_fkey(${LEAD_SELECT})`)
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false })
        .limit(500)
        .abortSignal(signal);

      if (error) throw error;

      const entries = (data ?? [])
        .filter((e: any) => e.lead != null)
        .map(flattenMetadata);

      if (slug === "propostas" && entries.length > 0) {
        const entryIds = entries.map((e: any) => e.id);

        const [productsRes, itemsRes] = await Promise.all([
          supabase
            .from("products")
            .select("id, name, type, ticket, ticket_minimo")
            .in("id", entries.map((e: any) => e.product_id).filter(Boolean)),
          supabase
            .from("pipe_proposta_items")
            .select("*, product:products(id, name, type, ticket, ticket_minimo)")
            .in("pipe_proposta_id", entryIds),
        ]);

        const productsMap = new Map((productsRes.data ?? []).map((p: any) => [p.id, p]));
        const itemsByProposta = new Map<string, any[]>();
        for (const item of (itemsRes.data ?? [])) {
          const arr = itemsByProposta.get(item.pipe_proposta_id) ?? [];
          arr.push(item);
          itemsByProposta.set(item.pipe_proposta_id, arr);
        }

        return entries.map((entry: any) => ({
          ...entry,
          product: entry.product_id ? productsMap.get(entry.product_id) ?? null : null,
          items: itemsByProposta.get(entry.id) ?? [],
        }));
      }

      return entries;
    },
    enabled: isReady && !!organizationId && !!pipelineId,
    staleTime: 10 * 60 * 1000,
  });
}
