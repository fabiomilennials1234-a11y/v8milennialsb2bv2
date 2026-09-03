import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isMissingSchemaError } from "@/lib/rpc-errors";
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

/**
 * Desfecho derivado do PAPEL DA ETAPA — o modelo anterior a 20270904000000.
 *
 * Continua existindo como QUEDA, não como fonte: entre o merge do front e o
 * apply da migration, `deals.outcome` não existe e este é o único sinal. Some
 * quando a coluna estiver preenchida em toda linha.
 */
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

      const [entriesRes, pipelinesRes, stagesRes] = await Promise.all([
        supabase
          .from("pipeline_entries")
          .select("id, lead_id, pipeline_id, stage_key, entered_at, stage_changed_at, metadata, deal_id")
          .eq("organization_id", organizationId)
          .in("lead_id", ids),
        supabase
          .from("pipelines")
          // `is_active` faltava aqui — as duas queries vizinhas já filtravam.
          // Sem isso, funil excluído continuava emprestando nome e cor para as
          // colunas "Situação" e "Negócios" da lista de Leads. Vale também para
          // os funis que já estavam soft-deletados antes do hard delete.
          .select("id, slug, name, color, type")
          .eq("organization_id", organizationId)
          .eq("is_active", true),
        // Pós-F1 (20270906001000) TODA etapa — system ou custom — vive em
        // `pipeline_stages` com FK `pipeline_id`. Uma query serve as duas
        // famílias; morreram a leitura da view `custom_pipeline_stages` e o
        // mapa slug→pipeline_type (SCRUM-637).
        supabase
          .from("pipeline_stages")
          .select("id, pipeline_id, stage_key, name, stage_role, position")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .not("pipeline_id", "is", null),
      ]);

      if (entriesRes.error) throw entriesRes.error;
      if (pipelinesRes.error) throw pipelinesRes.error;
      if (stagesRes.error) throw stagesRes.error;

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
      const dealOutcomeById = new Map<string, DealOutcome>();
      if (dealIds.length > 0) {
        // 🔴 DUAS CONSULTAS, E A SEPARAÇÃO É O PONTO.
        //
        // A primeira versão pedia `select("id, title, outcome")` numa consulta
        // só. `outcome` nasce na migration 20270904000000, que é aplicada
        // DEPOIS do merge do front — e enquanto ela não roda, o PostgREST
        // responde 42703/PGRST204 para a projeção inteira. Com o `throw` logo
        // abaixo, isso derrubava `leads-deals` por completo: não era o botão de
        // desfecho que parava de funcionar, era o CARD que sumia.
        //
        // O título é obrigatório e continua podendo estourar. O desfecho é
        // opcional por natureza — antes de 20270904000000 ele não existe, e
        // depois dele 26,6% das entradas seguem sem linha em `deals` — então a
        // falta dele degrada para a queda por papel de etapa, que é exatamente
        // o comportamento anterior a esta feature.
        const { data: dealRows, error: dealsError } = await supabase
          .from("deals")
          .select("id, title")
          .in("id", dealIds);
        if (dealsError) throw dealsError;
        for (const d of dealRows ?? []) {
          if (d.id && d.title) dealTitleById.set(d.id, d.title);
        }

        const { data: outcomeRows, error: outcomeError } = await supabase
          .from("deals")
          .select("id, outcome")
          .in("id", dealIds);

        // Silêncio DELIBERADO e estreito: só para migration pendente. Qualquer
        // outro erro (rede, RLS, timeout) continua invisível aqui porque o
        // desfecho é opcional — mas não vira exceção que apaga o card.
        if (outcomeError && !isMissingSchemaError(outcomeError)) {
          console.warn("[useLeadsDeals] desfecho não lido:", outcomeError.message);
        }
        for (const d of outcomeRows ?? []) {
          if (d.id && (d.outcome === "won" || d.outcome === "lost" || d.outcome === "open")) {
            dealOutcomeById.set(d.id, d.outcome);
          }
        }
      }

      type StageInfo = { name: string; role: string | null; position: number | null };

      /**
       * Etapa indexada por `${pipeline_id}::<chave>` — nas DUAS chaves que uma
       * entry pode carregar (`stage_key` e uuid), porque a entry grava ora um,
       * ora outro (tolerância herdada de `useLeadAllPipelines`). Sem a dupla
       * indexação o card fica sem etapa/barra de progresso — some em silêncio,
       * que é como o defeito sobreviveu da última vez.
       */
      const stageInfo = new Map<string, StageInfo>();
      /** `${pipeline_id}::${stage_key}` → uuid da etapa (chave da trilha). */
      const uuidPorStageKey = new Map<string, string>();
      /** Etapas ativas de cada funil (uuid, em ordem) — o progresso do negócio. */
      const trilhaPorFunil = new Map<string, string[]>();
      {
        const porPosicao = new Map<string, { pos: number; id: string }[]>();
        for (const s of stagesRes.data ?? []) {
          // `pipeline_id` ainda não está no types.ts gerado (regen → SCRUM-639).
          const row = s as unknown as {
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
          stageInfo.set(`${row.pipeline_id}::${row.id}`, value);
          if (row.stage_key) {
            stageInfo.set(`${row.pipeline_id}::${row.stage_key}`, value);
            uuidPorStageKey.set(`${row.pipeline_id}::${row.stage_key}`, row.id);
          }
          const lista = porPosicao.get(row.pipeline_id) ?? [];
          lista.push({ pos: row.position ?? 0, id: row.id });
          porPosicao.set(row.pipeline_id, lista);
        }
        for (const [pid, lista] of porPosicao) {
          lista.sort((a, b) => a.pos - b.pos);
          trilhaPorFunil.set(pid, lista.map((x) => x.id));
        }
      }

      const map: LeadDealsMap = {};

      for (const raw of entriesRes.data ?? []) {
        if (!raw.lead_id || !raw.pipeline_id) continue;
        const pipeline = pipelineById.get(raw.pipeline_id);
        if (!pipeline) continue; // entry órfã de funil apagado — não inventa negócio

        const isSystem = pipeline.type === "system";
        const slug = pipeline.slug ?? "";

        const stage = raw.stage_key
          ? stageInfo.get(`${raw.pipeline_id}::${raw.stage_key}`)
          : undefined;

        const metadata = asObject(raw.metadata);
        const stageChangedAt = raw.stage_changed_at ?? raw.entered_at ?? null;

        // A trilha é indexada por uuid; a entry guarda ora o `stage_key`, ora o
        // próprio uuid — traduz antes de procurar (fallback: já era uuid).
        const trilha = trilhaPorFunil.get(raw.pipeline_id) ?? [];
        const chaveNaTrilha = !raw.stage_key
          ? null
          : (uuidPorStageKey.get(`${raw.pipeline_id}::${raw.stage_key}`) ?? raw.stage_key);
        const posicaoNaTrilha = chaveNaTrilha ? trilha.indexOf(chaveNaTrilha) : -1;

        const dealId = (raw as { deal_id?: string | null }).deal_id ?? null;
        const desfechoDoNegocio = dealId ? dealOutcomeById.get(dealId) ?? null : null;

        const deal: LeadDeal = {
          id: raw.id,
          leadId: raw.lead_id,
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
          // 🔴 A ORDEM IMPORTA. O desfecho é do NEGÓCIO (ADR-0023 Emenda 1), e a
          // etapa é só queda para quem ainda não tem linha em `deals` — 26,6%
          // das entradas — e para o intervalo entre este merge e o apply.
          //
          // Invertido, um negócio ganho numa etapa comum voltaria a aparecer
          // como aberto, que é exatamente o que a feature existe para permitir.
          outcome: desfechoDoNegocio ?? outcomeOf(stage?.role),
          won: (desfechoDoNegocio ?? outcomeOf(stage?.role)) === "won",
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
