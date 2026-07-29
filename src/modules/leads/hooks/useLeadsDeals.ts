import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * Negócios do lead — fatia 1, lidos de `pipeline_entries`.
 *
 * Decisão do CTO (D1, 2026-07-29): **card de funil É o negócio**. A tabela
 * `deals` existe e está vazia (0 linhas em prod); acender ela é a fatia 2, e o
 * backfill 1:1 do D3 vai apenas tornar literal o que esta camada já mostra —
 * nenhuma mudança visual no dia da migração.
 *
 * Enquanto isso, um lead em 2 funis tem 2 negócios, e é isso que a lista e o
 * drawer contam. Ler `deals` aqui daria "sem negócio" para os 32.154 leads
 * vivos enquanto a tela ao lado exibe 39.402 cards — duas verdades brigando.
 *
 * Multi-tenancy: filtra `organization_id` explicitamente além da RLS.
 */

/** Etapa terminal do funil — vem de `stage_role` na tabela de stages. */
export type DealOutcome = "open" | "won" | "lost";

export interface LeadDeal {
  /** id da `pipeline_entries` — vira `deal_id` na fatia 2. */
  id: string;
  leadId: string;
  /** Nome do funil. É o título do negócio enquanto `deals.title` não existe. */
  title: string;
  funnelName: string;
  funnelColor: string;
  /** `pipelines.id` — alvo do "Ver no funil". */
  pipelineId: string;
  /** `whatsapp` | `confirmacao` | `propostas` p/ funis system; slug do custom. */
  pipelineSlug: string;
  isSystem: boolean;
  stageKey: string | null;
  stageName: string;
  outcome: DealOutcome;
  won: boolean;
  /** `metadata.sale_value` — só propostas costuma ter. 0 = sem valor. */
  value: number;
  /** `metadata.meeting_date`, quando o negócio tem reunião marcada. */
  meetingDate: string | null;
  enteredAt: string | null;
  stageChangedAt: string | null;
  /** Dias parado na etapa atual. `null` quando não há carimbo. */
  daysInStage: number | null;
}

export type LeadDealsMap = Record<string, LeadDeal[]>;

/** `pipelines.slug` → `pipeline_stages.pipeline_type` dos funis system. */
const SLUG_TO_STAGE_TYPE: Record<string, string> = {
  whatsapp: "whatsapp",
  confirmacao: "confirmacao",
  propostas: "propostas",
  upsell: "upsell_base",
};

const FALLBACK_COLOR = "#64748b";

const toNumber = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

function outcomeOf(role: string | null | undefined): DealOutcome {
  return role === "won" || role === "lost" ? role : "open";
}

/** `metadata` é `Json` no schema — só objeto interessa aqui. */
function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Busca em lote os negócios dos leads visíveis na página.
 *
 * Chaveado pelos ids da página corrente (máx. `LEADS_PAGE_SIZE`), então o `IN`
 * nunca cresce sem limite — mesmo contrato de `useLeadsCarteiraMetrics`.
 */
export function useLeadsDeals(leadIds: string[]) {
  const { organizationId, isReady } = useOrganization();

  // Ordena para a queryKey ser estável independente da ordem de renderização.
  const ids = [...leadIds].sort();

  return useQuery<LeadDealsMap>({
    queryKey: ["leads-deals", organizationId, ids],
    queryFn: async () => {
      if (!organizationId || ids.length === 0) return {};

      const [entriesRes, pipelinesRes, stagesRes, customStagesRes] = await Promise.all([
        supabase
          .from("pipeline_entries")
          .select("id, lead_id, pipeline_id, stage_key, entered_at, stage_changed_at, metadata")
          .eq("organization_id", organizationId)
          .in("lead_id", ids),
        supabase
          .from("pipelines")
          .select("id, slug, name, color, type")
          .eq("organization_id", organizationId),
        supabase
          .from("pipeline_stages")
          .select("pipeline_type, stage_key, name, stage_role")
          .eq("organization_id", organizationId)
          .eq("is_active", true),
        supabase
          .from("custom_pipeline_stages")
          .select("id, pipeline_id, stage_key, name, stage_role")
          .eq("organization_id", organizationId)
          .eq("is_active", true),
      ]);

      if (entriesRes.error) throw entriesRes.error;
      if (pipelinesRes.error) throw pipelinesRes.error;
      if (stagesRes.error) throw stagesRes.error;
      if (customStagesRes.error) throw customStagesRes.error;

      const pipelineById = new Map((pipelinesRes.data ?? []).map((p) => [p.id, p]));

      // Stages de funil system são chaveadas por (pipeline_type, stage_key).
      const systemStage = new Map<string, { name: string; role: string | null }>();
      for (const s of stagesRes.data ?? []) {
        const row = s as { pipeline_type: string; stage_key: string; name: string; stage_role: string | null };
        systemStage.set(`${row.pipeline_type}::${row.stage_key}`, {
          name: row.name,
          role: row.stage_role ?? null,
        });
      }

      // Custom: a entry grava ora o uuid da stage, ora o stage_key. Indexa os dois
      // (mesma tolerância de `useLeadAllPipelines`).
      const customStage = new Map<string, { name: string; role: string | null }>();
      for (const s of customStagesRes.data ?? []) {
        const row = s as {
          id: string;
          pipeline_id: string;
          stage_key: string | null;
          name: string;
          stage_role: string | null;
        };
        const value = { name: row.name, role: row.stage_role ?? null };
        customStage.set(`${row.pipeline_id}::${row.id}`, value);
        if (row.stage_key) customStage.set(`${row.pipeline_id}::${row.stage_key}`, value);
      }

      const map: LeadDealsMap = {};

      for (const raw of entriesRes.data ?? []) {
        if (!raw.lead_id || !raw.pipeline_id) continue;
        const pipeline = pipelineById.get(raw.pipeline_id);
        if (!pipeline) continue; // entry órfã de funil apagado — não inventa negócio

        const isSystem = pipeline.type === "system";
        const slug = pipeline.slug ?? "";
        const stageType = SLUG_TO_STAGE_TYPE[slug] ?? slug;

        const stage = raw.stage_key
          ? isSystem
            ? systemStage.get(`${stageType}::${raw.stage_key}`)
            : customStage.get(`${raw.pipeline_id}::${raw.stage_key}`)
          : undefined;

        const metadata = asObject(raw.metadata);
        const stageChangedAt = raw.stage_changed_at ?? raw.entered_at ?? null;

        const deal: LeadDeal = {
          id: raw.id,
          leadId: raw.lead_id,
          title: pipeline.name ?? "Funil",
          funnelName: pipeline.name ?? "Funil",
          funnelColor: pipeline.color ?? FALLBACK_COLOR,
          pipelineId: raw.pipeline_id,
          pipelineSlug: slug,
          isSystem,
          stageKey: raw.stage_key,
          // Stage inativa/renomeada não vira card fantasma: mostra a chave crua
          // em vez de sumir. Mesma classe do incidente ghost-stage do lead-webhook.
          stageName: stage?.name ?? raw.stage_key ?? "sem etapa",
          outcome: outcomeOf(stage?.role),
          won: outcomeOf(stage?.role) === "won",
          value: toNumber(metadata.sale_value),
          meetingDate: typeof metadata.meeting_date === "string" ? metadata.meeting_date : null,
          enteredAt: raw.entered_at,
          stageChangedAt,
          daysInStage: daysSince(stageChangedAt),
        };

        (map[raw.lead_id] ??= []).push(deal);
      }

      // System primeiro (qualificação → confirmação → propostas), custom depois.
      const slugOrder = ["whatsapp", "confirmacao", "propostas"];
      for (const leadId of Object.keys(map)) {
        map[leadId].sort((a, b) => {
          const ai = slugOrder.indexOf(a.pipelineSlug);
          const bi = slugOrder.indexOf(b.pipelineSlug);
          if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
          return a.funnelName.localeCompare(b.funnelName, "pt-BR");
        });
      }

      return map;
    },
    enabled: isReady && ids.length > 0,
    staleTime: 60 * 1000,
  });
}
