/**
 * Formato de entrada do Card do Negócio.
 *
 * O Negócio é o que morre com a venda; o Lead é o que sobrevive a ela. Por isso
 * aqui a pessoa entra como **referência clicável**, não como conteúdo: nome e
 * empresa para saber de quem é, e o id para abrir o card dela.
 *
 * ── O QUE A MEDIÇÃO IMPÔS AO FORMATO ──────────────────────────────────────
 * Prod, 04/08/2026, sobre 38.739 cards:
 *   - `valor` existe em **1,1%**. É opcional de verdade, não "quase sempre
 *     preenchido" — o card precisa ser bom sem ele.
 *   - a média é de **1,16 movimentação por negócio**: 39.297 têm uma só, a da
 *     criação. A linha do tempo tem que ser boa com um item.
 *   - o negócio mediano está parado há **42 dias** e 57% da carteira passou de
 *     30. Tempo é o único dado que existe para 100% e o único que aponta ação.
 */

import type { LeadCardDeal } from "../lead-card/types";

export type EstadoDoNegocio = "aberto" | "ganho" | "perdido";

/**
 * `meetings.status` — o desfecho da reunião, como a Agenda o grava.
 *
 * Mora aqui, e não importado de `@/modules/engagement`, porque o card do
 * Negócio é um módulo de `leads`: puxar o tipo do outro bounded context pelo
 * barril arrastaria a Agenda inteira para o grafo de quem só quer desenhar uma
 * linha. São quatro strings, e o CHECK que as define está no banco.
 */
export type StatusDaReuniao = "scheduled" | "completed" | "no_show" | "cancelled";

export interface DealCardStage {
  /**
   * Chave de ESCRITA — o que `moverEtapa` manda de volta ao banco.
   * Funil system: o `stage_key`. Funil custom: o **uuid** da etapa, porque é
   * ele que vai em `custom_pipe_entries.stage_id`.
   */
  chave: string;
  /**
   * Chave de LEITURA — o que `pipeline_entries.stage_key` e
   * `pipeline_stage_events.to_stage_key` realmente guardam. Nos dois tipos de
   * funil é o `stage_key` (slug de texto): em funil custom o gatilho
   * `sync_custom_pipe_to_entries()` TRADUZ o uuid para o slug ao espelhar.
   *
   * Existe separada de `chave` porque um campo só não pode ser as duas coisas:
   * comparar a posição atual pelo uuid dava `-1` em todo funil custom — nenhuma
   * casa ficava marcada como "aqui" e cada círculo carimbava "—", que nesta
   * régua quer dizer "por aqui não passou". Afirmação falsa, não só ausência.
   */
  chaveEntry: string;
  nome: string;
  /** Etapa terminal — desenha diferente e encerra a trilha. */
  papel: "aberto" | "ganho" | "perdido";
}

export interface DealCardMove {
  id: string;
  de: string | null;
  para: string;
  /**
   * A CHAVE da etapa de destino, não o rótulo.
   *
   * `para` é o nome já resolvido, que é o que a lista de movimentação lê. A
   * régua precisa casar a movimentação com a casa, e casar por nome quebra em
   * duas situações reais: etapa renomeada depois do evento, e dois funis com
   * etapas de mesmo nome. `null` quando o evento aponta para uma etapa que não
   * existe mais.
   */
  paraChave: string | null;
  quando: string;
  autor: string | null;
  origem: "manual" | "automacao" | "sistema";
}

export interface DealCardLeadRef {
  id: string;
  nome: string;
  empresa: string | null;
  telefone: string | null;
  /** `Cliente` quando a pessoa já comprou alguma vez — ADR-0023 §6/§7. */
  relacao: "lead" | "cliente";

  /**
   * ── O bloco do lead DENTRO do negócio ──────────────────────────────────
   * O card nasceu com a regra "o lead é link, não conteúdo": só nome, empresa
   * e telefone, o bastante para saber de quem é o negócio. Na prática o painel
   * abria e não dizia nada — nem o nome da pessoa aparecia, porque o cabeçalho
   * mostrava `empresa ?? nome` e a empresa quase sempre existe.
   *
   * Estes campos não abrem uma segunda ficha: são o mínimo para reconhecer a
   * pessoa sem sair daqui — quem é, de onde veio, quando chegou e como falar
   * com ela. O aprofundamento continua sendo o card do Lead, a um clique.
   */
  email: string | null;
  origem: string | null;
  /** `leads.created_at` — "quando chegou". */
  chegouEm: string | null;
  qualificacao: string | null;
  preQualificacao: string | null;
  responsaveis: { preVenda: string | null; venda: string | null };
  etiquetas: Array<{ nome: string; cor: string }>;
  /** Faixa de faturamento declarada (texto livre no banco). */
  faturamento: string | null;
}

/**
 * Uma linha de `activities` — a aba "Atividades" do print.
 *
 * A tabela tem `deal_id` E `lead_id`. A aba lê por **lead**: `deal_id` só é
 * preenchido quando o negócio nasceu pelo caminho novo, e a maioria das
 * entradas de funil não tem linha em `deals` — por negócio a aba abriria vazia
 * quase sempre.
 */
export interface DealCardActivity {
  id: string;
  tipo: string;
  titulo: string;
  descricao: string | null;
  resultado: string | null;
  automatica: boolean;
  quando: string;
  concluida: boolean;
}

/**
 * Uma linha de `lead_comments` — o bloco "Comentários" do painel.
 *
 * ── POR QUE ELE NÃO É A ANOTAÇÃO ──────────────────────────────────────────
 * `pipeline_entries.notes` é um campo só, sobrescrevível, sem autor e sem data:
 * serve para "o que este negócio precisa lembrar", e quem escreve depois apaga
 * quem escreveu antes. Comentário é o oposto — é append-only, tem autor, tem
 * hora e tem histórico. Os dois convivem no mesmo painel porque respondem a
 * perguntas diferentes: um é o estado, o outro é a conversa.
 *
 * ── O QUE `deOutroNegocio` RESOLVE ────────────────────────────────────────
 * 4.948 dos 40.903 leads de prod têm mais de um negócio. Sem o selo, um
 * comentário escrito na negociação de setembro apareceria dentro do upsell de
 * dezembro sem nada dizendo de onde veio — e a leitura mais natural ("isto foi
 * dito sobre ESTE negócio") seria falsa. `null` quer dizer "não precisa de
 * selo": ou nasceu aqui, ou é do lead e vale para todos.
 */
export interface DealCardComentario {
  id: string;
  corpo: string;
  autor: string;
  autorAvatar: string | null;
  /** ISO. A lista desce do mais recente para o mais antigo. */
  criadoEm: string;
  editadoEm: string | null;
  /** Título do negócio em que foi escrito, quando NÃO é o negócio aberto. */
  deOutroNegocio: string | null;
  podeEditar: boolean;
  podeApagar: boolean;
}

/**
 * Uma linha de `deal_items` — os produtos do negócio.
 *
 * ── POR QUE `produtoId` E `descontoPercent` SUBIRAM ATÉ AQUI ──────────────
 * O formato nasceu com cinco campos, e cada um dos dois que faltavam custava
 * uma capacidade:
 *
 * - **`produtoId`** é o que separa item de CATÁLOGO de item AVULSO depois de
 *   lançado. Sem ele a tabela não sabe dizer qual dos dois está olhando — e o
 *   selo "avulso" só existia durante o cadastro, sumindo no instante em que a
 *   linha era gravada. É também a identidade pela qual o mesmo produto
 *   consolida em vez de duplicar.
 * - **`descontoPercent`** é o que torna o desconto EDITÁVEL. O bloco mostrava
 *   um "Desconto (−)" agregado que era **inferido** (bruto − líquido), nunca
 *   lido: dava para ver que houve abatimento e não dava para saber de qual
 *   linha veio, nem mexer nele.
 *
 * `ordem` é `sort_order`. Ele já era selecionado pela consulta e descartado no
 * mapeamento, e a consulta não ordenava — a ordem das linhas na tela era a que
 * o Postgres devolvesse, e podia mudar sozinha entre dois carregamentos.
 */
export interface DealCardItem {
  id: string;
  nome: string;
  quantidade: number;
  precoUnitario: number;
  total: number;
  /** `products.id` quando veio do catálogo; `null` no produto avulso. */
  produtoId: string | null;
  /** Percentual 0–100 abatido nesta linha. */
  descontoPercent: number;
  /** `sort_order` — a ordem de lançamento. */
  ordem: number;
}

/**
 * O que a linha da tabela devolve quando alguém edita quantidade, preço ou
 * desconto.
 *
 * Mora aqui, e não junto do componente que o emite, porque um módulo que
 * exporta componente E outra coisa quebra o Fast Refresh do Vite
 * (`react-refresh/only-export-components`) — mesmo motivo pelo qual
 * `contaDoNegocio` tem arquivo próprio.
 */
export interface ItemEditado {
  itemId: string;
  quantidade: number;
  precoUnitario: number;
  descontoPercent: number;
}

export interface DealCardData {
  /** `pipeline_entries.id` — a posição, que é o que identifica o negócio hoje. */
  id: string;
  /**
   * `deals.id` — a IDENTIDADE do negócio, e `null` na maioria das entradas.
   *
   * O painel é chaveado pela posição (`id`), não por isto: `pipeline_entries.deal_id`
   * é NULO em quase todas as 38.156 entradas, e exigir a linha em `deals` para
   * abrir o painel deixaria a tela vazia para quase todo mundo.
   *
   * Existe porque ESCREVER exige a identidade: `deal_items.deal_id` é NOT NULL.
   * Sem este campo o painel não tem como lançar produto — e é por isso que ele
   * sobe até aqui em vez de morrer dentro do hook, como acontecia.
   */
  dealId: string | null;
  titulo: string;
  estado: EstadoDoNegocio;

  lead: DealCardLeadRef;

  funil: string;
  funilCor: string;
  /**
   * `pipelines.type === "system"` — a FAMÍLIA do funil.
   *
   * Único discriminador de escrita desde a SCRUM-637: mover escreve em
   * `pipeline_entries` (system) ou via `custom_pipe_entries` (custom, INSTEAD
   * OF com a lógica viva), e a exclusão idem. O campo `pipeTable` (nome de
   * view por switch de slug) morreu — silenciava funil de sistema com slug
   * fora do trio.
   */
  funilEhSystem: boolean;
  /** Trilha completa do funil, para a barra mostrar onde ele está e o que falta. */
  etapas: DealCardStage[];
  etapaAtual: string;

  dono: string | null;

  /** Dias desde `entered_at`. */
  diasEmAberto: number | null;
  /** Dias desde `stage_changed_at`. */
  diasNaEtapa: number | null;
  /**
   * Mediana de dias parado dos negócios da MESMA org e etapa. O alerta compara
   * com isto em vez de um número fixo: a 30 dias fixos, 22.060 dos 38.403
   * negócios abertos acenderiam, e alarme que toca sempre não é alarme.
   */
  medianaDaEtapa: number | null;

  valor: number;
  moeda: string;
  produto: string | null;

  /**
   * ── O que estava no banco e o painel não lia ───────────────────────────
   * De `deals` o app inteiro selecionava apenas `id, title`
   * (`useLeadsDeals.ts:179-181`), e o `valor` acima vem de
   * `metadata.sale_value`, não de `deals.value` — por isso um negócio com
   * valor gravado aparecia sem a seção "Valor".
   */
  valorDoNegocio: number | null;
  probabilidade: number | null;
  previsaoFechamento: string | null;
  fechadoEm: string | null;
  criadoEm: string | null;
  /** `deal_items` — tabela que existe desde a Wave 1 e nenhuma tela lia. */
  itens: DealCardItem[];

  /**
   * A reunião deste negócio — DUAS fontes, e cada campo sabe de qual veio.
   *
   * `data`, `link` e `confirmada` continuam saindo da PROJEÇÃO
   * (`pipeline_entries.metadata`), não de `meetings`. Não é preguiça de migrar:
   * a projeção é o único lugar em que as duas origens de reunião se encontram
   * — o espelho da Agenda (S6) e os escritores do funil, que continuam vivos —
   * e ler `meetings` como fonte primária apagaria da tela a reunião de 93
   * negócios de prod que hoje só existem no metadata. Ler a projeção mantém
   * esse número em zero, hoje e sempre.
   *
   * De `meetings` vem só o que a projeção não sabe carregar: o DESFECHO e a
   * IDENTIDADE da reunião. Os dois vêm `null` quando não há linha em
   * `meetings` — reunião legado, ou nascida no funil — e nesse caso o bloco
   * renderiza exatamente como renderizava antes do S6.
   */
  reuniao: {
    data: string;
    confirmada: boolean;
    link: string | null;
    /**
     * `meetings.status`. `null` = a reunião não tem linha em `meetings`, ou
     * seja: ninguém pode ter marcado desfecho nela pela Agenda.
     *
     * Responde "aconteceu?", que é pergunta DIFERENTE de `confirmada` ("o lead
     * confirmou?"). Por isso os dois convivem em vez de um substituir o outro:
     * `meetings` não tem `is_confirmed` e trocar a fonte do selo mudaria o
     * significado dele sem ninguém ter decidido isso.
     */
    status: StatusDaReuniao | null;
    /**
     * `meetings.id` — a identidade da reunião na Agenda. É o que diz ao card
     * que esta reunião TEM dono na Agenda (e não é só uma data digitada no
     * funil), e é a chave de um "abrir na Agenda" no dia em que a rota
     * `/agenda` aceitar um alvo: hoje ela não lê parâmetro nenhum, então o
     * card não promete um link que a tela do outro lado não cumpriria.
     */
    meetingId: string | null;
  } | null;

  /** Preenchido só quando `estado` não é `aberto`. */
  desfecho: {
    quando: string;
    /** Valor da venda no ledger (`sale_events`), quando ganho. */
    valorVenda: number | null;
    motivo: string | null;
  } | null;

  movimentacoes: DealCardMove[];
  nota: string;

  /** `activities` do lead — a aba "Atividades" do print. */
  atividades: DealCardActivity[];

  /**
   * Os negócios do MESMO lead, este inclusive — a aba "Negócios" do print.
   *
   * Não custa consulta nova: `useLeadsDeals(leadId)` já roda no hook para achar
   * este negócio, e devolve a lista inteira. O card só jogava fora o resto.
   * É o que responde "esta pessoa tem outra coisa em aberto?" sem sair daqui —
   * um lead atravessa vários funis na mesma venda, e é exatamente aí que se
   * cobra duas vezes ou se abandona a metade que ninguém viu.
   */
  outrosNegocios: LeadCardDeal[];
}

/**
 * As abas do Card do Negócio.
 *
 * Mora aqui, e não dentro do `DealCard`, porque quem PEDE uma aba está longe
 * dela: o item "Checklists" do menu do card no funil abre o negócio já na aba
 * certa, e o pedido atravessa o `DealSheetContext`. Tipo solto em dois arquivos
 * é como as duas listas de abas saem de sincronia.
 */
export type DealCardAba = "negocio" | "atividades" | "negocios" | "checklists";
