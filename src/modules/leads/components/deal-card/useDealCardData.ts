import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useOrganization, useTeamMembers } from "@/modules/identity";
import { useLeadChecklists } from "@/modules/engagement";
import { useLeadDetail } from "../lead-detail/hooks/useLeadDetail";
import { useLeadsDeals } from "../../hooks/useLeadsDeals";
import { useProdutosPorNegocio } from "../lead-card/useProdutosPorNegocio";
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

export function useDealCardData(entryId: string | null, leadId: string | null, isOpen: boolean) {
  const { organizationId, teamMemberId, role } = useOrganization();
  const { lead, isLoading: carregandoLead } = useLeadDetail(leadId, isOpen);

  const ids = useMemo(() => (leadId ? [leadId] : []), [leadId]);
  const { data: dealsMap } = useLeadsDeals(ids);
  const { data: produtosPorNegocio } = useProdutosPorNegocio(leadId, isOpen);
  const { data: vendasMap } = useLeadsSalesMetrics(ids);
  const { data: carteiraMap } = useLeadsCarteiraMetrics(ids);
  const { data: equipe = [] } = useTeamMembers();

  /**
   * Só o SELO da aba de Checklists. O conteúdo da aba refaz a MESMA query
   * (`["checklists","lead",leadId]`) quando é montado — o React Query serve as
   * duas com uma requisição só, e marcar um item lá dentro atualiza o selo no
   * mesmo frame.
   *
   * Mora aqui, e não no `DealCardPanel`, pelo mesmo motivo já documentado no pé
   * deste arquivo: `useLeadChecklists` chama `useOrganization`, que passa por
   * `useAuth` e **lança** fora do `AuthProvider`. `cards-nunca-empilham.test`
   * monta o painel de verdade sem esse provider e mocka este hook inteiro — o
   * selo simplesmente não vem, e a aba abre sem número, que é o certo quando
   * não se sabe de quem é a organização.
   */
  const { data: checklistsDoLead } = useLeadChecklists(isOpen ? leadId : null);
  const resumoChecklists = useMemo(() => {
    if (!checklistsDoLead) return null;
    return {
      feitos: checklistsDoLead.reduce((s, c) => s + c.completed_items, 0),
      total: checklistsDoLead.reduce((s, c) => s + c.total_items, 0),
    };
  }, [checklistsDoLead]);

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

      const [entryRes, etapasRes, movRes, amostraRes, ativRes, tarefasRes] = await Promise.all([
        supabase
          .from("pipeline_entries")
          // `deal_id` entra aqui para o negócio poder ser lido de `deals`.
          .select("id, notes, assigned_to, metadata, entered_at, deal_id")
          .eq("id", entryId!)
          .maybeSingle(),
        // Pós-F1 (20270906001000) TODA etapa vive em `pipeline_stages` com FK
        // `pipeline_id` — uma query serve as duas famílias. Morreram a
        // bifurcação por `isSystem` e o mapa slug→pipeline_type (SCRUM-637).
        supabase
          .from("pipeline_stages")
          // `stage_key` entra para a régua conseguir casar a etapa: é o
          // slug que os gatilhos gravam em `pipeline_entries.stage_key`.
          .select("id, stage_key, name, stage_role, position")
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
        /**
         * Atividades — a aba de mesmo nome no print.
         *
         * Filtra por `lead_id`, não por `deal_id`: a coluna `deal_id` existe em
         * `activities`, mas só é preenchida quando o negócio nasceu pelo
         * caminho novo, e a maioria das entradas do funil não tem linha em
         * `deals`. Por lead a aba responde de verdade; por negócio ela abriria
         * vazia quase sempre — e aba que abre vazia ensina a não clicar nela.
         */
        leadId
          ? supabase
              .from("activities")
              .select("id, type, subject, description, due_date, completed_at, created_at, outcome, is_automated")
              .eq("organization_id", organizationId!)
              .eq("lead_id", leadId)
              .order("created_at", { ascending: false })
              .limit(50)
          : Promise.resolve({ data: [] as Linha[] }),

        /**
         * ── AS TAREFAS DESTE NEGÓCIO ──────────────────────────────────────
         * Follow-up e ação do dia passaram a ser do Negócio (decisão do CTO,
         * 2026-08-25 — mesma regra do checklist). A aba "Atividades" lia só
         * `activities`, que tem **0 linhas em produção**: ela abria vazia para
         * todo mundo desde que nasceu. Agora ela mostra o que existe.
         *
         * Filtra por ENTRADA, não por lead: tarefa presa a outro negócio da
         * mesma pessoa é trabalho de outro card. As da pessoa
         * (`pipeline_entry_id` nulo) também não entram aqui — elas aparecem na
         * ficha do Lead, que é de quem elas são.
         */
        entryId
          ? supabase
              .from("follow_ups")
              .select("id, title, description, due_date, completed_at, created_at, is_automated, priority")
              .eq("pipeline_entry_id", entryId)
              .is("archived_at", null)
              .order("due_date", { ascending: true })
              .limit(50)
          : Promise.resolve({ data: [] as Linha[] }),
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
              .select(
                "id, product_id, product_name, quantity, unit_price, discount_percent, total, sort_order",
              )
              // A ordem PRECISA ser pedida. `sort_order` já vinha na projeção e
              // era descartado; sem `.order()` o Postgres devolve na ordem que
              // quiser, e a tabela de produtos reembaralhava sozinha entre dois
              // carregamentos. `created_at` desempata os itens antigos, que
              // nasceram todos com `sort_order = 0`.
              .order("sort_order", { ascending: true })
              .order("created_at", { ascending: true })
              .eq("deal_id", dealId),
          ])
        : [{ data: null }, { data: [] }];

      return {
        entry: (entryRes.data ?? null) as Linha | null,
        etapas: (etapasRes.data ?? []) as Linha[],
        movimentos: (movRes.data ?? []) as Linha[],
        amostra: (amostraRes.data ?? []) as Linha[],
        atividades: (ativRes.data ?? []) as Linha[],
        tarefas: (tarefasRes.data ?? []) as Linha[],
        negocio: (negocioRes?.data ?? null) as Linha | null,
        itens: (itensRes?.data ?? []) as Linha[],
        /**
         * O id da linha em `deals`, que até aqui era calculado e descartado.
         *
         * É a chave de ESCRITA do bloco de produtos: `deal_items.deal_id` é NOT
         * NULL, então sem ele não há onde lançar item. Quem consome decide o que
         * fazer com o `null` — o painel esconde o botão e diz o porquê, em vez
         * de oferecer uma ação que falharia no INSERT.
         */
        dealId,
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
      // ESCRITA: system manda `stage_key`; custom manda o uuid, que é o que
      // `custom_pipe_entries.stage_id` espera.
      chave: negocioBase.isSystem ? String(e.stage_key ?? e.id) : String(e.id ?? e.stage_key),
      // LEITURA: nos dois tipos a entry guarda o `stage_key`. Em funil custom
      // quem traduz o uuid para o slug é o gatilho `sync_custom_pipe_to_entries`.
      chaveEntry: String(e.stage_key ?? e.id),
      nome: String(e.name ?? ""),
      papel: papelDaEtapa(e.stage_role),
    }));

    // Pela chave de LEITURA: é `to_stage_key` que chega aqui, não o uuid.
    const nomePorChave = new Map(etapas.map((e) => [e.chaveEntry, e.nome]));

    const movimentacoes: DealCardMove[] = (extras.data?.movimentos ?? []).map((m) => ({
      id: String(m.id),
      de: m.from_stage_key ? (nomePorChave.get(String(m.from_stage_key)) ?? String(m.from_stage_key)) : null,
      para: nomePorChave.get(String(m.to_stage_key)) ?? String(m.to_stage_key ?? ""),
      // A chave crua segue junto do nome: é por ela que a régua carimba a data
      // na casa certa, e ela sobrevive a renomear etapa.
      paraChave: typeof m.to_stage_key === "string" && m.to_stage_key !== "" ? m.to_stage_key : null,
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
      funilEhSystem: negocioBase.isSystem,
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
          dealId: extras.data?.dealId ?? null,
          valorDoNegocio: num(n?.value),
          probabilidade: num(n?.probability),
          previsaoFechamento: str(n?.expected_close_date),
          fechadoEm: str(n?.closed_at),
          /**
           * "Data de Criação" cai para `entered_at` quando não há linha em
           * `deals`.
           *
           * O painel é chaveado por `pipeline_entries.id`, e a linha em `deals`
           * só existe quando alguém criou o negócio pelo caminho novo —
           * `deal_id` é NULO na maioria das entradas. Sem a queda, o ladrilho
           * "Data de Criação" mostraria um traço justamente nos negócios
           * antigos, que são os que interessa datar. `entered_at` é quando o
           * negócio entrou no funil, que é a mesma pergunta respondida pelo
           * dado que existe para 100% deles.
           */
          criadoEm: str(n?.created_at) ?? negocioBase.enteredAt ?? null,
          itens: (extras.data?.itens ?? []).map((i) => ({
            id: String(i.id),
            nome: typeof i.product_name === "string" ? i.product_name : "Item",
            quantidade: num(i.quantity) ?? 1,
            precoUnitario: num(i.unit_price) ?? 0,
            total: num(i.total) ?? 0,
            produtoId: typeof i.product_id === "string" ? i.product_id : null,
            descontoPercent: num(i.discount_percent) ?? 0,
            ordem: num(i.sort_order) ?? 0,
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

      /**
       * As tarefas do negócio entram na MESMA lista da aba, e antes das
       * `activities`: as duas respondem "o que foi feito / o que falta fazer
       * com esta pessoa neste negócio", e separá-las em duas listas obrigaria o
       * vendedor a olhar em dois lugares para montar o dia dele.
       */
      atividades: ([
        ...(extras.data?.tarefas ?? []).map((t) => {
          const txt = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
          return {
            id: String(t.id),
            tipo: "task",
            titulo: txt(t.title) ?? "Tarefa",
            descricao: txt(t.description),
            resultado: txt(t.priority) === "urgent" || txt(t.priority) === "high"
              ? `prioridade ${String(t.priority)}`
              : null,
            automatica: t.is_automated === true,
            quando: txt(t.completed_at) ?? txt(t.due_date) ?? String(t.created_at ?? ""),
            concluida: txt(t.completed_at) !== null,
          };
        }),
        ...(extras.data?.atividades ?? []).map((a) => {
        const txt = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
        return {
          id: String(a.id),
          tipo: String(a.type ?? "outro"),
          // `subject` é o título; sem ele o tipo vira o título, que é o que a
          // linha precisa ter para não abrir sem rótulo.
          titulo: txt(a.subject) ?? String(a.type ?? "Atividade"),
          descricao: txt(a.description),
          resultado: txt(a.outcome),
          automatica: a.is_automated === true,
          // A data que interessa é a que o usuário marcou; sem ela, a de
          // criação. Concluída manda em tudo: ela diz que já aconteceu.
          quando: txt(a.completed_at) ?? txt(a.due_date) ?? String(a.created_at ?? ""),
          concluida: txt(a.completed_at) !== null,
        };
        }),
      ]),

      // Mesmo mapeamento do card do Lead (`useLeadCardData.ts:123-135`), sobre a
      // MESMA lista que já está em memória — `useLeadsDeals` foi consultado no
      // topo deste hook para achar `negocioBase`, e o resto era descartado.
      outrosNegocios: (dealsMap?.[String(l.id)] ?? []).map((d) => ({
        id: d.id,
        titulo: d.title,
        funil: d.funnelName,
        funilCor: d.funnelColor,
        etapa: d.stageName,
        valor: d.value,
        estado: (d.outcome === "won"
          ? "ganho"
          : d.outcome === "lost"
            ? "perdido"
            : "aberto") as DealCardData["estado"],
        diasNaEtapa: d.daysInStage,
        diasEmAberto: diasDesde(d.enteredAt),
        etapaIndice: d.stageIndex,
        etapaTotal: d.stageCount,
        // Mesma consulta que a coluna do lead usa (`["lead-card-produtos",
        // leadId]`): as duas ficam montadas juntas no painel de duas colunas e
        // o react-query resolve numa busca só. A aba "Negócios" passa a dizer
        // o que está sendo vendido em CADA negócio da pessoa, que é a pergunta
        // que ela existe para responder ("esta pessoa tem outra coisa em
        // aberto?" fica melhor respondida com o quê, não só com o quanto).
        produtos: produtosPorNegocio?.[d.id] ?? [],
      })),
    };
  }, [
    lead,
    negocioBase,
    dealsMap,
    produtosPorNegocio,
    vendasMap,
    carteiraMap,
    extras.data,
    equipe,
  ]);

  /**
   * ── Quem está olhando, e sob qual org se grava ──────────────────────────
   * Sai daqui, e não de `useIdentity` no painel, por um motivo mecânico: todo
   * hook de identidade deste repo passa por `useAuth`, que **lança** fora de um
   * `AuthProvider`. `cards-nunca-empilham.test.tsx` monta o painel de verdade
   * sem esse provider — chamar identidade lá derrubaria seis casos de um
   * guarda que não tem nada a ver com comentário. Aqui o hook inteiro já é
   * mockado naquele teste, então o campo simplesmente não vem e o painel
   * degrada para leitura, que é o comportamento certo quando não se sabe quem
   * está escrevendo.
   *
   * A org vem do LEAD antes de vir da associação de quem olha — é o que o
   * `DealDetailDialog` fazia (`lead.organization_id ?? ""`, l.188) e é o que
   * mantém o usuário master comentando: ele não está em `team_members`, então
   * `useOrganization()` devolve `null` para ele, mas as policies da tabela têm
   * bypass de master e só exigem `author_user_id = auth.uid()`.
   */
  const organizacaoDoLead = (() => {
    const v = (lead as Linha | null)?.organization_id;
    return typeof v === "string" && v !== "" ? v : null;
  })();

  return {
    data,
    isLoading: carregandoLead || extras.isLoading,
    organizacaoId: organizacaoDoLead ?? organizationId ?? null,
    membroId: teamMemberId ?? null,
    souAdmin: role === "admin",
    resumoChecklists,
  };
}
