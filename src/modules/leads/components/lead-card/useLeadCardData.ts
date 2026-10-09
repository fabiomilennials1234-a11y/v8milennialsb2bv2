import { useMemo } from "react";

import { useFeaturePermission, useOrganization, useTeamMembers } from "@/modules/identity";
import { useLeadDetail } from "../lead-detail/hooks/useLeadDetail";
import { useLeadComments } from "../lead-detail/hooks/useLeadComments";
import { useLeadsDeals } from "../../hooks/useLeadsDeals";
import { useProdutosPorNegocio } from "./useProdutosPorNegocio";
import { useLeadsSalesMetrics } from "../../hooks/useLeadsSalesMetrics";
import { useLeadsCarteiraMetrics } from "../../hooks/useLeadsCarteiraMetrics";
import { useLeadTimeline } from "../../hooks/useLeadTimeline";
import { useLeadCustomFields, useLeadCustomFieldValues } from "../../hooks/useLeadCustomFields";
import { mergeDataMetrics } from "../../lib/data-metrics";
import { deriveLeadStanding } from "../../lib/lead-relacao-situacao";
import { useOrgUsaLeiDoErp } from "../../hooks/useOrgUsaLeiDoErp";
import { useCafeJurereCadastro } from "../../hooks/useCafeJurereCadastro";
import { aplicarCadastroCafeJurere } from "../../lib/cafe-jurere-cadastro";
import { useLeadDocument } from "../../hooks/useLeadDocument";
import { camposDeOrigemDaCampanha } from "./campos-de-origem-da-campanha";
import { resolveLeadOwners, rotuloDoPapel, type LeadOwnersSource } from "../../lib/lead-owners";
import { useLeadOwners, useLeadOwnersEnabled } from "../../hooks/useLeadOwners";
import type {
  LeadCardData,
  LeadCardDeal,
  LeadCardEvent,
  LeadCardField,
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

/**
 * O par `{id, name}` de um join de `team_members!fk(id, name)`.
 *
 * Existe porque editar precisa do id: o nome sozinho não diz ao
 * `ResponsibleSlot` qual membro marcar na lista. O nome de exibição vem de
 * `resolveLeadOwners`.
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

/**
 * ── CAMPO DA ORG RESPONDIDO SOBE PARA O PERFIL ────────────────────────────
 * Decisão do CTO (25/08): o que veio do FORMULÁRIO — comprador, prazo, volume,
 * o que cada org perguntou no seu funil — é dado de qualificação, e estava
 * atrás da ÚLTIMA aba de uma coluna de 356px. Quem abre o negócio para decidir
 * não ia até lá; na prática o lead chegava qualificado e a resposta morria a
 * dois cliques de distância.
 *
 * O corte deixa de ser "de onde o campo veio" (sistema × org) e passa a ser
 * "alguém já respondeu isto":
 *   · respondido    → entra no Perfil, junto de nome/e-mail/telefone;
 *   · nunca tocado  → fica em "Campos a preencher", que continua VISÍVEL pelo
 *                     mesmo motivo de sempre (sumir é o que faz ninguém
 *                     preencher) e agora diz na aba o que espera de quem lê.
 *
 * Cada campo aparece em exatamente UM dos dois. Uma aba "Campos da organização"
 * repetindo os respondidos seria a segunda verdade que este arquivo existe para
 * evitar.
 *
 * ── POR QUE "TEM LINHA" E NÃO "O VALOR NÃO ESTÁ VAZIO" ────────────────────
 * A diferença aparece no segundo em que alguém APAGA o conteúdo de um campo do
 * Perfil: pelo valor, o campo pularia de aba embaixo do cursor de quem acabou
 * de editá-lo. Pela linha em `lead_custom_field_values`, ele fica onde está,
 * vazio, e pode ser repreenchido ali mesmo. Campo nunca respondido não tem
 * linha e continua na outra aba.
 * O custo são 115 linhas de valor vazio em 64.397 (prod, 25/08) subindo para o
 * Perfil — 0,2%, todas de webhook que gravou string vazia.
 *
 * Escala: média de 4 respondidos por lead, p90 = 9, 27 no pior lead de prod. O
 * Perfil cresce com o que tem dado, não com os 38 rótulos vazios da maior org.
 *
 * ⚠️ `tipo` fica de fora de propósito. `field_type` da definição conhece
 * `date`, e virar `tipo: "data"` poria um `<input type="date">` na frente de
 * valor que veio de webhook em formato livre ("31/12/2024"): o input recusa,
 * mostra vazio, e o primeiro blur GRAVA o vazio por cima. Texto não perde dado.
 */
export function separarCamposDaOrg(
  definicoes: { id: string; field_name: string }[],
  valores: { field_id: string; value: string | null }[],
): { respondidos: LeadCardField[]; aPreencher: LeadCardField[] } {
  const porDefinicao = new Map(valores.map((v) => [v.field_id, v.value]));
  const respondidos: LeadCardField[] = [];
  const aPreencher: LeadCardField[] = [];

  for (const d of definicoes) {
    const campo: LeadCardField = {
      chave: d.id,
      rotulo: d.field_name,
      valor: porDefinicao.get(d.id) ?? null,
      personalizado: true,
      vazio: "Não informado",
    };
    (porDefinicao.has(d.id) ? respondidos : aPreencher).push(campo);
  }

  return { respondidos, aPreencher };
}

export interface LeadCardSource {
  data: LeadCardData | null;
  isLoading: boolean;
  /** Ecoa `useLeadDetail` — quem decide o que a tela mostra quando nega. */
  visibility: ReturnType<typeof useLeadDetail>["visibility"];
  /** Org sob a qual se grava um comentário. `null` = a ficha fica só de leitura. */
  organizacaoId: string | null;
  /** `team_members.id` de quem olha — é por ele que se decide quem edita. */
  membroId: string | null;
  souAdmin: boolean;
}

export function useLeadCardData(leadId: string | null, isOpen: boolean): LeadCardSource {
  const { usaLeiDoErp } = useOrgUsaLeiDoErp();
  const { lead, isLoading, visibility } = useLeadDetail(leadId, isOpen);
  const { organizationId, teamMemberId, role } = useOrganization();
  const cadastroErp = useCafeJurereCadastro(leadId, isOpen && !!lead && !!texto(lead as Linha, "erp_code") && (lead as Linha).cafe_jurere_erp_elegivel === true);
  const { data: documentoLocal } = useLeadDocument(leadId, isOpen && !!lead);
  const { allowed: podeEditarDocumento } = useFeaturePermission("leads.edit_document");
  // N donos por lead (Chamado 793f4b05): consulta própria e só na org com a
  // flag — `useLeadDetail` (e o cache que tanta gente escreve) fica intocado.
  const donosMultiplos = useLeadOwnersEnabled();
  const { data: donosDoLead } = useLeadOwners(leadId, isOpen && !!lead && donosMultiplos);

  // Os três hooks de lote aceitam lista; aqui a lista tem um id só. A queryKey
  // deles é ordenada, então o cache da aba de Leads não colide com o do card.
  const ids = useMemo(() => (leadId ? [leadId] : []), [leadId]);
  const { data: dealsMap } = useLeadsDeals(ids);
  // Os produtos de cada negócio. Consulta própria, e não mais um campo em
  // `useLeadsDeals`: aquele hook é o de LOTE da aba de Leads, e pendurar
  // `deal_items` nele custaria a consulta em toda listagem de lead, por uma
  // informação que só esta ficha desenha.
  const { data: produtosPorNegocio } = useProdutosPorNegocio(leadId, isOpen);
  const { data: vendasMap } = useLeadsSalesMetrics(ids);
  const { data: carteiraMap } = useLeadsCarteiraMetrics(ids);

  const timeline = useLeadTimeline(leadId ?? undefined);
  /**
   * ── Por que os comentários entram por FORA da timeline ───────────────────
   * `useLeadTimeline` pagina em 20 (`PAGE_SIZE`) e esta ficha nunca chama
   * `loadMore` — não há "carregar mais" no Histórico. Como 73% de
   * `lead_history` é tráfego de WhatsApp, o comentário de julho cai fora da
   * janela: medido em prod, **401 dos 2.906 comentários (13,8%) e 144 leads
   * inteiros** não têm um único comentário dentro dos 20 eventos mais
   * recentes. Filtrar pelo chip "Comentários" não resolve — ele filtra o que
   * já veio cortado.
   *
   * Ler `lead_comments` direto conserta as duas coisas de uma vez: traz o
   * histórico COMPLETO e traz o corpo INTEIRO (a linha de histórico só tem
   * "Comentário adicionado" mais um preview de 120 caracteres).
   */
  const { data: comentarios = [] } = useLeadComments(isOpen ? leadId : null);
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

    const standing = deriveLeadStanding({ deals: negociosCrus, vendas, carteira, usaLeiDoErp });
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
      produtos: produtosPorNegocio?.[d.id] ?? [],
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

    /**
     * `comment_added` sai da timeline e volta pela lista de comentários.
     *
     * Sem esta linha o mesmo comentário apareceria DUAS vezes: uma como linha
     * de histórico sem texto, outra como comentário de verdade. Descartar a de
     * histórico não perde nada — ela não carrega nenhum dado que a linha de
     * `lead_comments` não tenha melhor.
     */
    const eventos: LeadCardEvent[] = (timeline.data?.events ?? [])
      .filter((e) => e.action !== "comment_added")
      .map((e) => ({
        id: e.id,
        tipo: tipoDoEvento(e.action, e.source),
        // A frase pronta vem do banco. O card não a reescreve nem a fatia —
        // dado com chave dentro vira bug de exibição.
        texto: e.description ?? e.action.replace(/_/g, " "),
        autor: (e.created_by ? nomePorId.get(e.created_by) : undefined) ?? autorDeSistema(e.source),
        quando: e.created_at,
      }));

    /**
     * Apagado é soft-delete e continua na tabela. Fica de fora pela mesma
     * decisão já tomada no painel do Negócio: a lápide "Comentário apagado"
     * virava ruído, e a auditoria não se perde — `fn_log_lead_comment_event`
     * grava `comment_deleted` em `lead_history`.
     */
    const deComentario: LeadCardEvent[] = comentarios
      .filter((c) => !c.deleted_at)
      .map((c) => {
        // Autoria pelo MEMBRO, não pelo usuário: é o mesmo critério do painel
        // do Negócio, e falha fechada — sem membro conhecido ninguém edita.
        const souOAutor = !!teamMemberId && c.author_team_member_id === teamMemberId;
        return {
          id: `comentario:${c.id}`,
          tipo: "comentario" as const,
          // O texto do evento existe para o chip e para a busca; quem desenha o
          // corpo é o bloco de comentário, com quebra de linha preservada.
          texto: "Comentário",
          autor: c.author?.name ?? nomePorId.get(c.author_user_id ?? "") ?? null,
          quando: c.created_at,
          comentario: {
            id: c.id,
            corpo: c.body,
            editadoEm: c.updated_at ?? null,
            podeEditar: souOAutor,
            podeApagar: souOAutor || role === "admin",
          },
        };
      });

    const historico: LeadCardEvent[] = [...eventos, ...deComentario].sort(
      (a, b) => new Date(b.quando).getTime() - new Date(a.quando).getTime(),
    );

    const { respondidos: orgPreenchidos, aPreencher: orgVazios } = separarCamposDaOrg(
      definicoes,
      valores,
    );

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
          // CPF/CNPJ NÃO é coluna de `leads`: o valor editado no Torque mora em
          // `lead_documents` e só a RPC `set_lead_document` grava (o container
          // tem ramo próprio para esta chave). Vale para todas as orgs; na
          // Café Jurerê, `aplicarCadastroCafeJurere` põe o valor do ERP por
          // baixo. A trava é só de permissão (Chamado 93027ffb).
          {
            somenteLeitura: !podeEditarDocumento,
            chave: "documento",
            rotulo: "CPF / CNPJ",
            valor: documentoLocal?.document ?? null,
            alteradoLocalmente: !!documentoLocal,
            tipo: "documento",
            vazio: "Informe o documento",
          },
          // ⚠️ As duas abaixo NÃO existem como coluna em `leads` (medido em
          // prod 2026-08-04). Aparecem vazias por decisão do CTO — some da tela
          // é o que faz ninguém nunca preencher — mas continuam apenas de
          // leitura até a migration que cria as colunas.
          { somenteLeitura: true, chave: "site", rotulo: "Site", valor: null, tipo: "url", vazio: "www.exemplo.com.br" },
          { somenteLeitura: true, chave: "nascimento", rotulo: "Nascimento / fundação", valor: null, tipo: "data", vazio: "dd/mm/aaaa" },
          // O que a org perguntou no formulário e o lead respondeu. Vem por
          // último para não empurrar telefone e e-mail para baixo da dobra da
          // coluna — a ordem é "quem é" antes de "o que respondeu".
          ...orgPreenchidos,
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
      ...camposDeOrigemDaCampanha(l),
      ...(orgVazios.length > 0
        ? [{ titulo: "Campos a preencher", campos: orgVazios }]
        : []),
    ];

    // Mesma regra de `LeadListRow`: sem o embed `lead_owners` (org sem N
    // donos) é um dono só, por precedência venda → pré-venda → responsável;
    // com o embed, todos os donos, principal primeiro (Chamado 793f4b05).
    const owners = donosDoLead && donosDoLead.length > 0 ? donosDoLead : resolveLeadOwners(l as LeadOwnersSource);
    const donos = owners.map((o) => ({ nome: o.name, papel: rotuloDoPapel(o) }));
    const dono = donos[0] ?? null;
    const coDonos = owners
      .filter((o) => o.papeis.length === 1 && o.papeis[0] === "co")
      .map((o) => ({ id: o.id, name: o.name }));

    return {
      id,
      edicao: {
        preVenda: membroDoJoin(l, "pre_sale_responsible"),
        venda: membroDoJoin(l, "sale_responsible"),
        ...(coDonos.length > 0 ? { coDonos } : {}),
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
        ? {
            funil: standing.maisAvancado.funnelName,
            funilCor: standing.maisAvancado.funnelColor,
            negocioId: standing.maisAvancado.id,
          }
        : null,

      dono,
      ...(donos.length > 1 ? { donos } : {}),
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
        clienteId: carteira?.clientId ?? null,
      },

      negocios,
      nota: texto(l, "notes") ?? "",
      campos: cadastroErp.data ? aplicarCadastroCafeJurere(campos, cadastroErp.data, documentoLocal?.document ?? null) : cadastroErp.isFetching || cadastroErp.isError ? [
        ...campos,
        { titulo: "Cadastro no ERP", campos: [{ chave: "erp_carregamento", rotulo: "Sincronização", valor: cadastroErp.isError ? "Não foi possível carregar os dados. Reabra o cartão para tentar novamente." : "Carregando dados do ERP…", somenteLeitura: true, origemErp: true }] },
      ] : campos,
      historico,
    };
  }, [
    usaLeiDoErp,
    cadastroErp.data,
    cadastroErp.isFetching,
    cadastroErp.isError,
    documentoLocal,
    podeEditarDocumento,
    lead,
    donosDoLead,
    dealsMap,
    produtosPorNegocio,
    vendasMap,
    carteiraMap,
    timeline.data,
    comentarios,
    definicoes,
    valores,
    equipe,
    teamMemberId,
    role,
  ]);

  /**
   * A org do LEAD vem antes da associação de quem olha — é o que mantém o
   * usuário master comentando: ele não está em `team_members`, então
   * `useOrganization()` devolve `null` para ele, mas as policies de
   * `lead_comments` têm bypass de master. Mesmo critério do `useDealCardData`.
   */
  const organizacaoDoLead = (() => {
    const v = (lead as Linha | null)?.organization_id;
    return typeof v === "string" && v !== "" ? v : null;
  })();

  return {
    data,
    isLoading,
    visibility,
    organizacaoId: organizacaoDoLead ?? organizationId ?? null,
    membroId: teamMemberId ?? null,
    souAdmin: role === "admin",
  };
}
