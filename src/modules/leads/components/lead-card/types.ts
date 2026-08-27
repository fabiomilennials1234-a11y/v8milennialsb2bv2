/**
 * Formato de entrada do Card do Lead.
 *
 * Escrito para espelhar o que os hooks já devolvem (`useLeadDetail`,
 * `useLeadsDeals`, `useLeadsSalesMetrics`, `useLeadsCarteiraMetrics`,
 * `useLeadTimeline`, `useLeadCustomFieldValues`), para que ligar o card ao dado
 * real seja mapeamento, não reescrita.
 *
 * ── LEAD E CLIENTE SÃO O MESMO CARD ───────────────────────────────────────
 * Decisão do CTO, e é o que a ADR-0023 §8 já pedia: Carteira é faceta do Lead,
 * não módulo ao lado. Não existe "card de cliente" — existe este card, com
 * `relacao: "cliente"`. O sistema inteiro tem dois cards: este e o do Negócio.
 */

export type LeadRelacao = "lead" | "cliente";

/** Prova de que já comprou. `null` enquanto é `lead`. */
export type ProvaDeCompra = "funil" | "erp" | "ambas";

export type EstadoDoNegocio = "aberto" | "ganho" | "perdido";

/**
 * Um Negócio, visto de fora.
 *
 * O card do Lead **mostra** e **leva até** — não move, não muda etapa, não
 * edita valor. Isso é do Card do Negócio. Por isso aqui não há nada de
 * controle: só o que se lê e o `id` para abrir o outro card.
 */
/**
 * Uma linha de `deal_items` vista de dentro da ficha da PESSOA.
 *
 * É de propósito mais magra que a `DealCardItem` do painel do Negócio: aqui
 * ninguém edita. A ficha da pessoa responde "o que está sendo vendido", e
 * quem mexe é o painel do negócio, a um clique.
 */
export interface LeadCardDealProduto {
  nome: string;
  quantidade: number;
  precoUnitario: number;
  total: number;
  /** `product_id` nulo — produto digitado na hora, fora do catálogo da org. */
  avulso: boolean;
}

export interface LeadCardDeal {
  id: string;
  titulo: string;
  funil: string;
  funilCor: string;
  etapa: string;
  /** 0 = negócio sem valor lançado. A maioria da qualificação é assim. */
  valor: number;
  estado: EstadoDoNegocio;
  diasNaEtapa: number | null;
  /** Dias desde que o negócio entrou no funil. */
  diasEmAberto: number | null;
  /**
   * Progresso do negócio: em qual das etapas ativas ele está (0-based) e
   * quantas o funil tem. Sem o total não há barra honesta — cada org numera as
   * etapas como quer e apaga etapa no meio, então `position` sozinho não vira
   * denominador.
   */
  etapaIndice: number | null;
  etapaTotal: number;
  /**
   * Os produtos lançados NESTE negócio (`deal_items`).
   *
   * Vazio quer dizer duas coisas diferentes e a tela não tenta separá-las:
   * negócio sem produto lançado, ou card sem linha em `deals` (o `deal_id`
   * nulo dos cards que o backfill M4 não alcançou). Nos dois casos a resposta
   * honesta na ficha da pessoa é a mesma — não há produto para mostrar —, e a
   * explicação de por quê mora no painel do negócio, que é onde se resolve.
   */
  produtos: LeadCardDealProduto[];
}

/**
 * Métricas da RELAÇÃO, não do negócio.
 *
 * A diferença que justifica o bloco: "esta proposta é de R$ 12 mil" é do
 * Negócio; "esta pessoa já comprou R$ 44 mil em 24 pedidos" é do Lead.
 * Origem: `sale_events` (ledger, ADR-0017) com precedência sobre a carteira de
 * ERP — a regra vive em `lib/data-metrics.ts` e não se duplica aqui.
 */
export interface LeadCardMetrics {
  acumulado: number;
  ticketMedio: number;
  pedidos: number;
  /** Intervalo médio entre compras. `null` com menos de duas. */
  cicloDias: number | null;
  ultimaCompraDias: number | null;
  /** Dias desde `created_at`. Existe para 100% dos leads. */
  idadeDias: number;
  /** Dias desde a última mensagem trocada. `null` quando nunca houve. */
  semContatoDias: number | null;
}

export type TipoDeCampo = "texto" | "email" | "telefone" | "documento" | "url" | "data" | "moeda";

/**
 * Um campo do bloco Dados — de sistema ou personalizado, indistintamente.
 *
 * `valor: null` é estado de primeira classe: por decisão do CTO, o campo que o
 * Torque ainda não carrega **aparece vazio até alguém preencher**, em vez de
 * sumir da tela. Some da tela é o que faz ninguém nunca preencher.
 */
export interface LeadCardField {
  chave: string;
  rotulo: string;
  valor: string | null;
  tipo?: TipoDeCampo;
  /** Texto que ocupa o lugar do valor ausente. Convida, não acusa. */
  vazio?: string;
  /** Campo criado pela org, não pelo sistema. */
  personalizado?: boolean;
  /**
   * Campo que aparece mas ainda não grava — CNPJ, site, nascimento, endereço
   * não existem como coluna em `leads` (medido em prod 2026-08-04). Ficam
   * visíveis por decisão do CTO, porque sumir da tela é o que faz ninguém
   * nunca preencher; mas a interface diz que não grava, em vez de aceitar o
   * texto e perdê-lo.
   */
  somenteLeitura?: boolean;
}

export interface LeadCardFieldGroup {
  titulo: string;
  campos: LeadCardField[];
}

export type TipoDeEvento =
  | "lead"
  | "negocio"
  | "campo"
  | "mensagem"
  | "comentario"
  | "automacao";

/**
 * O comentário em si, quando o evento é um.
 *
 * Vem de `lead_comments`, e **não** de `lead_history` — a linha de histórico
 * carrega só a frase "Comentário adicionado" e um `metadata.preview` cortado em
 * **120 caracteres**, que mutila 747 dos 2.909 comentários de prod (25,7%; o
 * maior tem 1.885). Histórico de comentário que corta comentário não é
 * histórico de comentário.
 */
export interface LeadCardComentario {
  id: string;
  /** O texto inteiro, sem corte. */
  corpo: string;
  editadoEm: string | null;
  /** Só o autor edita o próprio; o painel do Negócio usa a mesma regra. */
  podeEditar: boolean;
  /** Autor ou admin. Apagar é soft-delete (`deleted_at`). */
  podeApagar: boolean;
}

export interface LeadCardEvent {
  id: string;
  tipo: TipoDeEvento;
  /** Frase pronta. Os destaques vão em `realces` para o card não parsear texto. */
  texto: string;
  realces?: string[];
  autor: string | null;
  quando: string;
  /**
   * Presente só quando o evento É um comentário da equipe. Sua ausência num
   * evento de tipo `comentario` é legítima: `note_added` também cai nesse tipo
   * e não tem linha em `lead_comments`.
   */
  comentario?: LeadCardComentario;
}

export interface LeadCardTag {
  id: string;
  nome: string;
}

export interface LeadCardData {
  id: string;
  nome: string;
  empresa: string | null;
  telefone: string | null;
  email: string | null;
  uf: string | null;
  origem: string;
  criadoEm: string;

  relacao: LeadRelacao;
  prova: ProvaDeCompra | null;
  /** O Negócio aberto mais avançado. `null` = sem negócio aberto. */
  situacao: { funil: string; funilCor: string } | null;

  dono: { nome: string; papel: string } | null;

  /**
   * O que os CONTROLES precisam e o desenho não usa: ids e tiers crus.
   *
   * `dono` acima é um NOME só, colapsado por precedência (venda → pré-venda →
   * responsável) — bom para ler, inútil para editar: `ResponsibleSlot` precisa
   * saber QUEM está marcado em CADA um dos dois campos, e isso é `{id, name}`
   * por campo. Os tiers vêm como texto porque o `types.ts` gerado ainda não
   * conhece o enum de qualificação; quem monta o controle faz o cast.
   *
   * Opcional de propósito: só a forma `coluna` (o painel do Negócio) monta
   * controle, e as fixtures da tela de visualização não precisam disto para
   * desenhar. `atualizadoEm` liga a trava otimista da escrita.
   */
  edicao?: {
    preVenda: { id: string; name: string } | null;
    venda: { id: string; name: string } | null;
    preQualificacao: string | null;
    qualificacao: string | null;
    atualizadoEm: string | null;
  };

  copilotAtivo: boolean;

  tags: LeadCardTag[];
  metricas: LeadCardMetrics;
  negocios: LeadCardDeal[];
  nota: string;
  campos: LeadCardFieldGroup[];
  historico: LeadCardEvent[];
}
