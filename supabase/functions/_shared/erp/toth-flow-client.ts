/**
 * TothFlowClient — transporte para o serviço **Flow** do Toth (pedidos).
 *
 * 🔴 Não é o mesmo servidor de `TothClient`, e essa é a razão de o arquivo
 * existir. Durante semanas tratamos `/pedidos` como um caminho faltante do
 * `/toth/services`, e por isso a sincronização de pedidos batia num 404 que
 * nenhum ajuste nosso resolveria: o fornecedor publicou pedidos em outro
 * serviço, na porta 3000, com um contrato inteiramente diferente.
 *
 * |  | `/toth/services` (TothClient) | `/flow/crm` (aqui) |
 * |---|---|---|
 * | login | `POST /users/login`, form urlencoded | `POST /auth`, JSON |
 * | credencial | `user` + `password` | `client_id` + `client_secret` |
 * | resposta do login | `{login, user, token}` | `{success, data:"<JWT>", elapsed, count}` |
 * | token | query string `?token=` | `Authorization: Bearer` |
 * | leitura | GET com query params | **POST com corpo JSON** |
 * | erro de auth | 200 com `[{"error":"Acesso nao autorizado! "}]` | **HTTP 401 + `{error:{message,status,providerStatus}}`** |
 *
 * O token é um **JWT**, então a expiração é legível antes de gastar uma
 * chamada — diferente do Toth, cujo TTL o fornecedor descreveu como
 * "aleatório". Aproveitamos `exp` para renovar preventivamente, mas **sem
 * confiar nele como único mecanismo**: relógio do servidor pode divergir e o
 * emissor pode revogar antes da hora, então o 401 continua sendo tratado e
 * ainda dispara uma reautenticação.
 *
 * ✅ **O serviço RESPONDE desde 31/08** — a linha anterior ("nada aqui foi
 * exercitado, a porta 3000 aceita a conexão e fecha muda") descrevia certo o
 * que tinha sido medido em 28/08 e está superada: a GON bloqueava por IP de
 * origem e liberou. O que o serviço real ensinou, e a captura do Postman não
 * mostrava:
 *
 *  - **O erro NÃO vem no envelope `{success,data}`.** Vem como
 *    `{"error":{"message":…,"status":401,"providerStatus":401}}` — objeto, não
 *    string. Ver `FlowEnvelope.error`.
 *  - **`/flow/crm` é um GATEWAY na frente do Toth**, não o ERP. É o que
 *    `providerStatus` denuncia, e é a diferença entre "o gateway falhou" e "o
 *    ERP recusou".
 *  - `GET /auth` devolve **404 em HTML** (só POST existe); `POST /pedidos` sem
 *    Bearer devolve **401**.
 *
 * ⚠️ **O que continua não exercitado é a leitura autenticada** — falta a
 * credencial real. E há um risco de rede ainda aberto: a GON bloqueia IP de
 * fora do Brasil, e a Edge Function do Supabase **não sai do IP do escritório**
 * nem tem IP de saída fixo. Que o teste da máquina do CTO passe NÃO prova que a
 * sincronização vai passar.
 */

import { assertSafeErpBaseUrl, FLOW_ENDPOINT_SUFFIXES, type BaseUrlPolicy } from "./toth-url.ts";
import { TothAuthError, TothRequestError, preview } from "./toth-client.ts";

export interface TothFlowCredentials {
  /** Base do serviço, ex.: `http://host:3000/flow/crm`. */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface TothFlowClientOptions {
  fetchImpl?: typeof fetch;
  /** Timeout por requisição, em ms. Default 30s. */
  timeoutMs?: number;
  urlPolicy?: BaseUrlPolicy;
  /** Relógio injetável — os testes de expiração precisam dele. */
  now?: () => number;
}

/**
 * Margem antes de considerar o JWT vencido.
 *
 * 60 segundos cobrem a diferença de relógio entre o servidor do cliente e o
 * runtime da edge function, que ninguém sincroniza. Sem margem, um token que
 * expira "daqui a 2 segundos" seria usado numa chamada que leva 3.
 */
const EXP_SKEW_MS = 60_000;

/**
 * Lê `exp` de um JWT sem verificar assinatura.
 *
 * Verificar não faz sentido aqui: a chave é do emissor e nós somos o portador,
 * não o validador. O que queremos do token é uma dica de quando renovar — e
 * uma dica errada custa uma reautenticação, não uma brecha. Por isso qualquer
 * falha de parse devolve `null` (= "não sei", trate como válido até o 401), em
 * vez de derrubar a chamada.
 */
export function readJwtExpiry(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    const decoded = JSON.parse(atob(padded));
    const exp = decoded?.exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * A resposta do Flow é envelopada: `{success, data, elapsed, count}`.
 *
 * 🔴 `success: false` com HTTP 200 é o modo de falha que precisa ser tratado —
 * é o mesmo vício do `/toth/services`, onde o token expirado volta dentro de um
 * 200. Ler só o status HTTP faria a sincronização registrar sucesso com zero
 * pedidos, que é o silêncio mais caro desta integração.
 */
export interface FlowEnvelope<T = unknown> {
  success?: boolean;
  data?: T;
  /**
   * 🔴 **É objeto, não string** — medido contra o serviço real em 31/08:
   *
   * ```json
   * {"error":{"message":"Credenciais rejeitadas pelo ERP",
   *           "status":401,"providerStatus":401}}
   * ```
   *
   * A versão anterior deste tipo declarava `error?: string`, e a leitura
   * silenciosa que isso produzia era o modo de falha mais caro possível: um
   * HTTP 200 com `{"error":{…}}` passaria como sucesso, `data` viria
   * `undefined`, `extractRows` devolveria zero linha, e a sincronização
   * registraria "página vazia — acabou" sobre uma chamada que o servidor
   * REJEITOU. "Não há pedidos" e "eu não consegui perguntar" viram a mesma
   * frase no relatório.
   *
   * `providerStatus` merece registro à parte: o `/flow/crm` é um **gateway na
   * frente do Toth**, não o ERP. `status` é o que o gateway devolveu;
   * `providerStatus` é o que o ERP respondeu para ele. Quando os dois divergem,
   * o problema é do gateway; quando batem, é do ERP. Sem esse campo na
   * mensagem, as duas falhas ficam idênticas na tela.
   */
  error?: string | { message?: string; status?: number; providerStatus?: number };
  message?: string;
  elapsed?: number;
  count?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON que pode não ser JSON — devolve `null` em vez de estourar. */
function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Apaga qualquer coisa com cara de credencial antes de o texto virar mensagem.
 *
 * 🔴 Isto NÃO é excesso de zelo, é o que separa este client do `TothClient`.
 * Lá o token viaja na query string e as mensagens de erro nunca incluem a
 * query. Aqui ele viaja em `Authorization: Bearer`, e servidor de aplicação
 * que devolve 5xx frequentemente despeja os cabeçalhos da requisição no corpo
 * da página de erro. Esse corpo entra na mensagem, a mensagem é gravada em
 * `toth_connections.last_error`, e `last_error` é lido por **qualquer membro da
 * organização** (policy `toth_connections_member_select`).
 *
 * Ou seja: sem esta função, um 5xx do lado do cliente transforma um segredo que
 * vive num cofre deny-all — decifrável só por `service_role` — em texto na tela
 * de qualquer vendedor. O caminho é curto e silencioso, e o dado vazado é
 * exatamente o que a cifra existe para proteger.
 *
 * Corta três formas: o header inteiro, o esquema `Bearer <algo>` solto, e
 * qualquer JWT de três segmentos que apareça sozinho no texto.
 */
export function scrubCredentials(text: string): string {
  return text
    .replace(/authorization\s*[:=]\s*\S+/gi, "authorization: [removido]")
    .replace(/\bBearer\s+[\w\-._~+/]+=*/gi, "Bearer [removido]")
    .replace(/\beyJ[\w-]*\.[\w-]+\.[\w-]+/g, "[jwt removido]");
}

/**
 * Mensagem de erro do envelope, ou `null` quando a resposta é boa.
 *
 * `success: false` sem texto ainda é erro — devolve um rótulo genérico em vez
 * de `null`, senão o chamador trataria a falha como sucesso vazio.
 */
export function extractFlowError(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const env = payload as FlowEnvelope;

  let texto = "";
  if (typeof env.error === "string") {
    texto = env.error.trim();
  } else if (isRecord(env.error)) {
    // Forma real do serviço. `providerStatus` entra na mensagem porque é o que
    // separa "o gateway falhou" de "o ERP atrás dele recusou" — sem ele as duas
    // falhas ficam com o mesmo texto e a investigação começa do zero.
    const err = env.error as { message?: unknown; status?: unknown; providerStatus?: unknown };
    const msg = typeof err.message === "string" ? err.message.trim() : "";
    const provider =
      typeof err.providerStatus === "number" ? ` (ERP respondeu ${err.providerStatus})` : "";
    texto = msg ? `${msg}${provider}` : provider.trim();
    // `error` presente como objeto JÁ é erro, mesmo sem texto dentro. Sem esta
    // linha, um `{"error":{}}` voltaria `null` e seria lido como sucesso.
    if (!texto) texto = "O serviço devolveu um erro sem descrição.";
  }

  if (!texto && typeof env.message === "string") texto = env.message.trim();

  if (env.success === false) return texto || "O serviço recusou a chamada sem detalhar o motivo.";
  return texto || null;
}

/** O erro do Flow indica credencial/token, e não regra de negócio? */
export function isFlowAuthError(message: string): boolean {
  return /n[ãa]o autorizado|unauthorized|forbidden|token|jwt|expir|credencia|invalid client/i.test(
    message,
  );
}

export class TothFlowClient {
  private readonly base: URL;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private token: string | null = null;
  private tokenExpiresAt: number | null = null;

  constructor(creds: TothFlowCredentials, opts: TothFlowClientOptions = {}) {
    this.base = assertSafeErpBaseUrl(creds.baseUrl, {
      ...opts.urlPolicy,
      endpointSuffixes: FLOW_ENDPOINT_SUFFIXES,
    });
    this.clientId = creds.clientId;
    this.clientSecret = creds.clientSecret;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.now = opts.now ?? (() => Date.now());
  }

  get baseUrl(): string {
    return this.base.toString();
  }

  private url(path: string): URL {
    const clean = path.replace(/^\/+/, "");
    // Mesma armadilha do TothClient: base na raiz deixa `pathname` em "/" e a
    // concatenação vira "//auth", que a URL lê como referência de rede e
    // resolve para o host "auth".
    const prefix = this.base.pathname.replace(/\/+$/, "");
    return new URL(`${prefix}/${clean}`, this.base);
  }

  private async send(url: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url.toString(), { ...init, signal: controller.signal });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A falha MEDIDA hoje é exatamente esta: TCP aceito, zero bytes de volta.
      // A mensagem precisa apontar para porta/publicação, não para "fetch
      // failed" — foi o que fez a equipe caçar credencial durante dias.
      throw new TothRequestError(
        `Não foi possível falar com o serviço de pedidos em ${this.base.host}: ${msg}. ` +
          `Confira com a GON Informática se a porta ${this.base.port || "padrão"} está publicada para fora da rede.`,
        null,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Autentica e guarda o JWT. Chamado sob demanda por `post`. */
  async login(): Promise<string> {
    const url = this.url("auth");
    const res = await this.send(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "*/*" },
      body: JSON.stringify({ client_id: this.clientId, client_secret: this.clientSecret }),
    });

    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      // Detalhe extraído por CAMPO, nunca por eco do corpo. `extractFlowError`
      // só lê `error.message` e `providerStatus`; um 401 não carrega token, mas
      // a regra de não ecoar o corpo do login continua valendo por construção.
      const motivo = extractFlowError(safeParse(text));
      throw new TothAuthError(
        motivo
          ? `O serviço de pedidos recusou o login: ${scrubCredentials(motivo)}`
          : "O serviço de pedidos recusou client_id/client_secret.",
      );
    }
    if (!res.ok) {
      // Sem eco do corpo: é a única resposta que sabidamente carrega credencial
      // (o token) e um 5xx pode devolver o que foi enviado.
      throw new TothRequestError(
        `Autenticação no serviço de pedidos falhou (HTTP ${res.status}) em ${url.pathname}.`,
        res.status,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new TothAuthError(
        `A autenticação respondeu 200 mas não em JSON (${text.length} caracteres).`,
      );
    }

    const erro = extractFlowError(parsed);
    if (erro) {
      throw new TothAuthError(
        `O serviço de pedidos recusou o login: ${scrubCredentials(erro)}`,
      );
    }

    const token = isRecord(parsed) && typeof parsed.data === "string" ? parsed.data.trim() : "";
    if (!token) {
      const campos = isRecord(parsed) ? Object.keys(parsed).join(", ") : typeof parsed;
      throw new TothAuthError(
        `Login do serviço de pedidos sem token em \`data\` (campos recebidos: ${campos}).`,
      );
    }

    this.token = token;
    this.tokenExpiresAt = readJwtExpiry(token);
    return token;
  }

  /** O token guardado ainda serve? `exp` ilegível conta como serve. */
  private tokenValido(): boolean {
    if (!this.token) return false;
    if (this.tokenExpiresAt === null) return true;
    return this.now() + EXP_SKEW_MS < this.tokenExpiresAt;
  }

  /**
   * POST autenticado com corpo JSON. Devolve o `data` do envelope.
   *
   * Devolver `data` e não o envelope inteiro é decisão consciente: `page` e
   * `hasNext` vêm FORA de `data` neste serviço, e quem pagina precisa dos dois.
   * Por isso `postEnvelope` existe logo abaixo — `post` serve a quem só quer o
   * conteúdo.
   */
  async post<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
    const envelope = await this.postEnvelope(path, body);
    return envelope.data as T;
  }

  /** Igual a `post`, mas devolve a resposta inteira (para ler `hasNext`). */
  async postEnvelope(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.tokenValido()) await this.login();

    let outcome = await this.attempt(path, body);
    if (outcome.kind === "auth") {
      this.token = null;
      this.tokenExpiresAt = null;
      await this.login();
      outcome = await this.attempt(path, body);
    }

    if (outcome.kind === "auth") {
      throw new TothAuthError(
        `O serviço de pedidos recusou o token mesmo após reautenticar: ${outcome.message}`,
      );
    }
    if (outcome.kind === "error") {
      throw new TothRequestError(outcome.message, outcome.status, outcome.bodyPreview);
    }
    return outcome.data;
  }

  private async attempt(path: string, body: Record<string, unknown>): Promise<FlowAttempt> {
    const url = this.url(path);
    const res = await this.send(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*",
        Authorization: `Bearer ${this.token ?? ""}`,
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();

    if (res.status === 401 || res.status === 403) {
      // O motivo do corpo entra aqui: depois da reautenticação falhar, esta é a
      // mensagem que chega ao operador. "HTTP 401" sozinho não distingue
      // credencial errada de token revogado de ERP fora do ar.
      const motivo = extractFlowError(safeParse(text));
      return {
        kind: "auth",
        message: motivo ? `HTTP ${res.status} — ${scrubCredentials(motivo)}` : `HTTP ${res.status}`,
      };
    }
    if (!res.ok) {
      // `scrubCredentials` ANTES de qualquer corte: a página de erro pode
      // trazer o header `Authorization` de volta, e daqui o texto vai para
      // `last_error`, que membro comum da org lê.
      const limpo = scrubCredentials(text);
      const detail = res.status >= 500 && limpo.trim() ? ` Resposta: ${preview(limpo, 700)}` : "";
      return {
        kind: "error",
        message: `O serviço de pedidos respondeu HTTP ${res.status} em /${path}.${detail}`,
        status: res.status,
        bodyPreview: preview(limpo),
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        kind: "error",
        message: `Resposta de /${path} não é JSON.`,
        status: res.status,
        bodyPreview: preview(scrubCredentials(text)),
      };
    }

    // Também passa pelo filtro: um serviço que devolve "token <x> inválido"
    // dentro do envelope publicaria o token pelo caminho de sucesso do HTTP.
    const erro = extractFlowError(parsed) && scrubCredentials(extractFlowError(parsed)!);
    if (erro) {
      return isFlowAuthError(erro)
        ? { kind: "auth", message: erro }
        : {
            kind: "error",
            message: `O serviço de pedidos recusou /${path}: ${erro}`,
            status: res.status,
            bodyPreview: "",
          };
    }

    if (!isRecord(parsed)) {
      return {
        kind: "error",
        message: `Resposta de /${path} não é um objeto — o envelope {success, data} é o contrato.`,
        status: res.status,
        bodyPreview: preview(scrubCredentials(text)),
      };
    }

    return { kind: "ok", data: parsed };
  }
}

type FlowAttempt =
  | { kind: "ok"; data: Record<string, unknown> }
  | { kind: "auth"; message: string }
  | { kind: "error"; message: string; status: number | null; bodyPreview: string };
