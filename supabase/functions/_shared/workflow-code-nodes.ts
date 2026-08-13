/**
 * Helpers dos nós de código do workflow (`code_json`, `code_javascript`, `code_https`).
 *
 * Funções PURAS de propósito — sem `SupabaseClient`, sem `fetch`, sem `Deno.*`. É o que
 * torna o arquivo testável em Deno sem mock nenhum (./workflow-code-nodes.test.ts) e o
 * que mantém os três `case` do workflow-executor curtos o bastante para caberem na
 * cabeça de quem lê.
 *
 * ⚠️ Nada aqui executa código do usuário. O nó `code_javascript` NÃO roda na fase 1 —
 * o executor tem o service role no ambiente, e qualquer escape de sandbox seria
 * comprometimento cross-tenant.
 */

/**
 * Teto de caracteres gravados em `context[outputVariable]` pelos nós de código.
 * Espelha `CODE_OUTPUT_MAX_CHARS` de `src/types/workflow.ts` (Deno não importa o src/).
 */
export const CODE_OUTPUT_MAX_CHARS = 16_000;

/** Profundidade máxima que `flattenForContext` percorre abaixo do prefixo. */
const FLATTEN_MAX_DEPTH = 3;

/** Teto de chaves que uma única chamada de `flattenForContext` grava no destino. */
const FLATTEN_MAX_KEYS = 50;

/**
 * Escapa um valor para dentro de uma string JSON (sem as aspas externas).
 * Sem isto, um lead chamado `Pneus "Bom Preço" Ltda` quebra o `JSON.parse` do nó JSON
 * — e, no nó HTTPS, quebra o JSON que descreve a requisição inteira.
 */
export function jsonEscape(raw: string): string {
  return JSON.stringify(raw).slice(1, -1);
}

// ─── Nó HTTPS ───────────────────────────────────────────────────────────────

/** Requisição já validada, pronta para `fetchWithTimeout`. */
export interface HttpsRequestSpec {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Ausente quando não há corpo, ou quando o método é GET/HEAD. */
  body?: string;
  timeoutMs: number;
}

const HTTPS_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

/** Métodos que não carregam corpo — o `body` do JSON é ignorado neles. */
const HTTPS_BODYLESS_METHODS = ["GET", "HEAD"];

/** Default de `timeoutMs` quando o JSON não declara um. */
export const HTTPS_DEFAULT_TIMEOUT_MS = 15_000;

/** Teto de `timeoutMs`. Valor maior é aparado, não recusado. */
export const HTTPS_MAX_TIMEOUT_MS = 30_000;

/**
 * Valida a forma do JSON já resolvido do nó HTTPS e devolve a requisição pronta,
 * ou a mensagem de erro em PT-BR (é ela que o usuário lê no passo da execução).
 *
 * Regras:
 * - `url` obrigatória, string, **precisa começar com `https://`** — o nó é HTTPS, e
 *   `http://` mandaria o header `Authorization` em texto claro pela rede. Quem valida
 *   destino (IP privado, metadata da nuvem, porta de sistema) é o `validateExternalUrl`,
 *   depois desta função.
 * - `method` opcional, default `GET`, um de GET/POST/PUT/PATCH/DELETE/HEAD.
 * - `headers` opcional, objeto de strings.
 * - `body` opcional; objeto/array vira `JSON.stringify`, string vai como está.
 *   Ignorado em GET/HEAD.
 * - `timeoutMs` opcional, default 15000, teto 30000.
 *
 * Conveniência deliberada: corpo vindo de objeto/array sem `Content-Type` declarado
 * ganha `application/json`. Sem isso, a maioria das APIs recusa o JSON com 415 e o
 * usuário não tem como adivinhar o porquê olhando só o que escreveu.
 */
export function parseHttpsRequest(
  parsed: unknown,
): { ok: true; spec: HttpsRequestSpec } | { ok: false; error: string } {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "A requisição precisa ser um objeto JSON com pelo menos a chave \"url\"" };
  }
  const raw = parsed as Record<string, unknown>;

  // ── url ──
  if (typeof raw.url !== "string" || raw.url.trim() === "") {
    return { ok: false, error: "Campo \"url\" obrigatório: informe o endereço completo, começando com https://" };
  }
  const url = raw.url.trim();
  if (/^http:\/\//i.test(url)) {
    return {
      ok: false,
      error: "Este nó só aceita https:// — em http:// os headers (inclusive Authorization) viajariam em texto claro. Troque o endereço para https://",
    };
  }
  if (!/^https:\/\//i.test(url)) {
    return { ok: false, error: `A "url" precisa começar com https:// (recebido: ${url.slice(0, 40)})` };
  }

  // ── method ──
  let method = "GET";
  if (raw.method !== undefined && raw.method !== null) {
    if (typeof raw.method !== "string") {
      return { ok: false, error: "Campo \"method\" precisa ser texto (GET, POST, PUT, PATCH, DELETE ou HEAD)" };
    }
    method = raw.method.trim().toUpperCase();
    if (!HTTPS_METHODS.includes(method)) {
      return { ok: false, error: `Método "${raw.method}" não suportado. Use um de: ${HTTPS_METHODS.join(", ")}` };
    }
  }

  // ── headers ──
  const headers: Record<string, string> = {};
  if (raw.headers !== undefined && raw.headers !== null) {
    if (typeof raw.headers !== "object" || Array.isArray(raw.headers)) {
      return { ok: false, error: "Campo \"headers\" precisa ser um objeto, ex.: { \"Authorization\": \"Bearer ...\" }" };
    }
    for (const [key, value] of Object.entries(raw.headers as Record<string, unknown>)) {
      if (key.trim() === "") {
        return { ok: false, error: "Há um header com nome vazio em \"headers\"" };
      }
      if (typeof value !== "string") {
        // Nome do header entra na mensagem; o VALOR nunca — é onde mora o token.
        return { ok: false, error: `O header "${key}" precisa ter valor de texto` };
      }
      headers[key] = value;
    }
  }

  // ── body ──
  let body: string | undefined;
  let bodyFromObject = false;
  if (raw.body !== undefined && raw.body !== null) {
    if (typeof raw.body === "string") {
      body = raw.body;
    } else if (typeof raw.body === "object") {
      bodyFromObject = true;
      try {
        body = JSON.stringify(raw.body);
      } catch {
        return { ok: false, error: "Não foi possível serializar o \"body\" para JSON" };
      }
    } else {
      return { ok: false, error: "Campo \"body\" precisa ser um objeto, um array ou um texto" };
    }
  }

  if (HTTPS_BODYLESS_METHODS.includes(method)) {
    body = undefined; // GET/HEAD não carregam corpo
    bodyFromObject = false;
  }

  if (bodyFromObject && !Object.keys(headers).some(k => k.toLowerCase() === "content-type")) {
    headers["Content-Type"] = "application/json";
  }

  // ── timeoutMs ──
  let timeoutMs = HTTPS_DEFAULT_TIMEOUT_MS;
  if (raw.timeoutMs !== undefined && raw.timeoutMs !== null) {
    if (typeof raw.timeoutMs !== "number" || !Number.isFinite(raw.timeoutMs) || raw.timeoutMs <= 0) {
      return { ok: false, error: "Campo \"timeoutMs\" precisa ser um número de milissegundos maior que zero" };
    }
    timeoutMs = Math.min(Math.floor(raw.timeoutMs), HTTPS_MAX_TIMEOUT_MS);
  }

  return { ok: true, spec: { method, url, headers, body, timeoutMs } };
}

// ─── Contexto ───────────────────────────────────────────────────────────────

/**
 * Achata as folhas ESCALARES de um objeto em chaves pontilhadas
 * (`payload.total`, `payload.itens.0.sku`), para que `resolveVariables` — que só
 * interpola valores não-objeto — consiga enxergar o miolo do JSON gerado.
 *
 * O próprio `prefix` nunca é gravado: quem escreve `out[prefix]` é o executor, com a
 * string JSON compacta, e sobrescrevê-la aqui trocaria o objeto inteiro por uma folha.
 *
 * Limites: profundidade 3 abaixo do prefixo e 50 chaves por chamada — um JSON grande
 * viaja no `context` a cada tick de cada lead.
 */
export function flattenForContext(
  prefix: string,
  value: unknown,
  out: Record<string, string | number | boolean>,
): void {
  flattenInto(prefix, value, out, 0, { written: 0 });
}

/**
 * Zera a variável de saída de um nó de código que NÃO produziu resultado: erro em
 * qualquer ponto do nó, ou o `code_javascript` da fase 1, que nunca executa.
 *
 * **Esvazia em vez de apagar**, e a diferença é o que chega ao cliente. `resolveVariables`
 * (`workflow-action-handler.ts`) só substitui chave PRESENTE no context — chave ausente
 * ele não reconhece e deixa passar. Com a variável ausente, um `{{resposta}}` no nó de
 * mensagem seguinte sai **literal** na mensagem enviada ao lead. Com a chave em `""`, ele
 * resolve para vazio. Não gravar protegia o invariante "corpo de erro não é resultado" e
 * ao mesmo tempo vazava o placeholder; `""` honra os dois.
 *
 * As folhas achatadas (`prefix.a`, `prefix.a.b`) são APAGADAS, não esvaziadas: numa
 * reentrada (`goto`, `wait_response`) as folhas da volta anterior sobreviveriam e os nós
 * de baixo leriam a resposta velha como se fosse a desta chamada. Não há como saber que
 * folhas a chamada teria produzido, então não existe conjunto para zerar — logo um
 * `{{resposta.pedido}}` num nó de baixo SEGUE saindo literal depois de um erro. Fechar
 * isso exigiria varrer `{{...}}` não resolvido na hora do envio, mudança de raio muito
 * maior do que estes três nós.
 */
export function clearCodeOutput(
  prefix: string,
  out: Record<string, unknown>,
): void {
  if (!prefix) return;
  const stale = `${prefix}.`;
  for (const key of Object.keys(out)) {
    if (key.startsWith(stale)) delete out[key];
  }
  out[prefix] = "";
}

function flattenInto(
  path: string,
  value: unknown,
  out: Record<string, string | number | boolean>,
  depth: number,
  budget: { written: number },
): void {
  if (budget.written >= FLATTEN_MAX_KEYS) return;

  if (value === null || value === undefined) return;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    // depth 0 é o próprio prefixo — ver o comentário de flattenForContext.
    if (depth === 0) return;
    out[path] = value;
    budget.written++;
    return;
  }

  if (typeof value !== "object") return; // function, symbol, bigint — não interpoláveis
  if (depth >= FLATTEN_MAX_DEPTH) return;

  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((item, i) => [String(i), item])
    : Object.entries(value as Record<string, unknown>);

  for (const [key, child] of entries) {
    if (budget.written >= FLATTEN_MAX_KEYS) return;
    flattenInto(`${path}.${key}`, child, out, depth + 1, budget);
  }
}

/**
 * Trunca para no máximo `max` caracteres, anexando "…" quando cortou.
 * Não parte par surrogate: cortar no meio de um emoji produziria um caractere solto
 * que quebra o `JSON.stringify` do jsonb na hora de gravar o passo.
 */
export function capString(s: string, max: number): string {
  if (max <= 0) return "";
  if (s.length <= max) return s;

  let cut = s.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1); // high surrogate órfão

  return `${cut}…`;
}
