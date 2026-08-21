import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useOrganization, useTeamMembers } from "@/modules/identity";
import { useLeadDetail } from "../lead-detail/hooks/useLeadDetail";
import { useLeadsDeals } from "../../hooks/useLeadsDeals";
import { useLeadsSalesMetrics } from "../../hooks/useLeadsSalesMetrics";
import { useLeadsCarteiraMetrics } from "../../hooks/useLeadsCarteiraMetrics";
import { deriveLeadStanding } from "../../lib/lead-relacao-situacao";
import type { DealCardData, DealCardMove, DealCardStage } from "./types";

/**
 * Liga o Card do Negócio aos dados reais.
 *
 * Reusa o que já existe (`useLeadDetail` para a pessoa, `useLeadsDeals` para
 * funil/etapa/valor/tempo) e busca só o que nenhum hook traz hoje:
 *
 *   1. **a trilha do funil** — os nomes das etapas em ordem. `useLeadsDeals`
 *      devolve o índice e o total, mas não os rótulos, e o card do Negócio
 *      precisa mostrar para onde o negócio vai;
 *   2. **a movimentação da entry** — `pipeline_stage_events`, 49.739 linhas em
 *      prod que hoje não aparecem em tela nenhuma;
 *   3. **a mediana de dias parado** da mesma etapa na mesma org, que é o que
 *      transforma "74 dias" em "74 contra 21".
 *
 * A mediana é calculada no cliente sobre uma amostra limitada de propósito: um
 * `percentile_disc` server-side exigiria RPC nova — mais uma função
 * `SECURITY DEFINER` com a superfície de ACL que este repo já erra com
 * frequência. 400 linhas de uma coluna resolvem com folga.
 */

type Linha = Record<string, unknown>;

function diasDesde(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[Math.floor(ordenados.length / 2)];
}

function papelDaEtapa(role: unknown): DealCardStage["papel"] {
  return role === "won" ? "ganho" : role === "lost" ? "perdido" : "aberto";
}

/** `pipelines.slug` → `pipeline_stages.pipeline_type` dos funis system. */
const SLUG_TO_STAGE_TYPE: Record<string, string> = {
  whatsapp: "whatsapp",
  confirmacao: "confirmacao",
  propostas: "propostas",
  upsell: "upsell_base",
};

export function useDealCardData(entryId: string | null, leadId: string | null, isOpen: boolean) {
  const { organizationId } = useOrganization();
  const { lead, isLoading: carregandoLead } = useLeadDetail(leadId, isOpen);

  const ids = useMemo(() => (leadId ? [leadId] : []), [leadId]);
  const { data: dealsMap } = useLeadsDeals(ids);
  const { data: vendasMap } = useLeadsSalesMetrics(ids);
  const { data: carteiraMap } = useLeadsCarteiraMetrics(ids);
  const { data: equipe = [] } = useTeamMembers();

  const negocioBase = useMemo(
    () => (dealsMap?.[leadId ?? ""] ?? []).find((d) => d.id === entryId) ?? null,
    [dealsMap, leadId, entryId],
  );

  const extras = useQuery({
    queryKey: ["deal-card-extras", entryId, negocioBase?.pipelineId, negocioBase?.stageKey],
    enabled: isOpen && !!entryId && !!organizationId && !!negocioBase,
    staleTime: 60_000,
    queryFn: async () => {
      const pipelineId = negocioBase!.pipelineId;
      const isSystem = negocioBase!.isSystem;
      const stageType = SLUG_TO_STAGE_TYPE[negocioBase!.pipelineSlug] ?? negocioBase!.pipelineSlug;

      const [entryRes, etapasRes, movRes, amostraRes] = await Promise.all([
        supabase
          .from("pipeline_entries")
          // `deal_id` entra aqui para o negócio poder ser lido de `deals`.
          .select("id, notes, assigned_to, metadata, entered_at, deal_id")
          .eq("id", entryId!)
          .maybeSingle(),
        isSystem
          ? supabase
              .from("pipeline_stages")
              .select("stage_key, name, stage_role, position")
              .eq("organization_id", organizationId!)
              .eq("pipeline_type", stageType)
              .eq("is_active", true)
              .order("position")
          : supabase
              .from("custom_pipeline_stages")
              .select("id, name, stage_role, position")
              .eq("pipeline_id", pipelineId)
              .eq("is_active", true)
              .order("position"),
        supabase
          .from("pipeline_stage_events")
          .select("id, from_stage_key, to_stage_key, occurred_at, actor, source")
          .eq("entry_id", entryId!)
          .order("occurred_at", { ascending: false }),
        // Amostra para a mediana: mesma org, mesmo funil, mesma etapa.
        supabase
          .from("pipeline_entries")
          .select("stage_changed_at")
          .eq("organization_id", organizationId!)
          .eq("pipeline_id", pipelineId)
          .eq("stage_key", negocioBase!.stageKey ?? "")
          .limit(400),
      ]);

      /**
       * O NEGÓCIO em si — `deals`. Vai numa segunda rodada porque depende do
       * `deal_id`, que só se conhece depois de ler a entrada.
       *
       * Até aqui o app inteiro lia de `deals` apenas `id, title`
       * (`useLeadsDeals.ts:179-181`): valor, probabilidade, previsão de
       * fechamento e desfecho estavam no banco e não chegavam à tela. E
       * `deal_items`, que guarda os produtos do negócio desde a Wave 1, nunca
       * teve um leitor.
       */
      const dealId = typeof entryRes.data?.deal_id === "string" ? entryRes.data.deal_id : null;
      const [negocioRes, itensRes] = dealId
        ? await Promise.all([
            supabase
              .from("deals")
              .select("id, value, currency, probability, expected_close_date, closed_at, won, loss_reason, created_at")
              .eq("id", dealId)
              .maybeSingle(),
            supabase
              .from("deal_items")
              // a coluna e `product_name`, nao `name` — o tipo gerado pegou o erro
              .select("id, product_name, quantity, unit_price, total, sort_order")
              .eq("deal_id", dealId),
          ])
        : [{ data: null }, { data: [] }];

      return {
        entry: (entryRes.data ?? null) as Linha | null,
        etapas: (etapasRes.data ?? []) as Linha[],
        movimentos: (movRes.data ?? []) as Linha[],
        amostra: (amostraRes.data ?? []) as Linha[],
        negocio: (negocioRes?.data ?? null) as Linha | null,
        itens: (itensRes?.data ?? []) as Linha[],
      };
    },
  });

  const data = useMemo<DealCardData | null>(() => {
    if (!lead || !negocioBase) return null;
    const l = lead as Linha;

    const standing = deriveLeadStanding({
      deals: dealsMap?.[String(l.id)] ?? [],
      vendas: vendasMap?.[String(l.id)],
      carteira: carteiraMap?.[String(l.id)],
    });

    const entry = extras.data?.entry ?? null;
    const metadata =
      entry?.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
        ? (entry.metadata as Linha)
        : {};

    const etapas: DealCardStage[] = (extras.data?.etapas ?? []).map((e) => ({
      // System chaveia por `stage_key`; custom, pelo uuid da etapa. A entry
      // guarda ora um, ora outro — a mesma dualidade de `useLeadsDeals`.
      chave: String(e.stage_key ?? e.id),
      nome: String(e.name ?? ""),
      papel: papelDaEtapa(e.stage_role),
    }));

    const nomePorChave = new Map(etapas.map((e) => [e.chave, e.nome]));

    const movimentacoes: DealCardMove[] = (extras.data?.movimentos ?? []).map((m) => ({
      id: String(m.id),
      de: m.from_stage_key ? (nomePorChave.get(String(m.from_stage_key)) ?? String(m.from_stage_key)) : null,
      para: nomePorChave.get(String(m.to_stage_key)) ?? String(m.to_stage_key ?? ""),
      quando: String(m.occurred_at ?? ""),
      autor: typeof m.actor === "string" && m.actor !== "" ? m.actor : null,
      origem:
        m.source === "automation" ? "automacao" : m.source === "manual" ? "manual" : "sistema",
    }));

    const amostra = (extras.data?.amostra ?? [])
      .map((a) => diasDesde(typeof a.stage_changed_at === "string" ? a.stage_changed_at : null))
      .filter((d): d is number => d !== null);

    const meetingDate = typeof metadata.meeting_date === "string" ? metadata.meeting_date : null;

    return {
      id: negocioBase.id,
      titulo: negocioBase.title,
      estado:
        negocioBase.outcome === "won"
          ? "ganho"
          : negocioBase.outcome === "lost"
            ? "perdido"
            : "aberto",

      lead: (() => {
        /**
         * O lead já estava TODO em memória — `useLeadDetail(leadId)` no topo
         * deste hook — e o card usava quatro campos dele. O resto vinha do
         * banco a cada abertura e era jogado fora.
         */
        const txt = (chave: string): string | null => {
          const v = l[chave];
          return typeof v === "string" && v.trim() !== "" ? v : null;
        };
        const nomeDoMembro = (chave: string): string | null => {
          const v = l[chave];
          if (v && typeof v === "object" && !Array.isArray(v)) {
            const n = (v as Linha).name;
            if (typeof n === "string" && n !== "") return n;
          }
          return null;
        };
        const etiquetas = Array.isArray(l.lead_tags)
          ? (l.lead_tags as unknown[])
              .map((lt) => {
                const t = (lt as Linha)?.tag as Linha | undefined;
                const nome = typeof t?.name === "string" ? t.name : null;
                return nome ? { nome, cor: typeof t?.color === "string" ? t.color : "#888888" } : null;
              })
              .filter((t): t is { nome: string; cor: string } => t !== null)
          : [];

        return {
          id: String(l.id),
          nome: String(l.name ?? ""),
          empresa: txt("company"),
          telefone: txt("phone"),
          relacao: standing.relacao,
          email: txt("email"),
          origem: txt("origin"),
          chegouEm: txt("created_at"),
          qualificacao: txt("qualification_tier"),
          preQualificacao: txt("pre_qualification_tier"),
          responsaveis: {
            preVenda: nomeDoMembro("pre_sale_responsible"),
            venda: nomeDoMembro("sale_responsible"),
          },
          etiquetas,
          faturamento: txt("faturamento"),
        };
      })(),

      funil: negocioBase.funnelName,
      funilCor: negocioBase.funnelColor,
      pipeTable: negocioBase.isSystem
        ? negocioBase.pipelineSlug === "whatsapp"
          ? "pipe_whatsapp"
          : negocioBase.pipelineSlug === "confirmacao"
            ? "pipe_confirmacao"
            : negocioBase.pipelineSlug === "propostas"
              ? "pipe_propostas"
              : null
        : null,
      etapas,
      etapaAtual: negocioBase.stageKey ?? "",

      // `assigned_to` é id de membro. Sem resolver o nome, o card mostrava o
      // uuid cru na linha do funil — pego na primeira abertura contra dado real.
      dono: (() => {
        const id = typeof entry?.assigned_to === "string" ? entry.assigned_to : null;
        if (!id) return null;
        for (const bruto of equipe as unknown[]) {
          if (!bruto || typeof bruto !== "object") continue;
          const m = bruto as Linha;
          if ((m.id === id || m.user_id === id) && typeof m.name === "string" && m.name !== "") {
            return m.name;
          }
        }
        // Membro de fora da org visível (o caso cross-org que o M6 trava):
        // melhor omitir do que estampar um uuid.
        return null;
      })(),

      diasEmAberto: diasDesde(negocioBase.enteredAt),
      diasNaEtapa: negocioBase.daysInStage,
      medianaDaEtapa: mediana(amostra),

      valor: negocioBase.value,
      moeda: "BRL",
      produto: typeof metadata.product_type === "string" ? metadata.product_type : null,

      // ── o negócio, lido de `deals` ──────────────────────────────────────
      ...(() => {
        const n = extras.data?.negocio ?? null;
        const num = (v: unknown): number | null =>
          typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : null;
        const str = (v: unknown): string | null =>
          typeof v === "string" && v !== "" ? v : null;
        return {
          valorDoNegocio: num(n?.value),
          probabilidade: num(n?.probability),
          previsaoFechamento: str(n?.expected_close_date),
          fechadoEm: str(n?.closed_at),
          criadoEm: str(n?.created_at),
          itens: (extras.data?.itens ?? []).map((i) => ({
            id: String(i.id),
            nome: typeof i.product_name === "string" ? i.product_name : "Item",
            quantidade: num(i.quantity) ?? 1,
            precoUnitario: num(i.unit_price) ?? 0,
            total: num(i.total) ?? 0,
          })),
        };
      })(),

      reuniao: meetingDate
        ? {
            data: meetingDate,
            confirmada: metadata.is_confirmed === true,
            link: typeof metadata.meet_link === "string" ? metadata.meet_link : null,
          }
        : null,

      // O desfecho vem da posição enquanto `deals.closed_at` não existe em
      // prod (0 linhas). Quando o backfill do L3 rodar, a fonte troca sem
      // mexer no card.
      desfecho:
        negocioBase.outcome === "open"
          ? null
          : {
              quando: negocioBase.stageChangedAt ?? "",
              valorVenda: negocioBase.outcome === "won" ? negocioBase.value : null,
              motivo: typeof metadata.loss_reason === "string" ? metadata.loss_reason : null,
            },

      movimentacoes,
      nota: typeof entry?.notes === "string" ? entry.notes : "",
    };
  }, [lead, negocioBase, dealsMap, vendasMap, carteiraMap, extras.data, equipe]);

  return { data, isLoading: carregandoLead || extras.isLoading };
}
