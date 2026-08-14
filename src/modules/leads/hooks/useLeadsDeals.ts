import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * Negócios do lead — fatia 1, lidos de `pipeline_entries`.
 *
 * A POSIÇÃO continua vindo de `pipeline_entries`, e é ela que define quantos
 * negócios o lead tem — ADR-0023 decisão 5: a posição mora no card, `deals`
 * carrega identidade e dinheiro. Ler a contagem de `deals` daria "sem negócio"
 * para os leads vivos enquanto a tela ao lado exibe os cards; duas verdades
 * brigando.
 *
 * O que mudou na fatia 2: o **título** deixou de ser o nome do funil e passa a
 * vir de `deals.title` via `pipeline_entries.deal_id`, com o nome do funil como
 * fallback para card ainda sem negócio (todos, enquanto o backfill do L3 não
 * roda). O texto anterior aqui dizia que o backfill "vai apenas tornar literal o
 * que esta camada já mostra, nenhuma mudança visual" — falso: o título muda, e
 * é de propósito. "Qualificação" não distingue negócio nenhum.
 *
 * Multi-tenancy: filtra `organization_id` explicitamente além da RLS.
 */

/** Etapa terminal do funil — vem de `stage_role` na tabela de stages. */
export type DealOutcome = "open" | "won" | "lost";

export interface LeadDeal {
  /** id da `pipeline_entries` — a POSIÇÃO. A identidade é `deals.id`. */
  id: string;
  /**
   * `deals.id` — a IDENTIDADE do negócio. `null` no card que ainda não tem
   * negócio (todos, enquanto o backfill não roda). É o que permite gravar
   * atributo DO NEGÓCIO, como a qualificação, em vez de escrever na pessoa.
   */
  dealId: string | null;
  /** Qualidade desta OPORTUNIDADE. Distinta da pré-qualificação, que é da pessoa. */
  qualificationTier: string | null;
  leadId: string;
  /** `deals.title` quando o card tem negócio; nome do funil como fallback. */
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
  /**
   * `position` da etapa dentro do funil. Desempata "qual negócio aberto está
   * mais avançado" quando dois estão no MESMO funil — o que hoje não acontece
   * (0 casos em prod) só porque as três travas de unicidade caíram agora, na
   * migration `20270730000050`. Dois abertos no mesmo funil é exatamente a
   * compra repetida que a fatia 2 foi feita para permitir.
   */
  stagePosition: number | null;
  /**
   * Posição ordinal da etapa entre as etapas ATIVAS do funil (0-based), e
   * quantas existem. É o que permite desenhar o progresso do negócio sem
   * inventar denominador: `stagePosition` sozinho é um número solto, porque
   * cada org numera as etapas como quer e apaga etapa no meio.
   */
  stageIndex: number | null;
  stageCount: number;
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
          .select("id, lead_id, pipeline_id, stage_key, entered_at, stage_changed_at, metadata, deal_id")
          .eq("organization_id", organizationId)
          .in("lead_id", ids),
        supabase
          .from("pipelines")
          .select("id, slug, name, color, type")
          .eq("organization_id", organizationId),
        supabase
          .from("pipeline_stages")
          .select("pipeline_type, stage_key, name, stage_role, position")
          .eq("organization_id", organizationId)
          .eq("is_active", true),
        supabase
          .from("custom_pipeline_stages")
          .select("id, pipeline_id, stage_key, name, stage_role, position")
          .eq("organization_id", organizationId)
          .eq("is_active", true),
      ]);

      if (entriesRes.error) throw entriesRes.error;
      if (pipelinesRes.error) throw pipelinesRes.error;
      if (stagesRes.error) throw stagesRes.error;
      if (customStagesRes.error) throw customStagesRes.error;

      const pipelineById = new Map((pipelinesRes.data ?? []).map((p) => [p.id, p]));

      /**
       * Título do NEGÓCIO (ADR-0023 decisão 9).
       *
       * Antes daqui saía `title: pipeline.name` — o nome do funil. Isso é
       * exatamente o que a decisão 9 rejeita: distingue nada, e produziria
       * dezenas de milhares de negócios chamados "Qualificação". O título de
       * verdade vive em `deals.title`, derivado na criação como
       * `Negócio de <mês>/<ano>` e editável depois.
       *
       * Consulta separada, e não join no `select` acima, porque o vínculo é
       * novo: enquanto o backfill do L3 não roda, `deal_id` é NULL em todas as
       * 38.156 entries de prod. Com a lista vazia a query nem sai — o custo
       * extra só aparece quando existe negócio de verdade para nomear.
       *
       * Fallback no nome do funil de propósito: card antigo, ainda sem negócio,
       * continua se identificando como hoje em vez de aparecer sem nome.
       */
      const dealIds = Array.from(
        new Set(
          (entriesRes.data ?? [])
            .map((e) => (e as { deal_id?: string | null }).deal_id)
            .filter((id): id is string => !!id),
        ),
      );

      const dealTitleById = new Map<string, string>();
      // Qualificação DO NEGÓCIO (migration 20270813120000). Guardada à parte do
      // título porque um negócio pode ter título e não ter nota — e o mapa de
      // título ignora linha sem `title`.
      const dealTierById = new Map<string, string | null>();
      if (dealIds.length > 0) {
        // PONTE DE COMPATIBILIDADE — some junto com o apply em prod.
        //
        // `deals.qualification_tier` nasce na migration 20270813120000, que
        // ainda NÃO está em produção. `src/integrations/supabase/types.ts` é
        // gerado A PARTIR DE PROD, então o cliente tipado não conhece a coluna
        // e recusa o SELECT INTEIRO com
        // `SelectQueryError<"column 'qualification_tier' does not exist">` —
        // derrubando junto o `id` e o `title`, que existem.
        //
        // A chamada é isolada numa variável de forma PLANA para o erro não
        // fluir para o resto do hook. Mesma receita do #1497
        // (`metrics_studio_panels`).
        //
        // Ordem correta (runbook): apply em prod → `gen types` apontando para
        // PROD → apagar esta ponte e voltar ao `.from("deals")` tipado.
        type LinhaNegocio = { id: string; title: string | null; qualification_tier: string | null };
        const tabelaDeals = (supabase as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              in: (col: string, vals: string[]) => Promise<{
                data: LinhaNegocio[] | null;
                error: { message: string } | null;
              }>;
            };
          };
        }).from("deals");

        const { data: dealRows, error: dealsError } = await tabelaDeals
          .select("id, title, qualification_tier")
          .in("id", dealIds);
        if (dealsError) throw new Error(dealsError.message);
        for (const d of dealRows ?? []) {
          if (!d.id) continue;
          if (d.title) dealTitleById.set(d.id, d.title);
          dealTierById.set(d.id, d.qualification_tier ?? null);
        }
      }

      type StageInfo = { name: string; role: string | null; position: number | null };

      // Stages de funil system são chaveadas por (pipeline_type, stage_key).
      const systemStage = new Map<string, StageInfo>();
      for (const s of stagesRes.data ?? []) {
        const row = s as {
          pipeline_type: string;
          stage_key: string;
          name: string;
          stage_role: string | null;
          position: number | null;
        };
        systemStage.set(`${row.pipeline_type}::${row.stage_key}`, {
          name: row.name,
          role: row.stage_role ?? null,
          position: row.position ?? null,
        });
      }

      // Custom: a entry grava ora o uuid da stage, ora o stage_key. Indexa os dois
      // (mesma tolerância de `useLeadAllPipelines`).
      const customStage = new Map<string, StageInfo>();
      /**
       * `${pipeline_id}::${stage_key}` → uuid da etapa. A trilha custom é
       * indexada por uuid (é o que `custom_pipe_entries` guarda na maioria das
       * linhas), mas parte das entries guarda o `stage_key`. Sem esta tradução
       * o `indexOf` devolve -1 e o card fica SEM barra de progresso — some em
       * silêncio, que é como o defeito sobreviveu.
       */
      const uuidPorStageKey = new Map<string, string>();
      for (const s of customStagesRes.data ?? []) {
        const row = s as {
          id: string;
          pipeline_id: string;
          stage_key: string | null;
          name: string;
          stage_role: string | null;
          position: number | null;
        };
        const value: StageInfo = {
          name: row.name,
          role: row.stage_role ?? null,
          position: row.position ?? null,
        };
        customStage.set(`${row.pipeline_id}::${row.id}`, value);
        if (row.stage_key) {
          customStage.set(`${row.pipeline_id}::${row.stage_key}`, value);
          uuidPorStageKey.set(`${row.pipeline_id}::${row.stage_key}`, row.id);
        }
      }

      /**
       * Etapas ativas de cada funil, em ordem, para o progresso do negócio.
       * Chave: `pipeline_type` nos funis system, `pipeline_id` nos custom —
       * a mesma dualidade que os dois mapas de etapa acima já carregam.
       */
      const trilhaPorFunil = new Map<string, string[]>();
      for (const s of stagesRes.data ?? []) {
        const row = s as { pipeline_type: string; stage_key: string; position: number | null };
        const lista = trilhaPorFunil.get(row.pipeline_type) ?? [];
        lista.push(`${row.position ?? 0}::${row.stage_key}`);
        trilhaPorFunil.set(row.pipeline_type, lista);
      }
      for (const s of customStagesRes.data ?? []) {
        const row = s as { pipeline_id: string; id: string; position: number | null };
        const lista = trilhaPorFunil.get(row.pipeline_id) ?? [];
        lista.push(`${row.position ?? 0}::${row.id}`);
        trilhaPorFunil.set(row.pipeline_id, lista);
      }
      for (const [chave, lista] of trilhaPorFunil) {
        lista.sort((a, b) => Number(a.split("::")[0]) - Number(b.split("::")[0]));
        trilhaPorFunil.set(
          chave,
          lista.map((item) => item.split("::").slice(1).join("::")),
        );
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

        // Custom guarda ora o uuid da etapa, ora o `stage_key`; a trilha é
        // indexada por uuid, então tenta os dois antes de desistir.
        const trilha = trilhaPorFunil.get(isSystem ? stageType : raw.pipeline_id) ?? [];
        // Funil system indexa a trilha por `stage_key`; custom, por uuid. A
        // entry custom guarda ora um, ora outro — daí a tradução antes de
        // procurar. O comentário acima sempre disse "tenta os dois"; o código
        // só tentava um, e todo card cuja entry guardava `stage_key` perdia a
        // barra de progresso.
        const chaveNaTrilha = !raw.stage_key
          ? null
          : isSystem
            ? raw.stage_key
            : (uuidPorStageKey.get(`${raw.pipeline_id}::${raw.stage_key}`) ?? raw.stage_key);
        const posicaoNaTrilha = chaveNaTrilha ? trilha.indexOf(chaveNaTrilha) : -1;

        const dealId = (raw as { deal_id?: string | null }).deal_id ?? null;

        const deal: LeadDeal = {
          id: raw.id,
          leadId: raw.lead_id,
          dealId,
          qualificationTier: dealId ? (dealTierById.get(dealId) ?? null) : null,
          title: (dealId ? dealTitleById.get(dealId) : undefined) ?? pipeline.name ?? "Funil",
          funnelName: pipeline.name ?? "Funil",
          funnelColor: pipeline.color ?? FALLBACK_COLOR,
          pipelineId: raw.pipeline_id,
          pipelineSlug: slug,
          isSystem,
          stageKey: raw.stage_key,
          // Stage inativa/renomeada não vira card fantasma: mostra a chave crua
          // em vez de sumir. Mesma classe do incidente ghost-stage do lead-webhook.
          stageName: stage?.name ?? raw.stage_key ?? "sem etapa",
          stagePosition: stage?.position ?? null,
          stageIndex: posicaoNaTrilha >= 0 ? posicaoNaTrilha : null,
          stageCount: trilha.length,
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
