/**
 * TothClient — transporte para a API do ERP Toth (on-premise, REST simples).
 *
 * Diferenças de forma em relação a Omie e Tiny, que moldam este arquivo:
 *  - **Host por organização.** O Toth roda na rede do cliente; não há URL
 *    constante. A base_url entra validada por `assertSafeErpBaseUrl`.
 *  - **Sessão com TTL aleatório.** Palavras do fornecedor: o token "não tem
 *    tempo definido (aleatório), mas ele expira". O client faz login preguiçoso
 *    e, ao ver a expiração, reautentica UMA vez e repete. Expirar é rotina do
 *    fluxo, não exceção.
 *  - **🔴 Falha vem no CORPO, não no status.** Token vencido responde
 *    `[{"error":"Acesso nao autorizado! "}]`, e o status HTTP que acompanha isso
 *    não está documentado. Por isso o corpo é a fonte da verdade: checar só
 *    401/403 deixaria a reautenticação nunca disparar, e o sync devolveria
 *    "0 clientes" com ar de sucesso — o modo de falha silencioso que custa caro.
 *  - **Token na query string.** É o que o fornecedor expõe hoje. Aceitamos
 *    também header (`token_transport: "header"`) porque pedimos que mude —
 *    quando mudar, é trocar uma coluna, não reescrever isto.
 *
 * O que NÃO está aqui: rate limit elaborado tipo Omie. O Toth é um servidor
 * único de um cliente só; o risco não é cota de API, é derrubar a máquina dele.
 * A contenção é o intervalo entre páginas e o teto de páginas por execução, no
 * chamador.
 */

import { assertSafeErpBaseUrl, type BaseUrlPolicy } from "./toth-url.ts";
import { extractLoginToken, extractApiError, isAuthErrorMessage } from "./toth-mappers.ts";

/**
 * Accept curinga, e NÃO `application/json`.
 *
 * Medido contra o ERP em 19/08: `GET /clientes` pedindo `application/json`
 * devolve **406 Not Acceptable**; com curinga, ou sem o header, devolve 200. O
 * recurso não declara que produz JSON (omissão de `@Produces`, clássica em app
 * JAX-RS), então Accept estrito é recusado antes de qualquer lógica de negócio.
 *
 * Pedir JSON explicitamente não comprava nada: o corpo é parseado por nós de
 * qualquer forma, e o servidor não muda de formato por causa do header. Era
 * rigor sem contrapartida, e custou compatibilidade. Postman e curl mandam o
 * curinga — é exatamente por isso que funcionavam enquanto a integração não.
 */
const ACCEPT = "*/*";

export type TothTokenTransport = "query" | "header";

export interface TothCredentials {
  baseUrl: string;
  user: string;
  password: string;
  /** Como o token viaja. Default `query` — o que a coleção Postman documenta. */
  tokenTransport?: TothTokenTransport;
  /** Nome do header quando `tokenTransport = "header"`. */
  tokenHeaderName?: string;
}

export interface TothClientOptions {
  fetchImpl?: typeof fetch;
  /** Timeout por requisição, em ms. Default 20s. */
  timeoutMs?: number;
  /** Política de validação da base_url (afrouxa só em dev). */
  urlPolicy?: BaseUrlPolicy;
}

/** Falha de autenticação: credencial errada, ou token que não renova. */
export class TothAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TothAuthError";
  }
}

/** Erro de transporte ou HTTP não-2xx que não seja 401/403. */
export class TothRequestError extends Error {
  readonly status: number | null;
  readonly bodyPreview: string;
  constructor(message: string, status: number | null, bodyPreview = "") {
    super(message);
    this.name = "TothRequestError";
    this.status = status;
    this.bodyPreview = bodyPreview;
  }
}

/**
 * Corta o corpo pra caber em log sem virar despejo de PII.
 *
 * Quando o corpo é a página de erro do servidor de aplicação, o texto útil é
 * extraído antes de cortar. O ERP roda JBossWeb, cuja página de 500 começa com
 * ~2 KB de CSS embutido: truncar em 300 caracteres devolvia só `<style>` e
 * escondia a exceção, que é a única coisa que interessa. Tirar as tags e
 * colapsar espaço faz caber `type Exception report ... message ... exception
 * java.lang.X` na mesma janela.
 */
export function preview(body: string, maxLen = 300): string {
  const isHtml = /<html|<!doctype html/i.test(body.slice(0, 400));
  const cleaned = isHtml
    ? body
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
    : body.trim();
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}…` : cleaned;
}

/**
 * Descreve um corpo de resposta SEM revelar valores.
 *
 * Usado só no caminho do login. Um corpo de login que não reconhecemos contém,
 * por definição, o token — e a mensagem de erro vai parar em `runtime_logs` e na
 * tela do admin. Ecoar o corpo ali transformaria a mensagem de diagnóstico em
 * vazamento de credencial. Os nomes das chaves bastam para corrigir o mapeador.
 */
function describeKeys(parsed: unknown, raw: string): string {
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const keys = Object.keys(parsed as Record<string, unknown>);
    return keys.length ? `campos recebidos: ${keys.join(", ")}` : "objeto vazio";
  }
  if (Array.isArray(parsed)) return `lista com ${parsed.length} item(ns)`;
  return `resposta não-JSON de ${raw.length} caracteres`;
}

export class TothClient {
  private readonly base: URL;
  private readonly user: string;
  private readonly password: string;
  private readonly transport: TothTokenTransport;
  private readonly headerName: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private token: string | null = null;

  constructor(creds: TothCredentials, opts: TothClientOptions = {}) {
    this.base = assertSafeErpBaseUrl(creds.baseUrl, opts.urlPolicy);
    this.user = creds.user;
    this.password = creds.password;
    this.transport = creds.tokenTransport ?? "query";
    this.headerName = creds.tokenHeaderName ?? "X-Auth-Token";
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  /** URL base já normalizada — para log e telas de diagnóstico. */
  get baseUrl(): string {
    return this.base.toString();
  }

  private url(path: string): URL {
    const clean = path.replace(/^\/+/, "");
    // `replace(/\/+$/)` importa: com base na raiz, `pathname` é "/" e a
    // concatenação vira "//users/login" — que a URL interpreta como referência
    // de rede (protocol-relative) e resolve para o host "users", não para o ERP.
    // O sintoma seria "não foi possível alcançar", apontando para a rede quando
    // o defeito é de montagem de path.
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
      // Sem rota até o host é o modo de falha esperado enquanto o ERP não foi
      // publicado — a mensagem precisa dizer isso, não "fetch failed".
      throw new TothRequestError(
        `Não foi possível alcançar o ERP em ${this.base.host}: ${msg}`,
        null,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Autentica e guarda o token na instância. Chamado sob demanda; não há
   * necessidade de chamar explicitamente antes de `get`.
   */
  async login(): Promise<string> {
    const body = new URLSearchParams({ user: this.user, password: this.password });
    const url = this.url("users/login");
    const res = await this.send(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: ACCEPT },
      body: body.toString(),
    });

    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new TothAuthError("Usuário ou senha do ERP inválidos.");
    }
    if (!res.ok) {
      // Sem `preview` aqui: o corpo do login é a única resposta que sabidamente
      // carrega credencial, e um 5xx pode ecoar o que foi enviado.
      //
      // O PATH vai na mensagem (nunca a query, que carrega token). Sem ele, um
      // 404 por endereço mal digitado é indistinguível de "o ERP não tem esse
      // endpoint" — e a pessoa vai procurar defeito no servidor do cliente em
      // vez de conferir o campo que ela mesma preencheu.
      const hint =
        res.status === 404
          ? ` O endereço configurado aponta para ${url.pathname} — confira se o campo termina em /toth/services, sem incluir /users/login.`
          : "";
      throw new TothRequestError(
        `Login no ERP falhou (HTTP ${res.status}).${hint}`,
        res.status,
      );
    }

    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Corpo não-JSON: pode ser o token em texto puro. `extractLoginToken` trata.
    }

    // Credencial errada também pode voltar como 200 com erro no corpo.
    const apiError = extractApiError(parsed);
    if (apiError) throw new TothAuthError(`O ERP recusou o login: ${apiError}`);

    const token = extractLoginToken(parsed);
    if (!token) {
      throw new TothAuthError(
        `Login respondeu 200 mas sem token reconhecível (${describeKeys(parsed, text)}). ` +
          `Acrescente o nome do campo em TOKEN_FIELDS de toth-mappers.ts.`,
      );
    }
    this.token = token;
    return token;
  }

  /** GET autenticado. */
  async get<T = unknown>(path: string, params: Record<string, string> = {}): Promise<T> {
    return this.authedRequest<T>("GET", path, params);
  }

  /**
   * POST autenticado com corpo `x-www-form-urlencoded`.
   *
   * `/cobrancas` é POST e recebe o `cnpj` no corpo, com o token ainda na query —
   * mistura que não dava para prever a partir de `/clientes`.
   */
  async postForm<T = unknown>(
    path: string,
    fields: Record<string, string>,
    params: Record<string, string> = {},
  ): Promise<T> {
    return this.authedRequest<T>("POST", path, params, fields);
  }

  /**
   * Executa a chamada e, se o ERP disser que o token não vale, reautentica uma
   * vez e repete. A decisão de "não vale" olha o corpo E o status — ver o
   * cabeçalho deste arquivo.
   */
  private async authedRequest<T>(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string>,
    fields?: Record<string, string>,
  ): Promise<T> {
    if (!this.token) await this.login();

    let outcome = await this.attempt(method, path, params, fields);
    if (outcome.kind === "auth") {
      this.token = null;
      await this.login();
      outcome = await this.attempt(method, path, params, fields);
    }

    if (outcome.kind === "auth") {
      throw new TothAuthError(
        `O ERP recusou o token mesmo após reautenticar: ${outcome.message}`,
      );
    }
    if (outcome.kind === "error") {
      throw new TothRequestError(outcome.message, outcome.status, outcome.bodyPreview);
    }
    return outcome.data as T;
  }

  private async attempt(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string>,
    fields?: Record<string, string>,
  ): Promise<TothAttempt> {
    const url = this.url(path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const headers: Record<string, string> = { Accept: ACCEPT };
    if (this.transport === "header") {
      headers[this.headerName] = this.token ?? "";
    } else {
      url.searchParams.set("token", this.token ?? "");
    }

    const init: RequestInit = { method, headers };
    if (fields) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      init.body = new URLSearchParams(fields).toString();
    }

    const res = await this.send(url, init);
    const text = await res.text();

    // Status ainda conta — se o ERP um dia passar a devolver 401 de verdade,
    // este ramo pega antes de a análise do corpo precisar existir.
    if (res.status === 401 || res.status === 403) {
      return { kind: "auth", message: `HTTP ${res.status}` };
    }
    if (!res.ok) {
      // O corpo do erro sobe NA MENSAGEM quando é falha do servidor (5xx).
      //
      // Foi jogado fora até agora, e cada 500 custou uma rodada de adivinhação:
      // "HTTP 500 em /clientes" não diz se faltou parâmetro, se estourou
      // memória ou se a consulta quebrou. O corpo de um 5xx de app Java
      // costuma trazer a exceção, que é a resposta pronta.
      //
      // Só 5xx: um 4xx pode ecoar o que foi enviado, e o que enviamos inclui
      // token. Erro do servidor não carrega credencial nossa.
      // Janela maior no 5xx: a exceção do JBoss vem depois do cabeçalho da
      // página, e 300 caracteres cortavam justamente antes dela.
      const detail =
        res.status >= 500 && text.trim() ? ` Resposta do ERP: ${preview(text, 700)}` : "";
      return {
        kind: "error",
        message: `O ERP respondeu HTTP ${res.status} em /${path}.${detail}`,
        status: res.status,
        bodyPreview: preview(text),
      };
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        kind: "error",
        message: `Resposta de /${path} não é JSON.`,
        status: res.status,
        bodyPreview: preview(text),
      };
    }

    // 200 com erro no corpo: o caso real do token expirado.
    const apiError = extractApiError(data);
    if (apiError) {
      return isAuthErrorMessage(apiError)
        ? { kind: "auth", message: apiError }
        : {
            kind: "error",
            message: `O ERP recusou a chamada a /${path}: ${apiError}`,
            status: res.status,
            bodyPreview: "",
          };
    }

    return { kind: "ok", data };
  }
}

type TothAttempt =
  | { kind: "ok"; data: unknown }
  | { kind: "auth"; message: string }
  | { kind: "error"; message: string; status: number | null; bodyPreview: string };
