import { useMemo } from "react";

import { useTeamMembers } from "@/modules/identity";
import { useLeadDetail } from "../lead-detail/hooks/useLeadDetail";
import { useLeadsDeals } from "../../hooks/useLeadsDeals";
import { useLeadsSalesMetrics } from "../../hooks/useLeadsSalesMetrics";
import { useLeadsCarteiraMetrics } from "../../hooks/useLeadsCarteiraMetrics";
import { useLeadTimeline } from "../../hooks/useLeadTimeline";
import { useLeadCustomFields, useLeadCustomFieldValues } from "../../hooks/useLeadCustomFields";
import { mergeDataMetrics } from "../../lib/data-metrics";
import { deriveLeadStanding } from "../../lib/lead-relacao-situacao";
import type {
  LeadCardData,
  LeadCardDeal,
  LeadCardEvent,
  LeadCardFieldGroup,
  TipoDeEvento,
} from "./types";

/**
 * Liga o Card do Lead aos dados reais.
 *
 * Camada de tradução, sem regra de negócio própria: cada valor já tem dono em
 * algum lugar do módulo, e este arquivo só põe no formato que o card consome.
 * Relação e Situação vêm de `lib/lead-relacao-situacao`; a precedência entre
 * venda de funil e pedido de ERP vem de `lib/data-metrics`. Duplicar qualquer
 * uma das duas aqui criaria a segunda verdade que a fatia inteira existe para
 * matar.
 *
 * Todos os hooks abaixo já rodavam na aba de Leads ou no modal — nenhum
 * caminho novo de leitura entra no produto por causa deste card.
 */

/** `lead_history.action` → o tipo que a linha do tempo desenha. */
function tipoDoEvento(action: string, source: string): TipoDeEvento {
  if (
    action.startsWith("whatsapp_") ||
    action.startsWith("send_whatsapp") ||
    action === "message_sent" ||
    action === "document_sent"
  ) {
    return "mensagem";
  }
  if (action === "comment_added" || action === "note_added") return "comentario";
  if (action === "stage_changed" || action.startsWith("proposal_")) return "negocio";
  if (action === "lead_created") return "lead";
  if (action === "field_updated" || action.includes("responsible")) return "campo";
  if (source === "automation" || source === "agent") return "automacao";
  return "campo";
}

/** Rótulo humano quando o autor não é uma pessoa da equipe. */
function autorDeSistema(source: string): string | null {
  if (source === "automation") return "Automação";
  if (source === "agent") return "Copilot";
  return null;
}

/**
 * Leitores estreitos para as linhas que chegam sem tipo forte.
 *
 * `useLeadDetail` faz `select("*")` com joins que o tipo gerado não cobre, e
 * `useTeamMembers` lê uma view (`org_visible_members`) fora do schema tipado.
 * `any` aqui apagaria justamente a checagem que importa — que só estes campos
 * são lidos.
 */
type Linha = Record<string, unknown>;

function texto(linha: Linha, chave: string): string | null {
  const v = linha[chave];
  return typeof v === "string" && v !== "" ? v : null;
}

/** Nome de um join `team_members!fk(id, name)`. */
function nomeDoJoin(linha: Linha, chave: string): string | null {
  const v = linha[chave];
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const nome = (v as Linha).name;
  return typeof nome === "string" && nome !== "" ? nome : null;
}

/**
 * O par `{id, name}` de um join de `team_members`.
 *
 * Irmão de `nomeDoJoin`, e existe porque editar precisa do id: o nome sozinho
 * não diz ao `ResponsibleSlot` qual membro marcar na lista.
 */
function membroDoJoin(linha: Linha, chave: string): { id: string; name: string } | null {
  const v = linha[chave];
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const m = v as Linha;
  return typeof m.id === "string" && typeof m.name === "string" && m.name !== ""
    ? { id: m.id, name: m.name }
    : null;
}

function diasDesde(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export interface LeadCardSource {
  data: LeadCardData | null;
  isLoading: boolean;
  /** Ecoa `useLeadDetail` — quem decide o que a tela mostra quando nega. */
  visibility: ReturnType<typeof useLeadDetail>["visibility"];
}

export function useLeadCardData(leadId: string | null, isOpen: boolean): LeadCardSource {
  const { lead, isLoading, visibility } = useLeadDetail(leadId, isOpen);

  // Os três hooks de lote aceitam lista; aqui a lista tem um id só. A queryKey
  // deles é ordenada, então o cache da aba de Leads não colide com o do card.
  const ids = useMemo(() => (leadId ? [leadId] : []), [leadId]);
  const { data: dealsMap } = useLeadsDeals(ids);
  const { data: vendasMap } = useLeadsSalesMetrics(ids);
  const { data: carteiraMap } = useLeadsCarteiraMetrics(ids);

  const timeline = useLeadTimeline(leadId ?? undefined);
  const { data: definicoes = [] } = useLeadCustomFields();
  const { data: valores = [] } = useLeadCustomFieldValues(leadId);
  const { data: equipe = [] } = useTeamMembers();

  const data = useMemo<LeadCardData | null>(() => {
    if (!lead) return null;

    const l = lead as Linha;
    const id = String(l.id);
    const negociosCrus = dealsMap?.[id] ?? [];
    const vendas = vendasMap?.[id];
    const carteira = carteiraMap?.[id];

    const standing = deriveLeadStanding({ deals: negociosCrus, vendas, carteira });
    const metricasDeCompra = mergeDataMetrics(carteiraMap, vendasMap)[id];

    const negocios: LeadCardDeal[] = negociosCrus.map((d) => ({
      id: d.id,
      titulo: d.title,
      funil: d.funnelName,
      funilCor: d.funnelColor,
      etapa: d.stageName,
      valor: d.value,
      estado: d.outcome === "won" ? "ganho" : d.outcome === "lost" ? "perdido" : "aberto",
      diasNaEtapa: d.daysInStage,
      diasEmAberto: diasDesde(d.enteredAt),
      etapaIndice: d.stageIndex,
      etapaTotal: d.stageCount,
    }));

    // Autor: `lead_history.created_by` ora traz o id do membro, ora o do
    // usuário de auth. Casa pelos dois e, sem casar, cai no rótulo de sistema —
    // melhor "Automação" do que um uuid na tela.
    const nomePorId = new Map<string, string>();
    for (const bruto of equipe as unknown[]) {
      if (!bruto || typeof bruto !== "object") continue;
      const m = bruto as Linha;
      const nome = texto(m, "name");
      if (!nome) continue;
      if (typeof m.id === "string") nomePorId.set(m.id, nome);
      if (typeof m.user_id === "string") nomePorId.set(m.user_id, nome);
    }

    const historico: LeadCardEvent[] = (timeline.data?.events ?? []).map((e) => ({
      id: e.id,
      tipo: tipoDoEvento(e.action, e.source),
      // A frase pronta vem do banco. O card não a reescreve nem a fatia — dado
      // com chave dentro vira bug de exibição.
      texto: e.description ?? e.action.replace(/_/g, " "),
      autor: (e.created_by ? nomePorId.get(e.created_by) : undefined) ?? autorDeSistema(e.source),
      quando: e.created_at,
    }));

    const porDefinicao = new Map(valores.map((v) => [v.field_id, v.value]));
    const camposDaOrg = definicoes.map((d) => ({
      chave: d.id,
      rotulo: d.field_name,
      valor: porDefinicao.get(d.id) ?? null,
      personalizado: true,
      vazio: "Não informado",
    }));

    // ⚠️ A `chave` de campo do sistema É O NOME DA COLUNA em `leads` — o
    // container a usa direto no `update`. Rótulo em português aqui grava
    // numa coluna que não existe; era o que estava escrito antes de rodar.
    const campos: LeadCardFieldGroup[] = [
      {
        titulo: "Perfil",
        campos: [
          { chave: "name", rotulo: "Nome", valor: texto(l, "name"), tipo: "texto" },
          { chave: "company", rotulo: "Empresa", valor: texto(l, "company"), tipo: "texto", vazio: "Informe a empresa" },
          { chave: "email", rotulo: "E-mail", valor: texto(l, "email"), tipo: "email", vazio: "nome@empresa.com.br" },
          { chave: "phone", rotulo: "Telefone", valor: texto(l, "phone"), tipo: "telefone", vazio: "(00) 00000-0000" },
          // ⚠️ As quatro abaixo NÃO existem como coluna em `leads` (medido em
          // prod 2026-08-04). Aparecem vazias por decisão do CTO — some da tela
          // é o que faz ninguém nunca preencher — mas continuam apenas de
          // leitura até a migration que cria as colunas. Ver o resumo da sessão.
          { somenteLeitura: true, chave: "documento", rotulo: "CPF / CNPJ", valor: null, tipo: "documento", vazio: "Informe o documento" },
          { somenteLeitura: true, chave: "site", rotulo: "Site", valor: null, tipo: "url", vazio: "www.exemplo.com.br" },
          { somenteLeitura: true, chave: "nascimento", rotulo: "Nascimento / fundação", valor: null, tipo: "data", vazio: "dd/mm/aaaa" },
        ],
      },
      {
        titulo: "Endereço",
        campos: [
          { chave: "uf", rotulo: "Estado", valor: texto(l, "uf"), tipo: "texto", vazio: "UF" },
          { somenteLeitura: true, chave: "cidade", rotulo: "Cidade", valor: null, tipo: "texto", vazio: "Informe a cidade" },
          { somenteLeitura: true, chave: "logradouro", rotulo: "Logradouro", valor: null, tipo: "texto", vazio: "Rua, número" },
          { somenteLeitura: true, chave: "cep", rotulo: "CEP", valor: null, tipo: "texto", vazio: "00000-000" },
        ],
      },
      {
        titulo: "Comercial",
        campos: [
          // `origin` e `qualification_tier` são ENUM no banco. Texto livre aqui
          // grava valor inválido e derruba o update inteiro — só leitura até
          // terem seletor, que é como o drawer V2 já os edita.
          { somenteLeitura: true, chave: "origin", rotulo: "Origem", valor: texto(l, "origin"), tipo: "texto" },
          { chave: "segment", rotulo: "Segmento", valor: texto(l, "segment"), tipo: "texto", vazio: "Informe o segmento" },
          { chave: "faturamento", rotulo: "Faturamento", valor: texto(l, "faturamento"), tipo: "moeda", vazio: "Informe o faturamento" },
          { somenteLeitura: true, chave: "qualification_tier", rotulo: "Qualificação", valor: texto(l, "qualification_tier"), tipo: "texto", vazio: "Sem qualificação" },
        ],
      },
      ...(camposDaOrg.length > 0
        ? [{ titulo: "Campos da organização", campos: camposDaOrg }]
        : []),
    ];

    // Mesma precedência de `LeadListRow`: venda → pré-venda → responsável.
    // Um dono só, e o papel vai no title para o nome não brigar por espaço.
    const nomeVenda = nomeDoJoin(l, "sale_responsible");
    const nomePreVenda = nomeDoJoin(l, "pre_sale_responsible");
    const nomeResp = nomeDoJoin(l, "responsible");
    const dono = nomeVenda
      ? { nome: nomeVenda, papel: "Responsável de venda" }
      : nomePreVenda
        ? { nome: nomePreVenda, papel: "Responsável de pré-venda" }
        : nomeResp
          ? { nome: nomeResp, papel: "Responsável" }
          : null;

    return {
      id,
      edicao: {
        preVenda: membroDoJoin(l, "pre_sale_responsible"),
        venda: membroDoJoin(l, "sale_responsible"),
        preQualificacao: texto(l, "pre_qualification_tier"),
        qualificacao: texto(l, "qualification_tier"),
        atualizadoEm: texto(l, "updated_at"),
      },
      nome: texto(l, "name") ?? "",
      empresa: texto(l, "company"),
      telefone: texto(l, "phone"),
      email: texto(l, "email"),
      uf: texto(l, "uf"),
      origem: texto(l, "origin") ?? "",
      criadoEm: String(l.created_at ?? ""),

      relacao: standing.relacao,
      prova: standing.prova,
      situacao: standing.maisAvancado
        ? { funil: standing.maisAvancado.funnelName, funilCor: standing.maisAvancado.funnelColor }
        : null,

      dono,
      copilotAtivo: l.ai_disabled !== true,

      tags: (Array.isArray(l.lead_tags) ? l.lead_tags : [])
        .map((linha) => (linha as Linha | null)?.tag)
        .filter((t): t is Linha => !!t && typeof t === "object")
        .map((t) => ({ id: String(t.id), nome: String(t.name) })),

      metricas: {
        acumulado: metricasDeCompra?.lifetimeValue ?? 0,
        ticketMedio: metricasDeCompra?.avgTicket ?? 0,
        pedidos: metricasDeCompra?.orderCount ?? 0,
        cicloDias: metricasDeCompra?.reorderCycleDays ?? null,
        ultimaCompraDias: metricasDeCompra?.daysSinceLastOrder ?? null,
        // Idade sai de `created_at`, que existe para 100% dos leads — e não do
        // `daysSinceFirstContact` da timeline, que mede o primeiro EVENTO e
        // fica vazio em lead sem histórico.
        idadeDias: diasDesde(texto(l, "created_at")) ?? 0,
        semContatoDias: diasDesde(timeline.data?.metrics.lastContact),
      },

      negocios,
      nota: texto(l, "notes") ?? "",
      campos,
      historico,
    };
  }, [lead, dealsMap, vendasMap, carteiraMap, timeline.data, definicoes, valores, equipe]);

  return { data, isLoading, visibility };
}
