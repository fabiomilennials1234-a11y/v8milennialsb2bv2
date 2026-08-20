/**
 * Toth → canônico.
 *
 * ✅ FIXADO CONTRA PAYLOAD REAL (2026-08-18). A versão anterior deste arquivo era
 * hipótese; o fornecedor mandou exemplos de resposta de `/clientes` e
 * `/cobrancas`, e os nomes abaixo agora são o contrato observado. Os candidatos
 * alternativos que sobraram são rede de segurança para variação entre
 * instalações — o PRIMEIRO de cada lista é o campo real.
 *
 * Três coisas que o payload real ensinou e que não dava para adivinhar:
 *
 *  1. O CNPJ chama `numeroInscricao`, não `cnpj`. Já vem só com dígitos.
 *  2. E-mail e telefone **não são campos escalares** — são listas de contato
 *     (`emails[]`, `telefones[]`), e o telefone vem partido em `prefixoArea` +
 *     `numero`. Há ainda `isWhatsApp`, que decide qual número o CRM quer.
 *  3. Datas vêm em `dd/mm/aaaa` no financeiro e em `aaaa-mm-dd` no cadastro.
 *     A mesma API usa os dois formatos.
 */

import { CanonicalClient, CanonicalTitulo, TituloStatus } from "./types.ts";

/**
 * Normaliza chave para comparação: minúscula, sem acento, sem separador.
 *
 * Memoizada: os nomes de campo se repetem em TODA linha da resposta, e
 * `normalize("NFD")` mais duas regex por chave fica caro multiplicado por
 * milhares de clientes. O conjunto de chaves distintas é pequeno e limitado ao
 * schema do ERP, então o cache não cresce sem controle.
 */
const keyCache = new Map<string, string>();

function normalizeKey(key: string): string {
  const hit = keyCache.get(key);
  if (hit !== undefined) return hit;
  const norm = key
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  keyCache.set(key, norm);
  return norm;
}

/**
 * Índice normalizado por LINHA, construído uma vez e reaproveitado.
 *
 * 🔴 A versão anterior reconstruía o índice A CADA consulta de campo. Como
 * `mapTothClienteToCanonical` consulta ~6 campos e cada cliente do Toth traz
 * ~40 chaves, davam ~240 normalizações por cliente — mais de um milhão numa
 * base de alguns milhares. O sync real morreu com "CPU Time exceeded" aos 60
 * segundos por causa disso (20/08).
 *
 * O WeakMap faz o reaproveitamento sem mudar a assinatura de `pickField`, então
 * todos os chamadores ganham sem saber. Some junto com a linha.
 */
const rowIndexCache = new WeakMap<object, Map<string, unknown>>();

function fieldIndex(row: Record<string, unknown>): Map<string, unknown> {
  const cached = rowIndexCache.get(row);
  if (cached) return cached;

  const index = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    const norm = normalizeKey(key);
    if (!index.has(norm)) index.set(norm, value);
  }
  rowIndexCache.set(row, index);
  return index;
}

/**
 * Busca o primeiro campo presente entre os candidatos, comparando de forma
 * tolerante a caixa, acento e separador — `razaoSocial`, `razao_social` e
 * `RAZÃO SOCIAL` casam com o candidato `razaosocial`.
 */
export function pickField(row: Record<string, unknown>, candidates: string[]): unknown {
  const index = fieldIndex(row);
  for (const candidate of candidates) {
    const value = index.get(normalizeKey(candidate));
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function asString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    // O financeiro do Toth manda number puro, mas instalação com locale pt-BR
    // pode mandar "1.234,56". Normaliza as duas grafias.
    const normalized = value.trim().replace(/\./g, "").replace(",", ".");
    const n = Number(normalized);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Só dígitos. */
export function digitsOnly(value: unknown): string | null {
  const str = asString(value);
  if (!str) return null;
  const digits = str.replace(/\D/g, "");
  return digits.length === 0 ? null : digits;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Converte data do Toth em ISO (`aaaa-mm-dd`). Aceita os DOIS formatos que a
 * mesma API usa: `dd/mm/aaaa` no financeiro, `aaaa-mm-dd` no cadastro. Devolve
 * null para vazio ou formato desconhecido — data inválida aceita em silêncio
 * viraria título vencido em 1970, e daí receita-em-risco fantasma.
 */
export function parseTothDate(value: unknown): string | null {
  const str = asString(value);
  if (!str) return null;

  const br = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    const [, dd, mm, yyyy] = br;
    return isRealDate(+yyyy, +mm, +dd) ? `${yyyy}-${mm}-${dd}` : null;
  }

  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, yyyy, mm, dd] = iso;
    return isRealDate(+yyyy, +mm, +dd) ? `${yyyy}-${mm}-${dd}` : null;
  }
  return null;
}

/**
 * ISO (`aaaa-mm-dd`) → `dd/MM/aaaa`, o formato que `/cobrancas` exige em
 * `dataInicio` e `dataFim`. Devolve null para entrada que não seja uma data ISO
 * completa — mandar string malformada num filtro de período é pior que não
 * filtrar: a resposta volta vazia e parece "não há cobranças".
 */
export function formatTothDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const [, yyyy, mm, dd] = m;
  if (!isRealDate(+yyyy, +mm, +dd)) return null;
  return `${dd}/${mm}/${yyyy}`;
}

/** Desloca uma data ISO em N dias (negativo anda para trás). */
export function shiftIsoDate(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) throw new TothMappingError(`Data ISO inválida: "${iso}"`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Janela de consulta de `/cobrancas`, já no formato do ERP.
 *
 * Semântica confirmada pelo fornecedor em 18/08: a janela casa a parcela que foi
 * **emitida OU vence OU teve alteração** no período — um OU entre três datas, não
 * um campo só. Isso é o que torna a janela utilizável:
 *
 *  - **pagamento é alteração**, então título que muda de saldo entra na janela e
 *    é reconciliado;
 *  - **`vence no período`** é o que captura a virada aberto → atrasado. Um título
 *    que vence hoje aparece hoje; a janela para trás garante que ele reapareça
 *    nos dias seguintes até ser reprocessado com o status novo.
 *
 * A folga para trás existe por causa dessa virada, não por capricho: com janela
 * só do dia, um título que vence numa sexta e não é tocado no fim de semana só
 * seria reavaliado se algo o alterasse. Com folga, ele é revisitado.
 */
export function buildCobrancaWindow(
  todayIso: string,
  opts: { backDays: number; forwardDays: number },
): { dataInicio: string; dataFim: string } {
  const inicio = formatTothDate(shiftIsoDate(todayIso, -Math.abs(opts.backDays)));
  const fim = formatTothDate(shiftIsoDate(todayIso, Math.abs(opts.forwardDays)));
  if (!inicio || !fim) throw new TothMappingError(`Não foi possível montar a janela de ${todayIso}`);
  return { dataInicio: inicio, dataFim: fim };
}

/**
 * Agrupa CNPJs em lotes para o parâmetro multi-valor de `/cobrancas`.
 *
 * O fornecedor indicou que `cnpj=a,b,c` devolve os três — o que troca uma
 * requisição por cliente por uma requisição por lote. Ele disse "pelo que vi",
 * ou seja, não é contrato firmado: por isso o lote é conservador e o chamador
 * trata falha de lote sem derrubar os outros.
 */
export function chunkCnpjs(cnpjs: string[], size: number): string[][] {
  const clean = cnpjs.map((c) => c.replace(/\D/g, "")).filter((c) => c.length > 0);
  const unique = [...new Set(clean)];
  if (size < 1) return unique.length ? [unique] : [];

  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size));
  return out;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

// ─────────────────────────────────────────────────────────────────────────────
// Erro da API — vem no CORPO, não (só) no status
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extrai a mensagem de erro do corpo do Toth, que sinaliza falha com
 * `[{"error":"Acesso nao autorizado! "}]`.
 *
 * O status HTTP que acompanha esse corpo não está documentado e não pode ser
 * presumido. Tratar o CORPO como fonte da verdade é o que faz a expiração de
 * token ser detectada mesmo se ela vier em HTTP 200 — e o fornecedor avisou que
 * o token "expira em tempo aleatório", então esse caminho é rotina, não exceção.
 */
export function extractApiError(payload: unknown): string | null {
  const first = Array.isArray(payload) ? payload[0] : payload;
  if (!isRecord(first)) return null;
  return asString(pickField(first, ["error", "erro", "mensagem", "message"]));
}

/** Verdadeiro quando a mensagem de erro do Toth indica token inválido/expirado. */
export function isAuthErrorMessage(message: string): boolean {
  return /n[ãa]o autorizado|unauthorized|token|sess[ãa]o/i.test(message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Clientes
// ─────────────────────────────────────────────────────────────────────────────

const ID_FIELDS = ["codigoCliente", "id", "codigo"];
const CNPJ_FIELDS = ["numeroInscricao", "cnpj", "cpf", "cnpjCpf", "documento"];
const NAME_FIELDS = ["razaoSocial", "nomeFantasia", "nome"];
const COMPANY_FIELDS = ["nomeFantasia", "razaoSocial"];
/** E-mail escalar de topo — usado só quando a lista `emails[]` não resolve. */
const EMAIL_FALLBACK_FIELDS = ["emailNfe", "email"];

/** Envelopes prováveis. A resposta real de `/clientes` é um array cru na raiz. */
const LIST_ENVELOPES = [
  "clientes",
  "data",
  "content",
  "rows",
  "items",
  "result",
  "registros",
  "lista",
];

export function extractRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];

  for (const envelope of LIST_ENVELOPES) {
    const value = pickField(payload, [envelope]);
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

/** Campo do token na resposta do login — real: `{login, user, token}`. */
const TOKEN_FIELDS = ["token", "accessToken", "authToken", "jwt"];

export function extractLoginToken(payload: unknown): string | null {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return trimmed && !/\s/.test(trimmed) ? trimmed : null;
  }
  if (!isRecord(payload)) return null;

  const direct = asString(pickField(payload, TOKEN_FIELDS));
  if (direct) return direct;

  for (const nest of ["data", "result", "response", "usuario", "user"]) {
    const inner = pickField(payload, [nest]);
    if (isRecord(inner)) {
      const nested = asString(pickField(inner, TOKEN_FIELDS));
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Escolhe o e-mail do cliente na lista `emails[]`, caindo para o escalar de topo
 * (`emailNfe`). A lista traz `{tipo, endereco, nomeContato, idContato}`.
 */
export function pickEmail(row: Record<string, unknown>): string | null {
  const list = pickField(row, ["emails"]);
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (!isRecord(entry)) continue;
      const address = asString(pickField(entry, ["endereco", "email", "enderecoEmail"]));
      if (address) return address.toLowerCase();
    }
  }
  const fallback = asString(pickField(row, EMAIL_FALLBACK_FIELDS));
  return fallback ? fallback.toLowerCase() : null;
}

/**
 * Escolhe o telefone do cliente na lista `telefones[]`, montando
 * `prefixoArea + numero`.
 *
 * **Prefere o marcado como WhatsApp.** O Torque é uma ferramenta de WhatsApp: o
 * número que conversa vale mais que o primeiro da lista, que no exemplo real é
 * o fixo da recepção (`isWhatsApp: "N"`).
 */
export function pickPhone(row: Record<string, unknown>): string | null {
  const list = pickField(row, ["telefones"]);
  if (!Array.isArray(list)) return digitsOnly(pickField(row, ["telefone", "fone", "celular"]));

  const entries = list.filter(isRecord);
  const compose = (entry: Record<string, unknown>): string | null => {
    const area = digitsOnly(pickField(entry, ["prefixoArea", "ddd"])) ?? "";
    const number = digitsOnly(pickField(entry, ["numero", "telefone", "fone"]));
    if (!number) return null;
    return `${area}${number}`;
  };

  const whatsapp = entries.find(
    (e) => String(pickField(e, ["isWhatsApp", "whatsapp"]) ?? "").toUpperCase() === "S",
  );
  if (whatsapp) {
    const composed = compose(whatsapp);
    if (composed) return composed;
  }
  for (const entry of entries) {
    const composed = compose(entry);
    if (composed) return composed;
  }
  return null;
}

export class TothMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TothMappingError";
  }
}

/**
 * Traduz um cliente do Toth para `CanonicalClient`.
 *
 * Lança `TothMappingError` sem identificador: cliente sem id imutável não tem
 * chave de idempotência, e importá-lo duplicaria o registro a cada execução.
 */
export function mapTothClienteToCanonical(row: Record<string, unknown>): CanonicalClient {
  const externalId = asString(pickField(row, ID_FIELDS));
  if (!externalId) {
    throw new TothMappingError(
      `Cliente do Toth sem campo de identificação reconhecido. Campos recebidos: ${Object.keys(row).join(", ")}`,
    );
  }

  const name = asString(pickField(row, NAME_FIELDS));
  const company = asString(pickField(row, COMPANY_FIELDS));

  return {
    externalId,
    externalRef: null,
    cnpj: digitsOnly(pickField(row, CNPJ_FIELDS)),
    // `name` é NOT NULL na carteira; sem nome, o id serve de rótulo.
    name: name ?? company ?? `Cliente ${externalId}`,
    company: company ?? null,
    email: pickEmail(row),
    phone: pickPhone(row),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cobranças → Título a receber
// ─────────────────────────────────────────────────────────────────────────────

const TITULO_ID_FIELDS = ["id", "codigoTitulo", "idTitulo"];
const TITULO_CLIENT_FIELDS = ["codigoCliente", "codCliente"];
/**
 * 🔴 `valorDocumento` é o **SALDO** — o que falta receber —, não o valor do
 * título. Confirmado pelo fornecedor em 2026-08-18. O nome do campo engana:
 * "documento" sugere valor de face, e o valor de face é `valorDocumentoOriginal`.
 */
const TITULO_SALDO_FIELDS = ["valorDocumento", "saldo", "valorSaldo"];
const TITULO_ORIGINAL_FIELDS = ["valorDocumentoOriginal", "valorOriginal"];
const TITULO_VENCIMENTO_FIELDS = ["dataVencimento", "vencimento"];
/**
 * Data do último pagamento. Ainda NÃO vem no retorno — o fornecedor se ofereceu
 * a acrescentá-la ("daria pra colocar a última data de pagamento"). Os
 * candidatos ficam prontos para que a chegada do campo seja deploy, não código.
 */
const TITULO_PAGAMENTO_FIELDS = [
  "dataUltimoPagamento",
  "dataPagamento",
  "ultimoPagamento",
  "dtPagamento",
];

/**
 * Deriva a situação do título a partir do SALDO.
 *
 * O Toth não tem campo de situação (confirmado pelo fornecedor). O sinal
 * confiável é o saldo: quitado zera.
 *
 * 🔴 Por que não usar `valorPago`: a versão anterior desta função inferia
 * `pago` de `valorPago >= valorDocumento`, sob a premissa — errada — de que
 * `valorDocumento` era o valor de face. Nos exemplos disponíveis (nada pago,
 * saldo igual ao original) o resultado saía certo por coincidência. O caso que
 * quebrava é o pior possível: título **quitado** cujo `valorPago` não venha
 * populado tem saldo 0 e pago 0, a regra antiga dizia "não pago", e um
 * vencimento no passado o marcava **atrasado**. Ou seja, dívida já paga entrando
 * na receita em risco — o número que o cliente usa para cobrar gente que não
 * deve nada.
 *
 * Com saldo, pagamento PARCIAL passa a ser distinguível: o saldo cai mas não
 * zera, então o título segue `aberto`/`atrasado` pelo valor que realmente falta.
 */
export function deriveTituloStatus(
  saldo: number,
  vencimentoIso: string | null,
  todayIso: string,
): TituloStatus {
  // Saldo zerado (ou negativo, em caso de pagamento a maior) = quitado.
  if (saldo <= 0) return "pago";
  if (vencimentoIso && vencimentoIso < todayIso) return "atrasado";
  return "aberto";
}

/**
 * Traduz uma cobrança do Toth para `CanonicalTitulo`.
 *
 * `todayIso` entra por parâmetro (em vez de `new Date()` aqui dentro) para que
 * o cálculo de atraso seja determinístico em teste.
 *
 * **`valor` recebe o SALDO, não o valor de face.** A pergunta que a Carteira faz
 * a esta tabela é "quanto ainda falta receber" — somar valor de face inflaria a
 * receita em risco de todo título parcialmente pago. O valor original não tem
 * coluna em `titulos_receber`; se um dia for preciso, entra como campo novo, e
 * não trocando o significado deste.
 */
export function mapTothCobrancaToCanonical(
  row: Record<string, unknown>,
  todayIso: string,
): CanonicalTitulo {
  const externalId = asString(pickField(row, TITULO_ID_FIELDS));
  if (!externalId) {
    throw new TothMappingError(
      `Cobrança do Toth sem identificador. Campos recebidos: ${Object.keys(row).join(", ")}`,
    );
  }

  // Sem saldo reconhecível, cai para o valor de face: melhor superestimar o que
  // falta receber do que zerar e sumir da inadimplência sem ninguém notar.
  const saldo =
    asNumber(pickField(row, TITULO_SALDO_FIELDS)) ??
    asNumber(pickField(row, TITULO_ORIGINAL_FIELDS)) ??
    0;
  const vencimento = parseTothDate(pickField(row, TITULO_VENCIMENTO_FIELDS));

  return {
    externalId,
    externalRef: null,
    clientExternalId: asString(pickField(row, TITULO_CLIENT_FIELDS)),
    // O Toth liga a cobrança à NOTA (`numeronota`), não ao pedido. Sem endpoint
    // de pedidos não existe external_id de pedido para casar — fica null, em vez
    // de apontar para um id que pertence a outro domínio.
    orderExternalId: null,
    valor: saldo,
    vencimento,
    status: deriveTituloStatus(saldo, vencimento, todayIso),
    // Preenchido assim que o fornecedor acrescentar a data do último pagamento.
    pagoEm: parseTothDate(pickField(row, TITULO_PAGAMENTO_FIELDS)),
  };
}
