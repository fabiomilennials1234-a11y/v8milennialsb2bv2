/**
 * Canonical ERP entities — provider-neutral shapes every adapter maps into
 * (ADR-0020). Providers translate their payloads to these; the sync layer only
 * ever sees canonical types.
 */

export interface CanonicalClient {
  /** ERP's immutable id (persisted as external_id). */
  externalId: string;
  /** Our uuid bridge for upsert (external_ref), when the ERP echoes it. */
  externalRef: string | null;
  /** CNPJ/CPF, digits only. The cross-provider match key. */
  cnpj: string | null;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;

  /**
   * Enriquecimento opcional. Todo campo abaixo é `?` de propósito: adapters que
   * não os produzem (Omie, Tiny) seguem compilando e o sync grava só o que veio.
   */

  /** Empresa do grupo que atende o cliente no ERP. */
  erpCompany?: string | null;
  /** Vendedor dono da conta — rótulo, não vínculo com team_members. */
  ownerName?: string | null;
  ownerExternalId?: string | null;
  /**
   * Situação do parceiro no ERP, **crua**. Não normalizar: o Toth devolve
   * 0/1/2/3 sem legenda, e traduzir para ativo/inativo seria inventar.
   */
  erpStatus?: string | null;
  /** Segmento / tipo de mercado. */
  segment?: string | null;
  /** Data de cadastro NO ERP (ISO). Cadastro não é venda. */
  registeredAt?: string | null;
  /**
   * Data do último pedido FATURADO no ERP (ISO, `aaaa-mm-dd`).
   *
   * É a única medida de recência que o cadastro de cliente carrega, e por isso
   * vale mais do que parece: com ela a carteira sabe quem esfriou antes de
   * existir sincronização de pedidos. Não confundir com a janela `diasCompras`
   * do Toth, que filtra por **pedido** — um cliente pode estar dentro da janela
   * e não ter esta data, porque pediu e ainda não faturou.
   */
  lastOrderAt?: string | null;
  city?: string | null;
  /** UF em duas letras maiúsculas, ou null. */
  uf?: string | null;
  /** Campos sem coluna dedicada — endereço completo, IE, tipo de pessoa. */
  metadata?: Record<string, unknown> | null;
}

export interface CanonicalOrder {
  /** ERP's immutable order id (persisted as external_id). */
  externalId: string;
  externalRef: string | null;
  /**
   * ERP id of the order's client — used to resolve the Carteira Client.
   *
   * Nulo quando o ERP identifica o cliente do pedido só pelo documento: é o caso
   * do Toth, cujo `/pedidos` traz `numeroinscricao` e não `codigoCliente`. Nesse
   * caso a resolução cai para `clientCnpj`.
   */
  clientExternalId: string | null;
  /** CNPJ/CPF do cliente, só dígitos. Recuo quando não há id externo. */
  clientCnpj?: string | null;
  saleValue: number;
  productName: string;
  /** ISO sale date, or null → let the DB default to now(). */
  soldAt: string | null;
  /** ERP-side stage (Omie's etapa). NOT the CRM pipeline stage. */
  etapa: string | null;
  /**
   * Situação do pedido no ERP, **crua** (Toth: `NORMAL`, `FATURADO`, ...).
   *
   * Guardada como veio. Ela decide se o pedido conta como receita — ver
   * `approvalForErpStatus` em `sync/upsert-order.ts` —, e traduzir aqui
   * esconderia o valor original de quem for auditar o número depois.
   */
  erpStatus?: string | null;
  /** Itens do pedido, quando o ERP os devolve. */
  items?: CanonicalOrderItem[];
}

/** Uma linha de pedido: produto, quantidade e preço unitário. */
export interface CanonicalOrderItem {
  /** Código do produto no ERP. Chave para casar com o catálogo, quando houver. */
  productExternalId: string | null;
  description: string;
  quantity: number;
  unitValue: number;
  /**
   * Total da linha. Calculado por nós quando o ERP não manda — o Toth manda
   * `qtdpedido` e `valorunitario`, e a soma das linhas bateu com
   * `valortotalliquido` em todos os pedidos da amostra.
   */
  totalValue: number;
}

export interface CanonicalNfe {
  /** ERP's NF id (persisted as external_id). */
  externalId: string;
  externalRef: string | null;
  /** 44-digit access key. */
  chaveNfe: string | null;
  numero: string | null;
  valor: number;
  /** ISO emission date, or null. */
  dataEmissao: string | null;
  /** ERP NF status (autorizada, cancelada, ...). */
  status: string | null;
  /** ERP order id this NF invoices — used to link to the upsell_order. */
  orderExternalId: string | null;
}

export interface CanonicalProduct {
  /** Omie codigo_produto — immutable idempotency key. NEVER match on SKU. */
  externalId: string;
  externalRef: string | null;
  /** Omie codigo — the visible, user-editable SKU. */
  sku: string | null;
  name: string;
  ticket: number | null;
  baseUnit: string | null;
  description: string | null;
  isActive: boolean;
}

export type TituloStatus = "aberto" | "pago" | "atrasado";

export interface CanonicalTitulo {
  externalId: string;
  externalRef: string | null;
  clientExternalId: string | null;
  orderExternalId: string | null;
  valor: number;
  /** Due date (ISO) or null — dd/mm/yyyy parsing deferred to the S1 spike. */
  vencimento: string | null;
  status: TituloStatus;
  /** Payment timestamp (ISO) or null. */
  pagoEm: string | null;
}
