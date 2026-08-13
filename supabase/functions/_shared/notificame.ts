/**
 * notificame — contrato do NotificaMe Hub, isolado num módulo PURO com `fetch`
 * injetável. É o ÚNICO lugar do codebase que sabe que, nesta API, **2xx não
 * significa sucesso**.
 *
 * ARMADILHAS PROVADAS contra a conta viva (2027-08-13) — cada uma virou caso de
 * teste em `tests/unit/notificame-api-contract.test.ts` e
 * `tests/unit/notificame-subaccount-contract.test.ts`:
 *
 *   1. Rota desconhecida devolve HTTP **200** com corpo
 *      `{"error":{"type":"OAuthException","code":"Hub404"}}` — o backend faz
 *      proxy para o Graph da Meta e repassa o envelope de erro dela.
 *   2. Falha de autenticação devolve HTTP **404** com `{"code":"AUTHENTICATION_ERROR"}`.
 *      Não é 401. Ler o status leva à conclusão errada nas duas direções.
 *   3. Erro de validação devolve HTTP 422 com `{"code":"ERROR","message":"…"}` —
 *      mas `POST /v1/accounts` (legado) devolve **200** para o mesmo erro.
 *   4. `/v2/templates` devolve JSON; `/v2/channels` devolve TEXTO PURO do
 *      `http.ServeMux` do Go (`404 page not found\n`). Nem todo erro é JSON, e
 *      um `res.json()` direto vaza `SyntaxError` para o `withErrorBoundary`.
 *   5. `POST /v2/accounts` devolve `{"CompanyId":"<36>","Status":"Sucesso"}` —
 *      MAIÚSCULO e em português. A DOC do fornecedor promete
 *      `{"status":"success"}`, que a conta viva NUNCA devolve. Por isso o
 *      sucesso da criação se decide por PRESENÇA DE `CompanyId`, jamais por
 *      string de status: casar a string da doc é a implementação mais natural
 *      de escrever e falha contra toda subconta criada em produção.
 *
 * REGRA, portanto: `res.ok` e `res.status` NUNCA entram na decisão. Lê-se
 * `res.text()` e decide-se por `body.code` / `body.error`.
 *
 * MODELO DE DADOS — SUBCONTA POR ORG. Cada organização do Torque tem uma
 * subconta própria na revenda da Milennials, criada sob demanda por
 * `POST /v2/accounts`. O fato que decidiu o desenho, verificado contra a conta
 * viva: o `CompanyId` devolvido por esse POST **É O TOKEN** daquela subconta —
 * byte-a-byte igual ao `acccount_id` de `GET /v1/resale/`.
 *
 *   Consequência 1 — o `company_uuid` que viaja na querystring do popup Seamless
 *   NÃO é identificador público: é CREDENCIAL. Sob conta ÚNICA, aquela
 *   querystring entregaria o token da CONTA-MÃE (acesso a TODAS as orgs) ao
 *   browser de cada cliente. Conta única morreu por isso, não por preferência.
 *   Entregar à org o token DELA MESMA não é vazamento.
 *
 *   Consequência 2 — os dois tokens não podem se confundir no código. Por isso a
 *   config RACHA EM DUAS: `NotificameParentConfig` (só `POST /v2/accounts` e
 *   `GET /v1/resale/`) e `NotificameOrgConfig` (todo o resto). Chamar
 *   `/v1/channels` com o token do pai passa a ser impossível PELO TIPO.
 *
 *   Consequência 3 — com o token da subconta, `GET /v1/channels` já chega
 *   ESCOPADO àquela org. A heurística "pega o único canal sem dono na conta-mãe"
 *   morreu, e com ela o vetor de captura cross-tenant.
 *
 * SEGURANÇA — o token da conta-mãe (`NOTIFICAME_API_TOKEN`) tem raio de explosão
 * igual a TODAS as orgs. Mora em secret de edge function, nunca em coluna, nunca
 * no browser. O token da subconta mora cifrado em `notificame_subaccounts`
 * (deny-all), acessível só pelo choke `notificame-credentials.ts`. As mensagens
 * de erro lançadas daqui carregam CÓDIGO e nada mais: o `withErrorBoundary`
 * devolve `error.message` CRU no corpo do 500 para o browser, então qualquer
 * interpolação de corpo do fornecedor aqui viraria vazamento lá.
 *
 * PUREZA — tudo aqui é puro e testável sem rede, exceto `listChannels` e
 * `createSubaccount` (I/O via `fetchImpl` injetável) e `isNotificameEnabledForOrg`
 * (uma leitura no banco), todos marcados como tal.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Base pública do NotificaMe. `api.` e `hub.` são o MESMO backend. */
export const NOTIFICAME_DEFAULT_BASE_URL = "https://api.notificame.com.br";

/** Tamanho exato do CompanyId/token do fornecedor. É um uuid canônico. */
const COMPANY_ID_LENGTH = 36;

export type FetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

// ─── Erros ───────────────────────────────────────────────────────────────────

/**
 * Erro tipado com um `code` estável de máquina. A edge function mapeia
 * `code` → HTTP status e devolve `{ error, code }` para o cliente decidir sem
 * casar string. A `message` é NOSSA — nunca o corpo do fornecedor, nunca o token.
 */
export class NotificameError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "NotificameError";
    this.code = code;
  }
}

// ─── Configuração (puro) ─────────────────────────────────────────────────────

/**
 * Config da CONTA-MÃE. Serve a DOIS endpoints e só: `POST /v2/accounts`
 * (provisionar subconta) e `GET /v1/resale/` (reconciliar órfãs). O
 * `parentToken` é a revenda inteira — todas as orgs.
 *
 * Não tem `companyUuid` DE PROPÓSITO: sob subconta ele é por-org e é credencial;
 * um campo herdado aqui seria a rota mais curta para o vazamento.
 */
export interface NotificameParentConfig {
  baseUrl: string;
  /** Token da conta-mãe. NUNCA sai do servidor, nunca entra numa URL. */
  parentToken: string;
}

/**
 * Config de UMA org: o token da subconta dela. Tudo que fala em nome da org
 * (`/v1/channels`, envio na fatia 2) recebe ISTO, nunca a config do pai.
 */
export interface NotificameOrgConfig {
  baseUrl: string;
  /** O `CompanyId` da subconta — que É o token dela. Escopo = uma org. */
  subaccountToken: string;
}

/**
 * Lê a configuração da conta-mãe dos secrets de edge function. Devolve `null` —
 * e não lança — quando falta o token: esse é o ESTADO INERTE em que a fatia é
 * mergeada, e o chamador precisa poder renderizar o motivo em vez de quebrar.
 *
 * `NOTIFICAME_COMPANY_UUID` DEIXOU DE EXISTIR: sob subconta por org não há um
 * company_uuid nosso e único; há um por org, e ele é credencial guardada no
 * cofre. O estado inerte passa a ser "sem `NOTIFICAME_API_TOKEN`", e só.
 *
 * `env` é injetável (`Deno.env` em produção) para o teste não depender do runtime.
 */
export function readNotificameParentConfig(
  env: { get(key: string): string | undefined },
): NotificameParentConfig | null {
  const parentToken = (env.get("NOTIFICAME_API_TOKEN") ?? "").trim();
  if (!parentToken) return null;

  return { baseUrl: readBaseUrl(env), parentToken };
}

/** Monta a config de org a partir do token já decifrado do cofre. Puro. */
export function orgConfigFrom(
  baseUrl: string,
  subaccountToken: string,
): NotificameOrgConfig {
  return { baseUrl: stripTrailingSlash(baseUrl), subaccountToken };
}

function readBaseUrl(env: { get(key: string): string | undefined }): string {
  const baseUrl = (env.get("NOTIFICAME_BASE_URL") ?? "").trim() || NOTIFICAME_DEFAULT_BASE_URL;
  return stripTrailingSlash(baseUrl);
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

// ─── Dados da subconta no fornecedor (puro) ──────────────────────────────────

/**
 * Os dados cadastrais que criam a subconta. São NOSSOS (Milennials): nós somos o
 * revendedor e o pagador da conta no fornecedor.
 *
 * Exportar CNPJ, telefone e endereço DO CLIENTE para um terceiro que não precisa
 * deles é PII gratuita — e irreversível, porque a subconta é irremovível. Por
 * isso tudo aqui sai de um secret único (`NOTIFICAME_SUBACCOUNT_DEFAULTS`), e do
 * cliente sai apenas o NOME da org (identificação no painel de revenda).
 */
export interface SubaccountDefaults {
  country: string;
  company_address: string;
  phone: string;
  cpf_cnpj: string;
  /** Domínio do email determinístico `torque-<organization_id>@<dominio>`. */
  email_domain: string;
  /** Cota de canais da subconta. Opcional no secret; default 1. */
  number_channels: number;
}

const REQUIRED_DEFAULT_KEYS = [
  "country",
  "company_address",
  "phone",
  "cpf_cnpj",
  "email_domain",
] as const;

/**
 * Parseia `NOTIFICAME_SUBACCOUNT_DEFAULTS` (JSON). FAIL-CLOSED: qualquer campo
 * obrigatório ausente devolve `null`.
 *
 * Ser tolerante aqui seria provisionar MEIA subconta — e a subconta é
 * irremovível e faturável no fornecedor. Com `null`, o start responde inerte com
 * motivo legível e nada é criado, que é o desfecho barato.
 */
export function readSubaccountDefaults(
  env: { get(key: string): string | undefined },
): SubaccountDefaults | null {
  const raw = (env.get("NOTIFICAME_SUBACCOUNT_DEFAULTS") ?? "").trim();
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of REQUIRED_DEFAULT_KEYS) {
    const value = obj[key];
    if (typeof value !== "string" || !value.trim()) return null;
    out[key] = value.trim();
  }

  const channels = Number(obj.number_channels);
  out.number_channels = Number.isFinite(channels) && channels > 0 ? Math.floor(channels) : 1;

  return out as unknown as SubaccountDefaults;
}

/**
 * Email determinístico da subconta. É a ÚNICA trilha entre uma org do Torque e
 * uma subconta do painel de revenda: se a linha do cofre se perder, é por ele que
 * a órfã é reconciliada em `GET /v1/resale/`.
 */
export function buildSubaccountEmail(organizationId: string, emailDomain: string): string {
  return `torque-${organizationId}@${emailDomain}`;
}

/**
 * Corpo do `POST /v2/accounts`. PURO.
 *
 * `resale: false` — a subconta do cliente não revende ninguém.
 * `active: true` — nasce utilizável; uma subconta inativa não completa o popup.
 * `password` — aleatória e NÃO armazenada: o caminho de acesso é o token
 * (`CompanyId`), e guardar uma senha que ninguém usa seria um segredo a mais para
 * vazar. Débito declarado: se um dia for preciso entrar no painel DA SUBCONTA, o
 * caminho é reset de senha pelo `vendor_email`, não recuperação daqui.
 */
export function buildCreateAccountBody(params: {
  organizationId: string;
  orgName: string;
  defaults: SubaccountDefaults;
  password: string;
}): { company: Record<string, unknown> } {
  const { organizationId, orgName, defaults, password } = params;
  return {
    company: {
      email: buildSubaccountEmail(organizationId, defaults.email_domain),
      name: orgName,
      password,
      active: true,
      resale: false,
      number_channels: defaults.number_channels,
      country: defaults.country,
      company_address: defaults.company_address,
      phone: defaults.phone,
      cpf_cnpj: defaults.cpf_cnpj,
    },
  };
}

// ─── URL do popup Seamless (puro) ────────────────────────────────────────────

export type SeamlessChannelType = "whatsapp" | "instagram" | "facebook";

/**
 * Monta a URL do popup do Seamless (seção "Seamless" da doc).
 *
 * ⚠️ O `companyUuid` daqui é o TOKEN DA SUBCONTA daquela org, e a URL abre no
 * browser DAQUELA org. Passar o token da conta-mãe aqui entregaria a revenda
 * inteira a um cliente — é o vazamento que este rework inteiro existe para
 * fechar. Quem chama tem que vir do cofre, nunca de `NotificameParentConfig`.
 *
 * `redirectOrigin` DEVE vir do header `Origin` da requisição já validado contra a
 * allowlist de CORS, nunca do body: ecoar uma origem escolhida pelo cliente
 * dentro de uma URL que nós abrimos é vetor de redirect.
 *
 * `encodeURIComponent` e não `URLSearchParams` de propósito: o segundo codifica
 * espaço como `+`, e o parser do fornecedor não é nosso para adivinhar.
 */
export function buildSeamlessStartUrl(params: {
  baseUrl: string;
  companyUuid: string;
  redirectOrigin: string;
  type?: SeamlessChannelType;
}): string {
  const base = stripTrailingSlash(params.baseUrl);
  const type = params.type ?? "whatsapp";
  return (
    `${base}/v2/oauth/meta/start` +
    `?company_uuid=${encodeURIComponent(params.companyUuid)}` +
    `&redirect_origin=${encodeURIComponent(params.redirectOrigin)}` +
    `&type=${encodeURIComponent(type)}`
  );
}

// ─── Parsing hostil (puro) ───────────────────────────────────────────────────

export type NotificameBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; code: string; message?: string };

/**
 * Decide se um corpo de resposta do NotificaMe é sucesso ou erro — SEM olhar
 * `res.ok` nem `res.status`, que mentem nos dois sentidos (ver cabeçalho).
 *
 * Ordem das checagens é load-bearing:
 *   1. não-JSON        → `non_json_response` (texto puro do ServeMux do Go);
 *   2. envelope `error` → código da Meta (`Hub404`, …) ou `upstream_error`;
 *   3. `code` != SUCCESS → `ERROR`, `AUTHENTICATION_ERROR`, …;
 *   4. resto            → sucesso, e o SHAPE é problema de quem chamou.
 *
 * ⚠️ `message` volta AQUI só para log/diagnóstico interno. Não interpole em
 * mensagem de erro que chegue ao browser: o `withErrorBoundary` devolve
 * `error.message` cru, e este texto é do terceiro.
 */
export function parseNotificameBody(rawText: string): NotificameBodyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, code: "non_json_response" };
  }

  // Escalar solto (null, número, string JSON). Não é envelope de erro conhecido;
  // deixa passar e quem chamou reprova pelo SHAPE, com código próprio.
  if (parsed === null || typeof parsed !== "object") {
    return { ok: true, value: parsed };
  }

  const obj = parsed as Record<string, unknown>;

  const err = obj.error;
  if (err !== undefined && err !== null) {
    const errObj = (typeof err === "object" ? err : {}) as Record<string, unknown>;
    const code = typeof errObj.code === "string" && errObj.code
      ? errObj.code
      : "upstream_error";
    const message = typeof errObj.message === "string" ? errObj.message : undefined;
    return { ok: false, code, message };
  }

  if (typeof obj.code === "string" && obj.code !== "SUCCESS") {
    const message = typeof obj.message === "string" ? obj.message : undefined;
    return { ok: false, code: obj.code, message };
  }

  return { ok: true, value: parsed };
}

// ─── Criação da subconta (puro na decisão, I/O isolado) ──────────────────────

export type CreateAccountRead =
  | { ok: true; companyId: string }
  | {
    ok: false;
    /** Código NOSSO, estável. Nunca o corpo nem a mensagem do fornecedor. */
    code:
      | "create_account_unreadable"
      | "create_account_rejected"
      | "create_account_no_company_id";
  };

/**
 * Lê a resposta de `POST /v2/accounts` e decide se uma subconta NASCEU. PURO.
 *
 * ⚠️ É a função de maior valor deste rework, e o motivo é uma divergência
 * provada: a DOC promete `{"status":"success"}`; a conta viva devolve
 * `{"CompanyId":"<36>","Status":"Sucesso"}`. Uma implementação que compare a
 * string de status passa em cima da doc e falha contra TODA subconta real — e o
 * dano não é um 500, é uma subconta criada no fornecedor, irremovível e
 * faturável, que o nosso lado dá como não-criada e recria no próximo clique.
 *
 * Por isso a regra é: SUCESSO = veio `CompanyId` de 36 chars E não veio envelope
 * de erro. A string de status não decide nada, em nenhuma das duas grafias.
 *
 * Também não estoura: o fornecedor já mentiu uma vez sobre este corpo, e um
 * `SyntaxError` daqui sobe pelo `withErrorBoundary` e vira 500 com
 * `error.message` cru no browser. Envelope desconhecido vira DECISÃO.
 */
export function readCompanyIdFromCreateAccount(rawText: string): CreateAccountRead {
  const parsed = parseNotificameBody(rawText);

  // Envelope de erro GANHA da presença do campo: um corpo que traga `CompanyId`
  // junto de `error` é resposta hostil, não sucesso parcial.
  if (!parsed.ok) {
    return {
      ok: false,
      code: parsed.code === "non_json_response"
        ? "create_account_unreadable"
        : "create_account_rejected",
    };
  }

  const value = parsed.value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, code: "create_account_no_company_id" };
  }

  // `CompanyId`, com C maiúsculo, no topo. Aliases (companyId, company_id,
  // data.CompanyId) NÃO são aceitos: nenhum foi observado, e adivinhar o formato
  // de um campo que é CREDENCIAL é como se grava lixo cifrado no cofre.
  const companyId = (value as Record<string, unknown>).CompanyId;
  if (typeof companyId !== "string") {
    return { ok: false, code: "create_account_no_company_id" };
  }
  const trimmed = companyId.trim();
  if (trimmed.length !== COMPANY_ID_LENGTH) {
    return { ok: false, code: "create_account_no_company_id" };
  }

  return { ok: true, companyId: trimmed };
}

/**
 * ⚠️ I/O + ESCRITA IRREVERSÍVEL. `POST /v2/accounts` cria no fornecedor um objeto
 * IRREMOVÍVEL e faturável. Não chame daqui de qualquer lugar: o único chamador
 * legítimo é `ensureNotificameSubaccount`, que grava a claim no banco ANTES —
 * é a claim, e não este código, que impede clique-duplo de criar duas subcontas.
 *
 * Devolve o `CompanyId` (= o token da subconta). Lança `NotificameError` com
 * código estável e mensagem NOSSA.
 */
export async function createSubaccount(
  parent: NotificameParentConfig,
  params: {
    organizationId: string;
    orgName: string;
    defaults: SubaccountDefaults;
    password: string;
  },
  fetchImpl: FetchImpl = fetch,
): Promise<string> {
  const body = buildCreateAccountBody(params);

  const res = await fetchImpl(`${stripTrailingSlash(parent.baseUrl)}/v2/accounts`, {
    method: "POST",
    headers: {
      "X-Api-Token": parent.parentToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  const read = readCompanyIdFromCreateAccount(raw);
  if (!read.ok) {
    throw new NotificameError(read.code, "NotificaMe recusou a criação da conta oficial");
  }
  return read.companyId;
}

// ─── Reconciliação por `GET /v1/resale/` (puro na decisão, I/O isolado) ──────

/**
 * O QUE `GET /v1/resale/` É, e por que ele vira PRÉ-CONDIÇÃO do `POST /v2/accounts`:
 * é a ÚNICA trilha existente entre uma org do Torque e uma subconta do painel de
 * revenda. Cada item traz `email` (o determinístico `torque-<org>@<dominio>`) e
 * `acccount_id` — com três `c`, a grafia da conta viva —, que É o token daquela
 * subconta, byte-a-byte igual ao `CompanyId` do POST.
 *
 * A subconta é IRREMOVÍVEL e faturável. Logo, criar por engano não tem desfazer, e
 * criar DUAS com o mesmo `vendor_email` é pior do que caro: destrói a própria
 * trilha, porque as duas ficam indistinguíveis nesta listagem. Por isso o desenho
 * é ADOTAR ANTES DE CRIAR — quem já existe lá é reaproveitado, e o POST só sai
 * quando esta listagem PROVA a ausência.
 *
 * DAÍ O FAIL-CLOSED SER O CONTRÁRIO DO USUAL: aqui, "não consegui ler" NUNCA pode
 * virar "não existe". Listagem ilegível, formato inesperado ou transporte quebrado
 * devolvem `ok:false`, e quem chama é obrigado a NÃO criar. O preço é uma org
 * esperando; o preço do outro lado é uma subconta órfã e cobrada para sempre.
 */
export type ResaleLookup =
  /** A listagem foi lida e o email NÃO está lá. É o ÚNICO veredito que libera criar. */
  | { ok: true; status: "absent" }
  /** Existe e o token é utilizável: ADOTAR, jamais criar. */
  | { ok: true; status: "found"; accountToken: string }
  /** Existe, mas o token não veio legível. Existe é existe: NUNCA criar. */
  | { ok: true; status: "found_without_token" }
  /** O dano já consumado: dois itens com o MESMO email. Só humano desempata. */
  | { ok: true; status: "duplicated"; count: number }
  | {
    ok: false;
    code:
      | "resale_transport_error"
      | "resale_unreadable"
      | "resale_rejected"
      | "resale_unexpected_shape";
  };

/**
 * Chaves sob as quais a lista pode vir embrulhada. Tolerância no CONTAINER é
 * barata e reversível; a intolerância fica onde importa — no `acccount_id`, que é
 * CREDENCIAL, e no tamanho dele.
 */
const RESALE_LIST_KEYS = ["data", "accounts", "companies", "resale", "result", "items"] as const;

function extractResaleList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value === null || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  for (const key of RESALE_LIST_KEYS) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  return null;
}

/**
 * Lê o token de um item da revenda. `acccount_id` (três `c`) é a grafia PROVADA
 * contra a conta viva; `account_id` entra como tolerância única para o dia em que
 * o fornecedor corrigir o próprio typo. Nada além disso: adivinhar o nome de um
 * campo que é credencial é como se adota o valor errado como token de uma org.
 *
 * O tamanho é verificado porque um valor curto adotado como token viraria uma
 * subconta "pronta" que não autentica em nada — e o sintoma apareceria longe daqui.
 */
function readResaleAccountToken(item: Record<string, unknown>): string | null {
  for (const key of ["acccount_id", "account_id"]) {
    const raw = item[key];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === COMPANY_ID_LENGTH) return trimmed;
  }
  return null;
}

/**
 * Procura o `vendor_email` determinístico na listagem da revenda. PURO.
 *
 * Comparação case-insensitive e com trim: o email é NOSSO e determinístico, mas o
 * fornecedor o devolve como o guardou, e um `A` maiúsculo virando "absent" seria
 * uma segunda subconta faturável.
 */
export function findResaleAccountByEmail(rawText: string, email: string): ResaleLookup {
  const wanted = email.trim().toLowerCase();
  // Email vazio casaria com qualquer item sem email. Fail-closed.
  if (!wanted) return { ok: false, code: "resale_unexpected_shape" };

  const parsed = parseNotificameBody(rawText);
  if (!parsed.ok) {
    return {
      ok: false,
      code: parsed.code === "non_json_response" ? "resale_unreadable" : "resale_rejected",
    };
  }

  const list = extractResaleList(parsed.value);
  if (!list) return { ok: false, code: "resale_unexpected_shape" };

  const matches: Array<Record<string, unknown>> = [];
  for (const item of list) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    const itemEmail = typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
    if (itemEmail && itemEmail === wanted) matches.push(r);
  }

  if (matches.length === 0) return { ok: true, status: "absent" };
  if (matches.length > 1) return { ok: true, status: "duplicated", count: matches.length };

  const token = readResaleAccountToken(matches[0]);
  return token
    ? { ok: true, status: "found", accountToken: token }
    : { ok: true, status: "found_without_token" };
}

/**
 * ⚠️ I/O, mas SOMENTE LEITURA — e é essa assimetria que o desenho usa: falhar aqui
 * custa uma espera, falhar no `POST /v2/accounts` custa uma subconta para sempre.
 *
 * NÃO LANÇA: devolve o veredito como DADO. Exceção aqui atravessaria o
 * `withErrorBoundary` e sairia como 500; pior, um `catch` distraído no chamador
 * poderia degradar "não sei" para "não existe" e liberar a criação.
 */
export async function lookupResaleAccountByEmail(
  parent: NotificameParentConfig,
  email: string,
  fetchImpl: FetchImpl = fetch,
): Promise<ResaleLookup> {
  let raw: string;
  try {
    const res = await fetchImpl(`${stripTrailingSlash(parent.baseUrl)}/v1/resale/`, {
      method: "GET",
      headers: {
        "X-Api-Token": parent.parentToken,
        Accept: "application/json",
      },
    });
    raw = await res.text();
  } catch {
    // Sem corpo não há veredito. `resale_transport_error` é "não sei", nunca "não existe".
    return { ok: false, code: "resale_transport_error" };
  }
  return findResaleAccountByEmail(raw, email);
}

// ─── Canal (puro) ────────────────────────────────────────────────────────────

export interface NotificameChannel {
  id: string;
  name?: string | null;
  phone?: string | null;
  type?: string | null;
  status?: string | null;
}

/**
 * Normaliza um item de `/v1/channels`. Mapeamento TOLERANTE nos aliases porque a
 * doc do fornecedor é uma SPA e o contrato veio do SDK — mas INTOLERANTE na
 * identidade: sem `id` reconhecível o item vira `null` e é descartado, porque
 * vincular um canal sem id é vincular nada.
 */
export function normalizeChannel(raw: unknown): NotificameChannel | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const id = firstString(r.id, r.uuid, r.channel_id);
  if (!id) return null;

  return {
    id,
    name: firstString(r.name, r.title) ?? null,
    phone: firstString(r.phone, r.number, r.phone_number) ?? null,
    type: firstString(r.type, r.channel_type) ?? null,
    status: firstString(r.status) ?? null,
  };
}

function firstString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (typeof c === "number" && Number.isFinite(c)) return String(c);
  }
  return null;
}

// ─── Listagem de canais (I/O) ────────────────────────────────────────────────

/**
 * `GET /v1/channels` com o token DA SUBCONTA. Lê `res.text()` e decide pelo
 * CORPO; nunca por `res.ok`/`res.status`.
 *
 * A assinatura pede `NotificameOrgConfig` e isso é a defesa, não a documentação:
 * a lista já chega ESCOPADA àquela org, e é por construção — não por filtro —
 * que a captura cross-tenant deixa de ser alcançável. Com o token do pai, esta
 * chamada devolveria os canais de TODAS as orgs, que era exatamente o bug.
 *
 * Lança `NotificameError` com código estável. A mensagem é nossa e fixa — não
 * carrega o corpo do fornecedor nem, jamais, o token.
 */
export async function listChannels(
  cfg: NotificameOrgConfig,
  fetchImpl: FetchImpl = fetch,
): Promise<NotificameChannel[]> {
  const res = await fetchImpl(`${stripTrailingSlash(cfg.baseUrl)}/v1/channels`, {
    method: "GET",
    headers: {
      "X-Api-Token": cfg.subaccountToken,
      Accept: "application/json",
    },
  });

  const raw = await res.text();
  const parsed = parseNotificameBody(raw);

  if (!parsed.ok) {
    throw new NotificameError(parsed.code, "NotificaMe recusou a listagem de canais");
  }
  if (!Array.isArray(parsed.value)) {
    throw new NotificameError(
      "unexpected_shape",
      "NotificaMe devolveu um formato inesperado na listagem de canais",
    );
  }

  const channels: NotificameChannel[] = [];
  for (const item of parsed.value) {
    const channel = normalizeChannel(item);
    if (channel) channels.push(channel);
  }
  return channels;
}

// ─── Escolha do canal recém-nascido (puro) ───────────────────────────────────

export type PickChannelResult =
  | { ok: true; channel: NotificameChannel }
  | { ok: false; code: "no_channel_found" | "ambiguous_channel"; candidates: number };

/**
 * Descobre QUAL canal acabou de nascer. O `postMessage` do Seamless só diz
 * `{status:"channel-success"}` — sem id, sem telefone —, então a identidade é
 * DEDUZIDA por diferença:
 *
 *     candidatos = (listados \ reivindicados) \ baseline
 *
 * A BASELINE é a foto dos canais que a subconta JÁ tinha no instante do clique.
 * Ela existe por causa de um modo de falha que a subconta sozinha NÃO resolve: um
 * popup ABANDONADO deixa um canal livre dentro da própria subconta da org, e sem
 * a foto toda conexão seguinte daquela org bateria em `ambiguous_channel` PARA
 * SEMPRE, sem saída pela UI. Com a foto, o órfão está nela e sai da conta.
 *
 * `baselineIds === null` = sessão ausente (o start de sessão falhou, ou o cliente
 * é antigo). Caminho DEGRADADO, e não inseguro: sob subconta a lista já é da org,
 * então o pior desfecho é um `ambiguous_channel` conservador — que é o desfecho
 * certo quando não se sabe qual dos dois é o novo.
 *
 *   0 candidatos → `no_channel_found`  — RETENTÁVEL: `/v1/channels` é
 *                  eventualmente consistente logo depois do canal nascer;
 *   1 candidato  → é ele;
 *   2+           → `ambiguous_channel` e PARA. Adivinhar em vínculo de tenant é
 *                  entregar mensagens de uma empresa a outra. COM baseline, 2+ só
 *                  acontece sob concorrência real (dois canais nascidos depois da
 *                  foto), e aí esperar resolve — é o cliente que decide retentar.
 */
export function pickNewChannel(
  listed: NotificameChannel[],
  baselineIds: Set<string> | null,
  claimedIds: Set<string>,
): PickChannelResult {
  const candidates = listed.filter(
    (c) => !claimedIds.has(c.id) && !(baselineIds?.has(c.id) ?? false),
  );
  if (candidates.length === 0) {
    return { ok: false, code: "no_channel_found", candidates: 0 };
  }
  if (candidates.length > 1) {
    return { ok: false, code: "ambiguous_channel", candidates: candidates.length };
  }
  return { ok: true, channel: candidates[0] };
}

// ─── Linha de `whatsapp_instances` (puro) ────────────────────────────────────

export interface NotificameProviderConfig {
  vendor: "notificame";
  /**
   * O UUID da linha de `notificame_subaccounts` — REFERÊNCIA, não credencial.
   *
   * ⚠️ É o campo mais afiado deste módulo e o mais fácil de religar errado no
   * refactor, porque o código quase não muda: mudou o que o valor SIGNIFICA. Aqui
   * NUNCA entra o `company_uuid`/token da subconta. `whatsapp_instances` é lida
   * sob RLS por QUALQUER membro da org — inclusive quem não tem
   * `whatsapp.manage_instances` —, então carimbar o token aqui é vazar a
   * credencial da org para todo o time do cliente.
   */
  subaccount_id: string;
  /** Identidade do canal. É este campo — e não `instance_id` — que tem dono. */
  channel_id: string;
  channel_type: string;
  connected_via: "seamless_v2";
  connected_at: string;
  [key: string]: unknown;
}

export interface NotificameInstanceRow {
  organization_id: string;
  provider: "notificame";
  instance_name: string;
  phone_number: string | null;
  status: "connected";
  provider_config: NotificameProviderConfig;
}

/**
 * Monta a linha de `whatsapp_instances` do canal conectado.
 *
 * `status: 'connected'` é a VERDADE sobre o canal (o mesmo que o precedente
 * meta_cloud faz) — e o preço disso é o isolamento provider-cego que a fatia
 * fecha com teste: o fallback de `selectSendableInstance` e o `instancesToNumbers`
 * do wizard de Disparo. `'connecting'` evitaria os dois de graça e deixaria o
 * card em "Conectando…" para sempre: mentira pior.
 *
 * `instance_id` fica FORA da linha de propósito: o id do canal tem um dono só,
 * `provider_config->>'channel_id'`, que é onde mora o índice único parcial
 * `uq_whatsapp_instances_notificame_channel`.
 *
 * `organizationId` vem SEMPRE do contexto de auth validado — nunca do body.
 * `subaccountId` vem SEMPRE do `id` da linha do cofre — nunca do token dela.
 */
export function buildNotificameInstanceRow(params: {
  organizationId: string;
  subaccountId: string;
  channel: NotificameChannel;
  now?: Date;
}): NotificameInstanceRow {
  const { organizationId, subaccountId, channel } = params;
  const digits = (channel.phone ?? "").replace(/\D/g, "");
  const phoneNumber = digits.length > 0 ? digits : null;
  const name = (channel.name ?? "").trim();

  const instanceName = name
    ? name
    : phoneNumber
    ? `WhatsApp Oficial ${phoneNumber}`
    : `WhatsApp Oficial ${channel.id.slice(0, 8)}`;

  return {
    organization_id: organizationId,
    provider: "notificame",
    instance_name: instanceName,
    phone_number: phoneNumber,
    status: "connected",
    provider_config: {
      vendor: "notificame",
      subaccount_id: subaccountId,
      channel_id: channel.id,
      channel_type: channel.type ?? "whatsapp",
      connected_via: "seamless_v2",
      connected_at: (params.now ?? new Date()).toISOString(),
    },
  };
}

/**
 * Extrai o `channel_id` de um `provider_config` lido do banco. Usado para montar
 * o conjunto de reivindicados — que agora é lido COM filtro de organization_id: a
 * lista de canais já vem escopada pela subconta, então perguntar por canais de
 * outros tenants seria leitura cross-tenant sem propósito. O índice único global
 * segue sendo a última linha de defesa contra atribuição errada.
 */
export function readClaimedChannelId(providerConfig: unknown): string | null {
  if (providerConfig === null || typeof providerConfig !== "object") return null;
  const id = (providerConfig as Record<string, unknown>).channel_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

// ─── Gate de feature (impuro — uma leitura no banco) ─────────────────────────

/**
 * ⚠️ ÚNICO membro impuro além de `listChannels` e `createSubaccount`.
 *
 * Lê o jsonb leve `organizations.feature_flags` (molde: `copilot-builder/index.ts`).
 * `=== true` ESTRITO: chave ausente, string "true" ou qualquer truthy contam
 * como desligado. Fail-closed também no erro.
 *
 * Este gate é repetido SERVER-SIDE nas duas edge functions porque elas rodam com
 * `verify_jwt = false` e são publicamente alcançáveis — gate só no frontend não
 * é gate. `admin` precisa ser o cliente service_role.
 */
export async function isNotificameEnabledForOrg(
  admin: SupabaseClient,
  organizationId: string,
): Promise<boolean> {
  try {
    const { data } = await admin
      .from("organizations")
      .select("feature_flags")
      .eq("id", organizationId)
      .maybeSingle();
    const flags = ((data as { feature_flags?: unknown } | null)?.feature_flags ?? {}) as Record<
      string,
      unknown
    >;
    return flags.notificame === true;
  } catch (err) {
    console.warn("[notificame] feature flag lookup failed:", (err as Error)?.message);
    return false;
  }
}
