/**
 * Recorte temporal e corpo da chamada de `/flow/crm/pedidos` — puro, testável.
 *
 * Está fora do handler porque a decisão "que intervalo pedir" é a única parte
 * desta sincronização que dá para provar sem o ERP no ar. O transporte não
 * pôde ser exercitado (a porta 3000 não responde de fora), e é justamente por
 * isso que a parte provável tem que ficar provada.
 *
 * 🔑 **O serviço EXIGE janela.** O corpo leva `dataInicial` e `dataFinal`, e
 * não existe modo "traga tudo" — ao contrário de `/clientes`, que devolve a
 * base inteira quando não filtramos. Então não há default seguro por omissão:
 * alguém precisa decidir o intervalo, e a decisão é de configuração.
 */

/** Dias relidos a cada execução quando a org não configurou nada. */
export const JANELA_PADRAO_DIAS = 90;

/**
 * Teto de janela numa execução só.
 *
 * O alvo é o servidor de UMA empresa, e `dataInicial: "2025-01-01"` com
 * `hasNext: true` (o caso da captura do fornecedor) é uma varredura de anos.
 * Um backfill assim é legítimo — mas tem que ser pedido, não acontecer porque
 * alguém digitou um número grande no campo de janela.
 */
export const JANELA_MAXIMA_DIAS = 3650;

export interface PedidosWindowConfig {
  /** `toth_connections.pedidos_janela_dias`. */
  janelaDias?: number | null;
  /** `toth_connections.pedidos_data_inicial` — piso do backfill (`aaaa-mm-dd`). */
  dataInicialConfigurada?: string | null;
  /** Override do corpo da requisição, para sondagem manual. */
  dataInicial?: string | null;
  dataFinal?: string | null;
  /** Instante de referência. Injetado para o teste não depender do relógio. */
  agora?: Date;
}

export interface PedidosWindow {
  dataInicial: string;
  dataFinal: string;
  /** De onde veio o início: informa o log e a tela, sem exigir dedução. */
  origem: "corpo" | "backfill" | "janela";
  dias: number;
}

const DIA_MS = 86_400_000;
/**
 * O ERP raciocina no calendário de Brasília; a edge function roda em UTC.
 *
 * Sem este deslocamento, entre 21h e 24h BRT o "hoje" do runtime já é amanhã, e
 * `dataFinal` sairia um dia à frente. Não quebra nada (o limite superior é
 * inclusivo), mas faz a janela deslizar um dia por execução noturna e torna o
 * log impossível de conferir contra a tela do Toth.
 */
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

function toIsoDate(d: Date): string {
  return new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

/** `aaaa-mm-dd` válido? Rejeita `2026-13-40` — regex sozinha aceitaria. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Resolve o intervalo a pedir ao ERP.
 *
 * Precedência, do mais explícito ao mais automático:
 *  1. **corpo da requisição** — quem está sondando manda;
 *  2. **`pedidos_data_inicial`** — o piso do backfill configurado;
 *  3. **`pedidos_janela_dias`** — o regime permanente.
 *
 * A janela relê o passado de propósito. Pedido emitido entra como `NORMAL` e
 * vira `FATURADO` dias depois; uma janela que só avançasse registraria o pedido
 * para sempre como não faturado — a receita do CRM divergiria do financeiro do
 * cliente sem nenhum erro visível.
 */
export function resolvePedidosWindow(config: PedidosWindowConfig = {}): PedidosWindow {
  const agora = config.agora ?? new Date();
  const hoje = toIsoDate(agora);

  const dataFinal = isIsoDate(config.dataFinal) ? config.dataFinal : hoje;

  let dataInicial: string;
  let origem: PedidosWindow["origem"];

  if (isIsoDate(config.dataInicial)) {
    dataInicial = config.dataInicial;
    origem = "corpo";
  } else if (isIsoDate(config.dataInicialConfigurada)) {
    dataInicial = config.dataInicialConfigurada;
    origem = "backfill";
  } else {
    const bruto =
      typeof config.janelaDias === "number" && config.janelaDias > 0
        ? Math.floor(config.janelaDias)
        : JANELA_PADRAO_DIAS;
    const dias = Math.min(bruto, JANELA_MAXIMA_DIAS);
    dataInicial = toIsoDate(new Date(agora.getTime() - dias * DIA_MS));
    origem = "janela";
  }

  // Intervalo invertido é configuração errada, não caso de borda: pedir
  // `dataInicial > dataFinal` devolveria zero pedido com cara de "não houve
  // venda". Colapsar num dia só torna o resultado óbvio para quem lê.
  if (dataInicial > dataFinal) dataInicial = dataFinal;

  const dias =
    Math.round(
      (Date.parse(`${dataFinal}T00:00:00Z`) - Date.parse(`${dataInicial}T00:00:00Z`)) / DIA_MS,
    ) + 1;

  return { dataInicial, dataFinal, origem, dias };
}

/**
 * `type`, não `interface`, de propósito: só o alias de tipo ganha a assinatura
 * de índice implícita que o torna atribuível a `Record<string, unknown>` — que
 * é o parâmetro de `postEnvelope`. Com `interface`, o corpo montado aqui não
 * compila no chamador.
 */
export type PedidosRequestBody = {
  dataInicial: string;
  dataFinal: string;
  page: number;
  numeroInscricao?: string[];
};

/**
 * Monta o corpo da chamada.
 *
 * ⚠️ **`numeroInscricao` é obrigatório ou opcional? Não sabemos.** A captura do
 * fornecedor manda uma lista de dois CNPJs; outra captura, do mesmo endpoint,
 * traz na resposta um documento que não está nessa lista — o que sugere que a
 * chamada também funciona sem o filtro. Sugere, não prova.
 *
 * Por isso a lista é OMITIDA quando vazia, em vez de virar `[]`: uma lista
 * vazia explícita é a forma mais provável de o serviço devolver zero pedido
 * obedecendo — o pior resultado possível, porque parece "não há vendas". Se ao
 * exercitar o serviço ele exigir o filtro, o caminho pronto é
 * `cnpj_da_carteira: true` no handler, que preenche com os documentos da
 * carteira em lotes.
 */
export function buildPedidosBody(params: {
  window: PedidosWindow;
  page: number;
  numeroInscricao?: string[];
}): PedidosRequestBody {
  const body: PedidosRequestBody = {
    dataInicial: params.window.dataInicial,
    dataFinal: params.window.dataFinal,
    page: params.page,
  };
  const docs = (params.numeroInscricao ?? [])
    .map((d) => String(d).replace(/\D/g, ""))
    .filter((d) => d.length > 0);
  if (docs.length > 0) body.numeroInscricao = docs;
  return body;
}

/** Parte a lista de documentos em lotes — o corpo tem limite que ninguém documentou. */
export function chunkDocumentos(docs: string[], tamanho = 50): string[][] {
  if (tamanho < 1) return docs.length ? [docs] : [];
  const lotes: string[][] = [];
  for (let i = 0; i < docs.length; i += tamanho) lotes.push(docs.slice(i, i + tamanho));
  return lotes;
}
