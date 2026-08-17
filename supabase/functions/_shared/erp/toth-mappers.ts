/**
 * Toth → canônico.
 *
 * 🟠 ARQUIVO PROVISÓRIO — TODO o palpite sobre o formato do Toth mora aqui, de
 * propósito. A coleção Postman que recebemos (2026-08-17) traz os endpoints mas
 * NENHUM exemplo de resposta, então os nomes de campo abaixo são hipótese, não
 * contrato. `toth-probe` existe para trocar hipótese por fato: ele grava o
 * payload cru da primeira chamada real.
 *
 * Quando o payload real aparecer:
 *   1. salvar como fixture em tests/fixtures/toth-clientes.json;
 *   2. fixar os nomes reais no topo de cada lista de candidatos;
 *   3. apagar os candidatos que não existirem.
 * Nada fora deste arquivo muda. É essa a razão de ele existir separado do
 * client e do sync.
 */

import { CanonicalClient } from "./types.ts";

/** Normaliza chave para comparação: minúscula, sem acento, sem separador. */
function normalizeKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Busca o primeiro campo presente entre os candidatos, comparando de forma
 * tolerante a caixa, acento e separador — `razaoSocial`, `razao_social` e
 * `RAZÃO SOCIAL` casam com o candidato `razaosocial`.
 */
export function pickField(row: Record<string, unknown>, candidates: string[]): unknown {
  const index = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    const norm = normalizeKey(key);
    // Primeira ocorrência vence — objeto JSON não deveria ter chave duplicada,
    // mas normalização pode colidir (`cnpj_cpf` e `cnpjCpf`).
    if (!index.has(norm)) index.set(norm, value);
  }
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

/** Só dígitos. CNPJ/CPF chega formatado em quase todo ERP brasileiro. */
export function digitsOnly(value: unknown): string | null {
  const str = asString(value);
  if (!str) return null;
  const digits = str.replace(/\D/g, "");
  return digits.length === 0 ? null : digits;
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidatos de campo — a parte que vira fato quando o payload real chegar.
// ─────────────────────────────────────────────────────────────────────────────

const ID_FIELDS = ["id", "codigo", "codigoCliente", "idCliente", "clienteId", "cod"];
const CNPJ_FIELDS = ["cnpj", "cpf", "cnpjCpf", "cpfCnpj", "documento", "nrDocumento"];
const NAME_FIELDS = ["nome", "razaoSocial", "nomeCliente", "nomeFantasia", "descricao"];
const COMPANY_FIELDS = ["razaoSocial", "nomeFantasia", "empresa", "fantasia"];
const EMAIL_FIELDS = ["email", "eMail", "emailPrincipal", "emailContato"];
const PHONE_FIELDS = ["telefone", "fone", "celular", "telefonePrincipal", "whatsapp", "contato"];

/** Envelopes prováveis de uma listagem. A raiz também pode ser o próprio array. */
const LIST_ENVELOPES = ["clientes", "data", "content", "rows", "items", "result", "registros", "lista"];

/**
 * Extrai o array de registros de uma resposta de listagem, seja ela um array
 * cru ou um envelope. Devolve `[]` quando não reconhece — o chamador decide se
 * isso é fim de paginação ou formato inesperado.
 */
export function extractRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];

  for (const envelope of LIST_ENVELOPES) {
    const value = pickField(payload, [envelope]);
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Candidatos de campo do token na resposta do login. */
const TOKEN_FIELDS = ["token", "accessToken", "authToken", "jwt", "sessionToken", "chave"];

/**
 * Extrai o token da resposta de `POST /users/login`. Aceita o token como corpo
 * cru (string), no objeto raiz, ou um nível abaixo em `data`/`result`.
 */
export function extractLoginToken(payload: unknown): string | null {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    // Um corpo de erro em texto não é token; token não tem espaço.
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

export class TothMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TothMappingError";
  }
}

/**
 * Traduz um cliente do Toth para `CanonicalClient`.
 *
 * Lança `TothMappingError` quando não encontra identificador — um cliente sem
 * id imutável não tem chave de idempotência, e importá-lo assim duplicaria o
 * registro a cada sincronização. Falhar alto aqui é melhor que sujar a carteira.
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
    // O Toth não conhece o nosso uuid (não há upsert de volta nesta fase).
    externalRef: null,
    cnpj: digitsOnly(pickField(row, CNPJ_FIELDS)),
    // `name` é NOT NULL do lado da carteira; sem nome, o id serve de rótulo até
    // a próxima sincronização trazer algo melhor.
    name: name ?? company ?? `Cliente ${externalId}`,
    company: company ?? null,
    email: asString(pickField(row, EMAIL_FIELDS)),
    phone: digitsOnly(pickField(row, PHONE_FIELDS)),
  };
}
