/**
 * Provisionamento IDEMPOTENTE da subconta NotificaMe por org.
 *
 * Aqui mora o dinheiro do fornecedor. `POST /v2/accounts` cria um objeto
 * IRREMOVÍVEL e faturável dentro da conta de revenda: um clique duplo, um
 * remount de `useQuery` ou um refocus de janela que escapem viram uma SEGUNDA
 * subconta que ninguém consegue apagar. Por isso a idempotência tem que morar no
 * BANCO (UNIQUE em `organization_id` + claim-row gravada ANTES da chamada ao
 * fornecedor), nunca no cache do TanStack.
 *
 * O QUE ESTE ARQUIVO PROVA — e por que a ORDEM importa mais que o resultado:
 * um teste que só olhasse o estado final passaria numa implementação que faz
 * `POST` primeiro e `ON CONFLICT DO NOTHING` depois. Essa implementação já teria
 * criado a subconta duplicada no fornecedor e descartado a linha. A janela tem
 * que fechar ANTES do POST, e é isso que os casos de ordem/concorrência cobram.
 *
 * O FAKE DE BANCO tem UNIQUE de verdade em `organization_id` e devolve `23505`
 * na violação. Dublê mais frouxo que o real é como um teste de corrida vira
 * decorativo: sem a constraint, duas execuções concorrentes inseririam duas
 * linhas e o caso de concorrência passaria verde no arquivo e vermelho em prod.
 *
 * O módulo `_shared/notificame-credentials.ts` é importado DINAMICAMENTE: se ele
 * ainda não existe, cada teste falha com o motivo legível em vez de a coleta
 * abortar e o arquivo inteiro contar como zero testes.
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";

// ── Deno.env, exigido pelos módulos de `_shared/` ────────────────────────────
// Chave hex de 64 chars (AES-256). Precisa existir ANTES do import dinâmico:
// o precedente `omie-credentials.ts` lê a chave no topo do módulo.
const ENC_KEY = "a".repeat(64);
const denoEnv: Record<string, string | undefined> = {
  NOTIFICAME_ENCRYPTION_KEY: ENC_KEY,
  SUPABASE_URL: "http://localhost",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
};
(globalThis as unknown as Record<string, unknown>).Deno = {
  env: { get: (k: string) => denoEnv[k], set: (k: string, v: string) => (denoEnv[k] = v) },
};

// ── fixtures ─────────────────────────────────────────────────────────────────

const ORG = "6030520a-2ca7-477d-be89-55758e2cd808";
const ORG_NAME = "Milennials";
/** Token da CONTA-MÃE — raio de explosão = todas as orgs. */
const PARENT_TOKEN = "11111111-1111-4111-8111-111111111111";
/** CompanyId devolvido pelo POST. Sob revenda, ELE É O TOKEN da subconta. */
const SUB_TOKEN = "22222222-2222-4222-8222-222222222222";

const PARENT = { baseUrl: "https://api.notificame.com.br", parentToken: PARENT_TOKEN };
const DEFAULTS = {
  country: "BR",
  company_address: "Rua Um, 100",
  phone: "5551999999999",
  cpf_cnpj: "00000000000191",
  email_domain: "milennials.com.br",
};

/** Resposta REAL do POST /v2/accounts, provada contra a conta viva. */
const REAL_CREATE_OK = JSON.stringify({ CompanyId: SUB_TOKEN, Status: "Sucesso" });
/** A forma que a DOC promete e a conta viva nunca devolve. */
const DOC_CREATE_OK = JSON.stringify({ status: "success" });
/** Rota desconhecida: HTTP 200 com envelope de erro do Graph. */
const HUB404 = '{"error":{"type":"OAuthException","code":"Hub404"}}';

// ═════════════════════════════════════════════════════════════════════════════
// Fake de banco — chainable, com UNIQUE de verdade e trilha de eventos
// ═════════════════════════════════════════════════════════════════════════════

type Row = Record<string, unknown>;

interface Event {
  seq: number;
  kind: "db" | "fetch" | "rpc";
  detail: string;
}

class FakeDb {
  tables: Record<string, Row[]> = { notificame_subaccounts: [], notificame_connect_sessions: [] };
  /** Colunas com UNIQUE. É o portão de idempotência do desenho. */
  unique: Record<string, string[]> = { notificame_subaccounts: ["organization_id"] };
  events: Event[] = [];
  private seq = 0;

  log(kind: Event["kind"], detail: string) {
    this.events.push({ seq: this.seq++, kind, detail });
  }

  rows(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = [];
    return this.tables[table];
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }

  rpc(name: string, args?: unknown) {
    this.log("rpc", `rpc:${name}`);
    return Promise.resolve({
      data: null,
      error: {
        code: "42883",
        message:
          `RPC \`${name}\` não está stubada neste teste. O choke de provisionamento ` +
          `deveria falar direto com a tabela por service_role (precedente omie_connection_secrets). ` +
          `args=${JSON.stringify(args ?? null)}`,
      },
    });
  }

  /** Índices dos eventos, por tipo — usado para provar ORDEM. */
  firstIndexOf(kind: Event["kind"], match?: RegExp): number {
    return this.events.findIndex((e) => e.kind === kind && (!match || match.test(e.detail)));
  }
}

type Filter = { col: string; op: string; val: unknown };

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: Row[] = [];
  private upsertOpts: Record<string, unknown> = {};
  private filters: Filter[] = [];
  private mode: "many" | "single" | "maybe" = "many";

  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string) {
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = "insert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }
  upsert(payload: Row | Row[], opts?: Record<string, unknown>) {
    this.op = "upsert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    this.upsertOpts = opts ?? {};
    return this;
  }
  update(payload: Row) {
    this.op = "update";
    this.payload = [payload];
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }

  eq(col: string, val: unknown) {
    this.filters.push({ col, op: "eq", val });
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push({ col, op: "neq", val });
    return this;
  }
  in(col: string, val: unknown[]) {
    this.filters.push({ col, op: "in", val });
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push({ col, op: "eq", val });
    return this;
  }
  lt(col: string, val: unknown) {
    this.filters.push({ col, op: "lt", val });
    return this;
  }
  lte(col: string, val: unknown) {
    this.filters.push({ col, op: "lte", val });
    return this;
  }
  gt(col: string, val: unknown) {
    this.filters.push({ col, op: "gt", val });
    return this;
  }
  gte(col: string, val: unknown) {
    this.filters.push({ col, op: "gte", val });
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      const v = row[f.col];
      switch (f.op) {
        case "eq":
          return v === f.val;
        case "neq":
          return v !== f.val;
        case "in":
          return Array.isArray(f.val) && (f.val as unknown[]).includes(v);
        case "lt":
          return String(v) < String(f.val);
        case "lte":
          return String(v) <= String(f.val);
        case "gt":
          return String(v) > String(f.val);
        case "gte":
          return String(v) >= String(f.val);
        default:
          return true;
      }
    });
  }

  private uniqueConflict(row: Row): Row | null {
    const cols = this.db.unique[this.table] ?? [];
    if (cols.length === 0) return null;
    return (
      this.db.rows(this.table).find((existing) => cols.every((c) => existing[c] === row[c])) ?? null
    );
  }

  private exec(): { data: unknown; error: unknown } {
    const rows = this.db.rows(this.table);

    if (this.op === "insert" || this.op === "upsert") {
      const written: Row[] = [];
      for (const p of this.payload) {
        const conflict = this.uniqueConflict(p);
        if (conflict) {
          if (this.op === "insert") {
            this.db.log("db", `insert-conflict:${this.table}`);
            return {
              data: null,
              error: {
                code: "23505",
                message:
                  'duplicate key value violates unique constraint "notificame_subaccounts_organization_id_key"',
              },
            };
          }
          // upsert
          if (this.upsertOpts.ignoreDuplicates === true) {
            this.db.log("db", `upsert-ignored:${this.table}`);
            continue;
          }
          Object.assign(conflict, p, { updated_at: new Date().toISOString() });
          this.db.log("db", `upsert-merge:${this.table}`);
          written.push(conflict);
          continue;
        }
        const row: Row = {
          id: `row-${this.table}-${rows.length + 1}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...p,
        };
        rows.push(row);
        this.db.log("db", `${this.op}:${this.table}`);
        written.push(row);
      }
      return this.shape(written);
    }

    if (this.op === "update") {
      const hit = rows.filter((r) => this.matches(r));
      for (const r of hit) Object.assign(r, this.payload[0], { updated_at: new Date().toISOString() });
      this.db.log("db", `update:${this.table}(${hit.length})`);
      return this.shape(hit);
    }

    if (this.op === "delete") {
      const keep = rows.filter((r) => !this.matches(r));
      const removed = rows.length - keep.length;
      this.db.tables[this.table] = keep;
      this.db.log("db", `delete:${this.table}(${removed})`);
      return this.shape([]);
    }

    const found = rows.filter((r) => this.matches(r));
    this.db.log("db", `select:${this.table}(${found.length})`);
    return this.shape(found);
  }

  private shape(rows: Row[]): { data: unknown; error: unknown } {
    if (this.mode === "single") {
      if (rows.length !== 1) {
        return {
          data: null,
          error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
        };
      }
      return { data: rows[0], error: null };
    }
    if (this.mode === "maybe") return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }

  then<TR1 = { data: unknown; error: unknown }, TR2 = never>(
    onfulfilled?: ((v: { data: unknown; error: unknown }) => TR1 | PromiseLike<TR1>) | null,
    onrejected?: ((r: unknown) => TR2 | PromiseLike<TR2>) | null,
  ): PromiseLike<TR1 | TR2> {
    // `Promise.resolve().then` de propósito: dá um tick de microtask entre a
    // decisão e a resposta, que é o que permite o caso de CONCORRÊNCIA de
    // verdade (duas execuções intercaladas) em vez de um teste sequencial
    // disfarçado.
    return Promise.resolve()
      .then(() => this.exec())
      .then(onfulfilled ?? undefined, onrejected ?? undefined) as PromiseLike<TR1 | TR2>;
  }
}

// ── fetch fake, na mesma trilha de eventos do banco ──────────────────────────

/**
 * ROTEADO POR URL, e não posicional. O provisionamento passou a falar com DOIS
 * endpoints — `GET /v1/resale/` (reconciliar, de graça) e `POST /v2/accounts`
 * (criar, irreversível) —, e um dublê posicional misturaria os dois: a asserção
 * "não chamou o fornecedor" ficaria verde só porque a contagem inclui a leitura
 * inofensiva. `createCalls` é a contagem que vale dinheiro, e é ela que os casos
 * de duplicata cobram.
 */
const EMPTY_RESALE = "[]";

function makeFetch(
  db: FakeDb,
  createBodies: string[],
  status = 200,
  resaleBodies: string[] = [EMPTY_RESALE],
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const createCalls: Array<{ url: string; init?: RequestInit }> = [];
  const resaleCalls: Array<{ url: string; init?: RequestInit }> = [];
  let ci = 0;
  let ri = 0;
  const impl = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const call = { url, init };
    calls.push(call);
    db.log("fetch", url);

    let body: string;
    if (url.includes("/v1/resale")) {
      resaleCalls.push(call);
      body = resaleBodies[Math.min(ri, resaleBodies.length - 1)];
      ri++;
    } else {
      createCalls.push(call);
      body = createBodies[Math.min(ci, createBodies.length - 1)];
      ci++;
    }
    return Promise.resolve(new Response(body, { status }));
  };
  return Object.assign(impl, { calls, createCalls, resaleCalls });
}

/** Item de `GET /v1/resale/` como a conta viva devolve — `acccount_id`, três `c`. */
function resaleItem(email: string, accountId: string, extra: Row = {}): Row {
  return {
    email,
    name: "Torque",
    active: true,
    channels: 1,
    createdAt: "2027-08-13T00:00:00Z",
    acccount_id: accountId,
    ...extra,
  };
}

/** O determinístico. É a ÚNICA trilha org ↔ subconta no painel de revenda. */
const VENDOR_EMAIL = `torque-${ORG}@${DEFAULTS.email_domain}`;

// ── import dinâmico do choke ─────────────────────────────────────────────────

const MODULE_PATH = "../../supabase/functions/_shared/notificame-credentials";
let mod: Record<string, unknown> | null = null;
let importError: unknown = null;

beforeAll(async () => {
  try {
    mod = (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch (e) {
    importError = e;
  }
});

function fnOf<T>(name: string): T {
  if (!mod) {
    throw new Error(
      `AUSENTE: supabase/functions/_shared/notificame-credentials.ts não pôde ser importado — ` +
        `o choke de provisionamento da subconta ainda não existe neste worktree. ` +
        `Causa: ${(importError as Error)?.message ?? importError}`,
    );
  }
  const f = mod[name];
  if (typeof f !== "function") {
    throw new Error(
      `AUSENTE: \`${name}\` não é exportada por _shared/notificame-credentials.ts. ` +
        `Exports encontradas: ${Object.keys(mod).join(", ") || "(nenhuma)"}`,
    );
  }
  return f as T;
}

type EnsureFn = (
  admin: unknown,
  params: Record<string, unknown>,
  fetchImpl?: unknown,
) => Promise<Record<string, unknown>>;

type LoadFn = (admin: unknown, organizationId: string) => Promise<unknown>;

function ensureParams() {
  return { organizationId: ORG, orgName: ORG_NAME, parent: PARENT, defaults: DEFAULTS };
}

/** Tolerante ao shape do retorno: `{ok, subaccount|code}` ou o objeto direto. */
function readEnsure(r: unknown): { ok: boolean; companyUuid: string | null; code: string | null } {
  if (!r || typeof r !== "object") return { ok: false, companyUuid: null, code: null };
  const o = r as Record<string, unknown>;
  if (o.ok === false) return { ok: false, companyUuid: null, code: (o.code as string) ?? null };
  const sub = (o.subaccount ?? o) as Record<string, unknown>;
  const cu = (sub.companyUuid ?? sub.company_uuid) as string | undefined;
  return { ok: o.ok === true || !!cu, companyUuid: cu ?? null, code: (o.code as string) ?? null };
}

let db: FakeDb;

beforeEach(() => {
  db = new FakeDb();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. Idempotência — o caso que impede subconta duplicada e faturável
// ═════════════════════════════════════════════════════════════════════════════

describe("ensureNotificameSubaccount — idempotência", () => {
  it("rodar DUAS VEZES para a mesma org NÃO cria duas subcontas", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    const f = makeFetch(db, [REAL_CREATE_OK]);

    const a = readEnsure(await ensure(db, ensureParams(), f));
    const b = readEnsure(await ensure(db, ensureParams(), f));

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(b.companyUuid).toBe(a.companyUuid);
    expect(a.companyUuid).toBe(SUB_TOKEN);

    // O que de fato importa: UMA linha e UMA CRIAÇÃO no fornecedor.
    expect(db.rows("notificame_subaccounts")).toHaveLength(1);
    expect(
      f.createCalls,
      "a segunda execução chamou POST /v2/accounts de novo — subconta duplicada e irremovível",
    ).toHaveLength(1);
  });

  it(
    "a CLAIM é gravada ANTES do POST ao fornecedor — a ordem é o desenho, " +
      "não o resultado final",
    async () => {
      const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
      const f = makeFetch(db, [REAL_CREATE_OK]);
      await ensure(db, ensureParams(), f);

      const firstWrite = db.firstIndexOf("db", /^(insert|upsert)/);
      const firstFetch = db.firstIndexOf("fetch");

      expect(firstWrite, "nenhuma escrita em notificame_subaccounts foi registrada").toBeGreaterThanOrEqual(0);
      expect(firstFetch, "nenhuma chamada ao fornecedor foi registrada").toBeGreaterThanOrEqual(0);
      expect(
        firstWrite,
        "o POST /v2/accounts partiu ANTES da claim: um ON CONFLICT depois da chamada " +
          "já teria criado a subconta duplicada no fornecedor",
      ).toBeLessThan(firstFetch);
    },
  );

  it("linha 'ready' pré-existente devolve a existente e faz ZERO chamadas ao fornecedor", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    // Semeia uma subconta já provisionada, cifrada pelo próprio módulo de crypto
    // (round-trip real, não um placeholder que o decifrador rejeitaria).
    const { encryptSecret } = await import("../../supabase/functions/_shared/crypto");
    const enc = await (encryptSecret as (p: string, k: string) => Promise<{ ciphertext: string; nonce: string }>)(
      SUB_TOKEN,
      ENC_KEY,
    );
    db.rows("notificame_subaccounts").push({
      id: "sub-1",
      organization_id: ORG,
      status: "ready",
      company_uuid_ciphertext: enc.ciphertext,
      company_uuid_nonce: enc.nonce,
      encryption_key_id: "v1",
      vendor_email: `torque-${ORG}@milennials.com.br`,
      updated_at: new Date().toISOString(),
    });

    const f = makeFetch(db, [REAL_CREATE_OK]);
    const r = readEnsure(await ensure(db, ensureParams(), f));

    expect(r.ok).toBe(true);
    expect(r.companyUuid).toBe(SUB_TOKEN);
    expect(f.calls, "clique-duplo criou uma segunda subconta no fornecedor").toHaveLength(0);
    expect(db.rows("notificame_subaccounts")).toHaveLength(1);
  });

  it("duas execuções CONCORRENTES criam no máximo UMA subconta (a UNIQUE é o portão)", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    const f = makeFetch(db, [REAL_CREATE_OK]);

    await Promise.all([ensure(db, ensureParams(), f), ensure(db, ensureParams(), f)]);

    expect(db.rows("notificame_subaccounts")).toHaveLength(1);
    expect(
      f.createCalls.length,
      "duas claims venceram ao mesmo tempo — a janela não fecha antes do POST",
    ).toBeLessThanOrEqual(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Resposta do fornecedor — sucesso por CompanyId, HTTP 200 mentiroso
// ═════════════════════════════════════════════════════════════════════════════

describe("ensureNotificameSubaccount — leitura da resposta do POST", () => {
  it('a resposta REAL {"CompanyId":"…","Status":"Sucesso"} é reconhecida como SUCESSO', async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    const f = makeFetch(db, [REAL_CREATE_OK]);
    const r = readEnsure(await ensure(db, ensureParams(), f));

    expect(r.ok).toBe(true);
    expect(r.companyUuid).toBe(SUB_TOKEN);
    expect(db.rows("notificame_subaccounts")[0]?.status).toBe("ready");
  });

  it(
    'CONTROLE NEGATIVO: {"status":"success"} — a forma da DOC, sem CompanyId — ' +
      "NUNCA vira 'ready'",
    async () => {
      const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
      const f = makeFetch(db, [DOC_CREATE_OK]);
      const r = readEnsure(await ensure(db, ensureParams(), f));

      expect(r.ok).toBe(false);
      const row = db.rows("notificame_subaccounts")[0];
      expect(row?.status).not.toBe("ready");
      expect(row?.company_uuid_ciphertext ?? null).toBeNull();
    },
  );

  it("HTTP 200 com corpo Hub404 é FALHA — `res.ok` mentiria", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    const f = makeFetch(db, [HUB404], 200);
    const r = readEnsure(await ensure(db, ensureParams(), f));

    expect(r.ok).toBe(false);
    expect(db.rows("notificame_subaccounts")[0]?.status).not.toBe("ready");
  });

  it("HTTP 404 com AUTHENTICATION_ERROR também é falha (não é 401, e o status não decide)", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    const f = makeFetch(db, ['{"code":"AUTHENTICATION_ERROR"}'], 404);
    const r = readEnsure(await ensure(db, ensureParams(), f));

    expect(r.ok).toBe(false);
    expect(db.rows("notificame_subaccounts")[0]?.status).not.toBe("ready");
  });

  it("texto puro do ServeMux do Go não vaza SyntaxError — vira falha com código nosso", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    const f = makeFetch(db, ["404 page not found\n"], 200);
    const r = readEnsure(await ensure(db, ensureParams(), f));
    expect(r.ok).toBe(false);
  });

  it("depois de uma falha, uma nova tentativa PODE provisionar (falha não é lápide)", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    // 1ª tentativa falha; 2ª devolve a resposta real.
    const f = makeFetch(db, [HUB404, REAL_CREATE_OK]);
    const primeira = readEnsure(await ensure(db, ensureParams(), f));
    expect(primeira.ok).toBe(false);

    const segunda = readEnsure(await ensure(db, ensureParams(), f));
    // Ou provisiona, ou devolve um código RETENTÁVEL — o que não pode é a org
    // ficar permanentemente sem saída pela UI.
    expect(
      segunda.ok || segunda.code === "provisioning_in_progress",
      `estado terminal após falha: code=${segunda.code}`,
    ).toBe(true);
    expect(db.rows("notificame_subaccounts")).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Segredos — nem o token do pai nem o da subconta em claro na tabela
// ═════════════════════════════════════════════════════════════════════════════

function deepScan(value: unknown, secret: string, path = "$"): string[] {
  const hits: string[] = [];
  if (typeof value === "string") {
    if (value.includes(secret)) hits.push(path);
    return hits;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...deepScan(v, secret, `${path}[${i}]`)));
    return hits;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      hits.push(...deepScan(v, secret, `${path}.${k}`));
    }
  }
  return hits;
}

describe("ensureNotificameSubaccount — segredos", () => {
  it("o token da CONTA-MÃE nunca chega à tabela nem ao retorno", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    const f = makeFetch(db, [REAL_CREATE_OK]);
    const r = await ensure(db, ensureParams(), f);

    expect(deepScan(db.tables, PARENT_TOKEN), "token da conta-mãe gravado no banco").toEqual([]);
    expect(deepScan(r, PARENT_TOKEN), "token da conta-mãe no retorno do choke").toEqual([]);
    // Ele PRECISA ter ido no header do POST — controle positivo, senão o teste
    // acima passaria numa implementação que nunca chamou o fornecedor.
    const headers = (f.createCalls[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers["X-Api-Token"]).toBe(PARENT_TOKEN);
    expect(f.createCalls[0]?.url).not.toContain(PARENT_TOKEN);
    // A reconciliação fala com a conta-MÃE também, e pelo header — nunca por URL.
    const resaleHeaders = (f.resaleCalls[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(resaleHeaders["X-Api-Token"]).toBe(PARENT_TOKEN);
    expect(f.resaleCalls[0]?.url).not.toContain(PARENT_TOKEN);
  });

  it("o company_uuid é gravado CIFRADO — nunca em texto puro numa coluna", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    const f = makeFetch(db, [REAL_CREATE_OK]);
    await ensure(db, ensureParams(), f);

    const row = db.rows("notificame_subaccounts")[0] ?? {};
    expect(deepScan(row, SUB_TOKEN), "token da subconta em texto puro na tabela").toEqual([]);
    expect(row.company_uuid_ciphertext, "ciphertext ausente numa linha 'ready'").toBeTruthy();
    expect(row.company_uuid_nonce).toBeTruthy();
  });

  it("a senha gerada NÃO é armazenada (débito declarado: o token é o caminho de acesso)", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    const f = makeFetch(db, [REAL_CREATE_OK]);
    await ensure(db, ensureParams(), f);

    const enviado = JSON.parse(String(f.createCalls[0]?.init?.body ?? "{}"));
    const senha = enviado?.company?.password ?? enviado?.password;
    expect(typeof senha, "o POST precisa mandar uma senha").toBe("string");
    expect(deepScan(db.tables, String(senha)), "a senha da subconta foi persistida").toEqual([]);
  });

  it("last_error_code guarda código NOSSO, nunca o texto do fornecedor", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    const f = makeFetch(db, ['{"code":"ERROR","message":"company não é revenda"}'], 200);
    await ensure(db, ensureParams(), f);

    const row = db.rows("notificame_subaccounts")[0] ?? {};
    expect(deepScan(row, "company não é revenda")).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. loadNotificameSubaccount — só 'ready' conta
// ═════════════════════════════════════════════════════════════════════════════

describe("loadNotificameSubaccount", () => {
  it("devolve null para linha 'provisioning' — meia-subconta não opera", async () => {
    const load = fnOf<LoadFn>("loadNotificameSubaccount");
    db.rows("notificame_subaccounts").push({
      id: "sub-1",
      organization_id: ORG,
      status: "provisioning",
      company_uuid_ciphertext: null,
      company_uuid_nonce: null,
    });
    await expect(load(db, ORG)).resolves.toBeNull();
  });

  it("devolve null para org sem linha nenhuma", async () => {
    const load = fnOf<LoadFn>("loadNotificameSubaccount");
    await expect(load(db, ORG)).resolves.toBeNull();
  });

  it("CONTROLE POSITIVO: round-trip cifra→decifra devolve o company_uuid intacto", async () => {
    const load = fnOf<LoadFn>("loadNotificameSubaccount");
    const { encryptSecret } = await import("../../supabase/functions/_shared/crypto");
    const enc = await (encryptSecret as (p: string, k: string) => Promise<{ ciphertext: string; nonce: string }>)(
      SUB_TOKEN,
      ENC_KEY,
    );
    db.rows("notificame_subaccounts").push({
      id: "sub-1",
      organization_id: ORG,
      status: "ready",
      company_uuid_ciphertext: enc.ciphertext,
      company_uuid_nonce: enc.nonce,
      encryption_key_id: "v1",
    });

    const r = (await load(db, ORG)) as Record<string, unknown> | null;
    expect(r).not.toBeNull();
    expect(r?.companyUuid ?? r?.company_uuid).toBe(SUB_TOKEN);
  });

  it("linha de OUTRA org nunca é devolvida (org vem do auth, e o SELECT tem que filtrar)", async () => {
    const load = fnOf<LoadFn>("loadNotificameSubaccount");
    const { encryptSecret } = await import("../../supabase/functions/_shared/crypto");
    const enc = await (encryptSecret as (p: string, k: string) => Promise<{ ciphertext: string; nonce: string }>)(
      SUB_TOKEN,
      ENC_KEY,
    );
    db.rows("notificame_subaccounts").push({
      id: "sub-outra",
      organization_id: "org-de-outro-cliente",
      status: "ready",
      company_uuid_ciphertext: enc.ciphertext,
      company_uuid_nonce: enc.nonce,
    });
    await expect(load(db, ORG)).resolves.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4b. AUTOTESTE DO DUBLÊ — o fake precisa REPROVAR o desenho errado
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Enquanto `_shared/notificame-credentials.ts` não existe, todos os casos acima
 * são vermelhos por AUSÊNCIA — e um harness que ninguém exercitou é um harness
 * que pode estar frouxo. Este bloco roda DUAS implementações de referência
 * escritas aqui dentro:
 *
 *   • `refClaimAntes` — o desenho aprovado (claim gravada, DEPOIS o POST);
 *   • `refPostAntes`  — o desenho errado e mais natural de escrever (POST, e
 *                       `ON CONFLICT DO NOTHING` depois).
 *
 * As mesmas asserções dos blocos 1–2 precisam ficar VERDES na primeira e
 * VERMELHAS na segunda. Se o dublê deixasse as duas passarem, os 19 casos acima
 * virariam decoração no dia em que o módulo real chegasse.
 */
type RefImpl = (admin: FakeDb, params: Record<string, unknown>, fetchImpl: ReturnType<typeof makeFetch>) => Promise<Record<string, unknown>>;

async function postCreateAccount(
  params: Record<string, unknown>,
  fetchImpl: ReturnType<typeof makeFetch>,
): Promise<string | null> {
  const parent = params.parent as { baseUrl: string; parentToken: string };
  const res = await fetchImpl(`${parent.baseUrl}/v2/accounts`, {
    method: "POST",
    headers: { "X-Api-Token": parent.parentToken, "Content-Type": "application/json" },
    body: JSON.stringify({ company: { email: `torque-${params.organizationId}@x`, password: "p" } }),
  });
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed?.error) return null;
    const id = parsed?.CompanyId;
    return typeof id === "string" && id.length === 36 ? id : null;
  } catch {
    return null;
  }
}

const refClaimAntes: RefImpl = async (admin, params, fetchImpl) => {
  const orgId = params.organizationId as string;
  const { data: existing } = await admin
    .from("notificame_subaccounts")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();
  if ((existing as Row | null)?.status === "ready") return { ok: true, subaccount: existing };

  // CLAIM primeiro. Conflito = outra execução detém a janela.
  const { error } = await admin
    .from("notificame_subaccounts")
    .insert({ organization_id: orgId, status: "provisioning" })
    .select("id");
  if (error) return { ok: false, code: "provisioning_in_progress" };

  const companyId = await postCreateAccount(params, fetchImpl);
  if (!companyId) {
    await admin
      .from("notificame_subaccounts")
      .update({ status: "failed", last_error_code: "create_account_rejected" })
      .eq("organization_id", orgId);
    return { ok: false, code: "subaccount_provision_failed" };
  }
  await admin
    .from("notificame_subaccounts")
    .update({ status: "ready", company_uuid_ciphertext: "cipher", company_uuid_nonce: "n" })
    .eq("organization_id", orgId);
  return { ok: true, subaccount: { organizationId: orgId, companyUuid: companyId } };
};

const refPostAntes: RefImpl = async (admin, params, fetchImpl) => {
  const orgId = params.organizationId as string;
  // O DESENHO ERRADO: chama o fornecedor e só depois tenta gravar.
  const companyId = await postCreateAccount(params, fetchImpl);
  if (!companyId) return { ok: false, code: "subaccount_provision_failed" };
  await admin
    .from("notificame_subaccounts")
    .upsert(
      { organization_id: orgId, status: "ready", company_uuid_ciphertext: "cipher" },
      { onConflict: "organization_id", ignoreDuplicates: true },
    )
    .select("id");
  return { ok: true, subaccount: { organizationId: orgId, companyUuid: companyId } };
};

describe("autoteste do dublê — as asserções reprovam o desenho errado", () => {
  it("refClaimAntes: duas execuções → 1 linha, 1 POST, e a claim vem ANTES do POST", async () => {
    const d = new FakeDb();
    const f = makeFetch(d, [REAL_CREATE_OK]);
    await refClaimAntes(d, ensureParams(), f);
    await refClaimAntes(d, ensureParams(), f);

    expect(d.rows("notificame_subaccounts")).toHaveLength(1);
    expect(f.calls).toHaveLength(1);
    expect(d.firstIndexOf("db", /^insert/)).toBeLessThan(d.firstIndexOf("fetch"));
  });

  it("refPostAntes é PEGO: dois POSTs no fornecedor e a claim depois da chamada", async () => {
    const d = new FakeDb();
    const f = makeFetch(d, [REAL_CREATE_OK]);
    await refPostAntes(d, ensureParams(), f);
    await refPostAntes(d, ensureParams(), f);

    // A subconta duplicada e irremovível que este arquivo inteiro existe para impedir.
    expect(f.calls.length).toBeGreaterThan(1);
    // E a asserção de ORDEM também o reprova.
    expect(d.firstIndexOf("db", /^(insert|upsert)/)).toBeGreaterThan(d.firstIndexOf("fetch"));
  });

  it("a UNIQUE do dublê é de verdade: dois inserts na mesma org devolvem 23505", async () => {
    const d = new FakeDb();
    const primeiro = await d
      .from("notificame_subaccounts")
      .insert({ organization_id: ORG, status: "provisioning" })
      .select("id");
    const segundo = await d
      .from("notificame_subaccounts")
      .insert({ organization_id: ORG, status: "provisioning" })
      .select("id");

    expect(primeiro.error).toBeNull();
    expect((segundo.error as { code?: string } | null)?.code).toBe("23505");
    expect(d.rows("notificame_subaccounts")).toHaveLength(1);
  });

  it("refClaimAntes sob CONCORRÊNCIA: a UNIQUE segura, 1 linha e no máximo 1 POST", async () => {
    const d = new FakeDb();
    const f = makeFetch(d, [REAL_CREATE_OK]);
    await Promise.all([
      refClaimAntes(d, ensureParams(), f),
      refClaimAntes(d, ensureParams(), f),
    ]);
    expect(d.rows("notificame_subaccounts")).toHaveLength(1);
    expect(f.calls.length).toBeLessThanOrEqual(1);
  });

  it('refClaimAntes com o corpo da DOC ({"status":"success"}) nunca marca ready', async () => {
    const d = new FakeDb();
    const f = makeFetch(d, [DOC_CREATE_OK]);
    const r = readEnsure(await refClaimAntes(d, ensureParams(), f));
    expect(r.ok).toBe(false);
    expect(d.rows("notificame_subaccounts")[0]?.status).toBe("failed");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Chave de cifra ausente — fail-closed, sem escrita e sem fornecedor
// ═════════════════════════════════════════════════════════════════════════════

describe("NOTIFICAME_ENCRYPTION_KEY ausente", () => {
  it("não escreve nada, não chama o fornecedor e devolve encryption_key_missing", async () => {
    vi.resetModules();
    const saved = denoEnv.NOTIFICAME_ENCRYPTION_KEY;
    denoEnv.NOTIFICAME_ENCRYPTION_KEY = undefined;
    try {
      const fresh = (await import(MODULE_PATH)) as Record<string, unknown>;
      const ensure = fresh.ensureNotificameSubaccount as EnsureFn;
      expect(typeof ensure, "ensureNotificameSubaccount não existe no módulo").toBe("function");

      const f = makeFetch(db, [REAL_CREATE_OK]);
      const r = readEnsure(await ensure(db, ensureParams(), f));

      expect(r.ok).toBe(false);
      expect(r.code).toBe("encryption_key_missing");
      expect(f.calls, "chamou o fornecedor sem ter como guardar o token devolvido").toHaveLength(0);
      expect(db.rows("notificame_subaccounts")).toHaveLength(0);
    } finally {
      denoEnv.NOTIFICAME_ENCRYPTION_KEY = saved;
      vi.resetModules();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. RETOMADA — "falhou" não é uma coisa só
//
// O defeito que este bloco tranca: a tomada de claim olhava apenas
// `status != 'ready'` + `updated_at` velho. Três falhas significam "o objeto PODE
// existir no fornecedor" (`create_account_transport_error` — a requisição SAIU;
// `create_account_unreadable` — não LEMOS a resposta; `token_persist_failed` — a
// subconta EXISTE, só o token não gravou), mais `create_account_no_company_id`.
// Retomar cegamente nesses estados cria uma SEGUNDA subconta faturável e
// IRREMOVÍVEL com o MESMO `vendor_email` — e aí as duas ficam indistinguíveis em
// `GET /v1/resale/`, que é a única trilha de reconciliação que existe. O dano não
// é só o custo: é perder a capacidade de consertar.
// ═════════════════════════════════════════════════════════════════════════════

/** Semeia a linha deixada por uma tentativa anterior que morreu. */
function seedRow(fields: Row = {}) {
  db.rows("notificame_subaccounts").push({
    id: "sub-1",
    organization_id: ORG,
    status: "failed",
    last_error_code: null,
    vendor_email: VENDOR_EMAIL,
    company_uuid_ciphertext: null,
    company_uuid_nonce: null,
    // Bem além de qualquer janela de stale: a claim está comprovadamente morta,
    // então nada além do `last_error_code` pode barrar a retomada.
    updated_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    ...fields,
  });
}

/** Os estados em que o fornecedor PODE ter criado a subconta. */
const CODIGOS_PERIGOSOS = [
  ["create_account_transport_error", "a requisição saiu; a resposta é que se perdeu"],
  ["create_account_unreadable", "a resposta veio e não pôde ser lida"],
  ["create_account_no_company_id", "respondeu 200 sem CompanyId — pode ter criado assim mesmo"],
  ["token_persist_failed", "a subconta EXISTE; foi o token que não gravou"],
  ["create_account_timeout", "o deadline estourou com a requisição em voo"],
] as const;

describe("retomada — estados que NÃO autorizam criar", () => {
  for (const [code, porque] of CODIGOS_PERIGOSOS) {
    it(`\`${code}\` (${porque}) NUNCA vira um segundo POST /v2/accounts`, async () => {
      const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
      seedRow({ last_error_code: code });
      // A revenda diz "não existe" — e mesmo assim criar é proibido: uma conta
      // recém-nascida pode ainda não aparecer na listagem.
      const f = makeFetch(db, [REAL_CREATE_OK], 200, [EMPTY_RESALE]);

      const r = readEnsure(await ensure(db, ensureParams(), f));

      expect(
        f.createCalls,
        `retomada cega em ${code}: segunda subconta faturável e irremovível criada`,
      ).toHaveLength(0);
      expect(r.ok).toBe(false);
      expect(r.code).toBe("subaccount_needs_reconciliation");
      expect(db.rows("notificame_subaccounts")).toHaveLength(1);
      // O código original sobrevive: é a trilha de quem vai reconciliar à mão.
      const row = db.rows("notificame_subaccounts")[0];
      expect(row.status).toBe("failed");
      expect(row.last_error_code).toBe(code);
    });
  }

  it(
    "CONTROLE POSITIVO: `create_account_rejected` (recusa EXPLÍCITA do fornecedor) " +
      "retoma e cria — senão a guarda acima seria só um freio de mão",
    async () => {
      const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
      seedRow({ last_error_code: "create_account_rejected" });
      const f = makeFetch(db, [REAL_CREATE_OK], 200, [EMPTY_RESALE]);

      const r = readEnsure(await ensure(db, ensureParams(), f));

      expect(r.ok, `recusa explícita virou estado terminal: code=${r.code}`).toBe(true);
      expect(r.companyUuid).toBe(SUB_TOKEN);
      expect(f.createCalls).toHaveLength(1);
      expect(db.rows("notificame_subaccounts")).toHaveLength(1);
    },
  );

  it("claim `provisioning` MORTA e sem código de erro ainda pode criar (org não fica travada)", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    seedRow({ status: "provisioning", last_error_code: null });
    const f = makeFetch(db, [REAL_CREATE_OK], 200, [EMPTY_RESALE]);

    const r = readEnsure(await ensure(db, ensureParams(), f));

    expect(r.ok, `org travada sem saída pela UI: code=${r.code}`).toBe(true);
    expect(f.createCalls).toHaveLength(1);
  });

  it(
    "claim `provisioning` VIVA não é tomada — o POST do detentor pode estar em voo",
    async () => {
      const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
      seedRow({ status: "provisioning", last_error_code: null, updated_at: new Date().toISOString() });
      const f = makeFetch(db, [REAL_CREATE_OK], 200, [EMPTY_RESALE]);

      const r = readEnsure(await ensure(db, ensureParams(), f));

      expect(r.ok).toBe(false);
      expect(r.code).toBe("provisioning_in_progress");
      expect(f.createCalls, "atropelou o detentor da claim — duas subcontas").toHaveLength(0);
    },
  );

  it(
    "o código perigoso SOBREVIVE a uma retomada que falha na leitura da revenda " +
      "(rebaixá-lo devolveria o direito de criar)",
    async () => {
      const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
      seedRow({ last_error_code: "token_persist_failed" });
      // Revenda ilegível: texto puro do ServeMux do Go.
      const f = makeFetch(db, [REAL_CREATE_OK], 200, ["404 page not found\n"]);

      await ensure(db, ensureParams(), f);
      expect(db.rows("notificame_subaccounts")[0].last_error_code).toBe("token_persist_failed");

      // E a tentativa seguinte, mesmo com a revenda de volta ao normal, segue sem
      // direito de criar.
      const f2 = makeFetch(db, [REAL_CREATE_OK], 200, [EMPTY_RESALE]);
      const r2 = readEnsure(await ensure(db, ensureParams(), f2));
      expect(f2.createCalls).toHaveLength(0);
      expect(r2.code).toBe("subaccount_needs_reconciliation");
    },
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. ADOTAR ANTES DE CRIAR — `GET /v1/resale/` é pré-condição do POST
// ═════════════════════════════════════════════════════════════════════════════

describe("reconciliação por vendor_email antes de qualquer criação", () => {
  it("subconta JÁ existente na revenda é ADOTADA — zero POST, token = acccount_id", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    const resale = JSON.stringify([
      resaleItem("torque-outra-org@milennials.com.br", "99999999-9999-4999-8999-999999999999"),
      resaleItem(VENDOR_EMAIL, SUB_TOKEN),
    ]);
    const f = makeFetch(db, [REAL_CREATE_OK], 200, [resale]);

    const r = readEnsure(await ensure(db, ensureParams(), f));

    expect(r.ok).toBe(true);
    expect(r.companyUuid, "adotou o token da subconta ERRADA").toBe(SUB_TOKEN);
    expect(f.createCalls, "criou uma segunda subconta para uma org que já tinha uma").toHaveLength(0);
    const row = db.rows("notificame_subaccounts")[0];
    expect(row.status).toBe("ready");
    expect(row.company_uuid_ciphertext, "adoção gravou sem cifrar").toBeTruthy();
    expect(deepScan(row, SUB_TOKEN), "token adotado em texto puro na tabela").toEqual([]);
  });

  it("a ADOÇÃO conserta sozinha o `token_persist_failed` — a subconta existia mesmo", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    seedRow({ last_error_code: "token_persist_failed" });
    const f = makeFetch(db, [REAL_CREATE_OK], 200, [
      JSON.stringify([resaleItem(VENDOR_EMAIL, SUB_TOKEN)]),
    ]);

    const r = readEnsure(await ensure(db, ensureParams(), f));

    expect(r.ok, `estado terminal que a revenda resolvia: code=${r.code}`).toBe(true);
    expect(r.companyUuid).toBe(SUB_TOKEN);
    expect(f.createCalls).toHaveLength(0);
    expect(db.rows("notificame_subaccounts")[0].last_error_code).toBeNull();
  });

  it("email casa CASE-INSENSITIVE — um `T` maiúsculo não vale uma subconta a mais", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    const f = makeFetch(db, [REAL_CREATE_OK], 200, [
      JSON.stringify([resaleItem(VENDOR_EMAIL.toUpperCase(), SUB_TOKEN)]),
    ]);

    const r = readEnsure(await ensure(db, ensureParams(), f));

    expect(r.ok).toBe(true);
    expect(f.createCalls).toHaveLength(0);
  });

  it("listagem ILEGÍVEL nunca vira criação — 'não sei' não é 'não existe'", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    const f = makeFetch(db, [REAL_CREATE_OK], 200, [HUB404]);

    const r = readEnsure(await ensure(db, ensureParams(), f));

    expect(f.createCalls, "criou às cegas porque a reconciliação falhou").toHaveLength(0);
    expect(r.ok).toBe(false);
    expect(db.rows("notificame_subaccounts")[0].last_error_code).toBe("resale_unavailable");
  });

  it(
    "`resale_unavailable` é RETOMÁVEL: provado que o endpoint de criação não foi tocado",
    async () => {
      const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
      const ruim = makeFetch(db, [REAL_CREATE_OK], 200, ["404 page not found\n"]);
      await ensure(db, ensureParams(), ruim);

      const bom = makeFetch(db, [REAL_CREATE_OK], 200, [EMPTY_RESALE]);
      const r = readEnsure(await ensure(db, ensureParams(), bom));

      expect(r.ok, `revenda instável virou lápide: code=${r.code}`).toBe(true);
      expect(bom.createCalls).toHaveLength(1);
      expect(db.rows("notificame_subaccounts")).toHaveLength(1);
    },
  );

  it("DUAS subcontas com o mesmo email = dano consumado: terminal, e não uma terceira", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    const f = makeFetch(db, [REAL_CREATE_OK], 200, [
      JSON.stringify([
        resaleItem(VENDOR_EMAIL, SUB_TOKEN),
        resaleItem(VENDOR_EMAIL, "33333333-3333-4333-8333-333333333333"),
      ]),
    ]);

    const r = readEnsure(await ensure(db, ensureParams(), f));

    expect(r.ok).toBe(false);
    expect(r.code).toBe("subaccount_needs_reconciliation");
    expect(f.createCalls).toHaveLength(0);
    expect(db.rows("notificame_subaccounts")[0].last_error_code).toBe("resale_duplicated");
  });

  it("existe na revenda mas sem `acccount_id` legível: existe é existe — nunca criar", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    const f = makeFetch(db, [REAL_CREATE_OK], 200, [
      // token truncado: não tem os 36 chars do CompanyId.
      JSON.stringify([resaleItem(VENDOR_EMAIL, "22222222")]),
    ]);

    const r = readEnsure(await ensure(db, ensureParams(), f));

    expect(f.createCalls).toHaveLength(0);
    expect(r.code).toBe("subaccount_needs_reconciliation");
    expect(db.rows("notificame_subaccounts")[0].last_error_code).toBe("resale_token_unreadable");
  });

  it(
    "a retomada reconcilia pelo `vendor_email` GRAVADO, não pelo recalculado " +
      "(mudar `email_domain` não pode apagar a trilha)",
    async () => {
      const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
      const emailAntigo = `torque-${ORG}@dominio-antigo.com.br`;
      seedRow({ last_error_code: "create_account_rejected", vendor_email: emailAntigo });
      const f = makeFetch(db, [REAL_CREATE_OK], 200, [
        JSON.stringify([resaleItem(emailAntigo, SUB_TOKEN)]),
      ]);

      const r = readEnsure(await ensure(db, ensureParams(), f));

      expect(r.ok).toBe(true);
      expect(r.companyUuid).toBe(SUB_TOKEN);
      expect(f.createCalls, "recalculou o email e criou uma segunda subconta").toHaveLength(0);
    },
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. CHAVE DE CIFRA — validada por DERIVAÇÃO, não por presença
//
// Uma chave presente e malformada passava no guard antigo: o POST saía, a
// subconta nascia e a gravação do token quebrava na cifra. A cada nova tentativa,
// mais uma subconta faturável com o mesmo `vendor_email`.
// ═════════════════════════════════════════════════════════════════════════════

const CHAVES_INVALIDAS = [
  ["z".repeat(64), "64 chars que não são hex"],
  ["ab".repeat(20), "hex com 40 chars — não são 32 bytes"],
  ["a".repeat(63), "hex ímpar"],
  ["  ", "só espaço (presente, mas vazia)"],
] as const;

describe("NOTIFICAME_ENCRYPTION_KEY presente porém inutilizável", () => {
  for (const [chave, porque] of CHAVES_INVALIDAS) {
    it(`chave inválida (${porque}) não escreve nem chama o fornecedor`, async () => {
      const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
      const f = makeFetch(db, [REAL_CREATE_OK]);

      const r = readEnsure(
        await ensure(db, { ...ensureParams(), encryptionKeyHex: chave }, f),
      );

      expect(r.ok).toBe(false);
      expect(
        r.code,
        "chave inutilizável passou pelo guard: a subconta nasceria e o token não gravaria",
      ).toMatch(/^encryption_key_(missing|invalid)$/);
      expect(f.calls, "falou com o fornecedor sem ter como guardar o token").toHaveLength(0);
      expect(db.rows("notificame_subaccounts")).toHaveLength(0);
    });
  }

  it("CONTROLE POSITIVO: a mesma chamada com chave hex de 64 chars provisiona", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    const f = makeFetch(db, [REAL_CREATE_OK], 200, [EMPTY_RESALE]);
    const r = readEnsure(await ensure(db, { ...ensureParams(), encryptionKeyHex: ENC_KEY }, f));
    expect(r.ok).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. DEADLINE — a janela de stale sai do timeout, e não o contrário
//
// Com `fetch` sem deadline não existe janela de stale segura: o POST do detentor
// pode durar mais que qualquer número escolhido, e retomar a claim com ele em voo
// cria duas subcontas. O timeout é o que torna a janela dimensionável.
// ═════════════════════════════════════════════════════════════════════════════

function constOf<T>(name: string): T {
  if (!mod) {
    throw new Error(
      `AUSENTE: _shared/notificame-credentials.ts não pôde ser importado. ` +
        `Causa: ${(importError as Error)?.message ?? importError}`,
    );
  }
  const v = mod[name];
  if (v === undefined) {
    throw new Error(
      `AUSENTE: \`${name}\` não é exportada por _shared/notificame-credentials.ts. ` +
        `Sem ela a janela de stale volta a ser um número solto, sem relação com o deadline.`,
    );
  }
  return v as T;
}

/** Fetch em que a revenda responde e a CRIAÇÃO fica pendurada para sempre. */
function makeHangingCreateFetch(db: FakeDb) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const createCalls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    db.log("fetch", url);
    if (url.includes("/v1/resale")) {
      return Promise.resolve(new Response(EMPTY_RESALE, { status: 200 }));
    }
    createCalls.push({ url, init });
    return new Promise<Response>(() => {});
  };
  return Object.assign(impl, { calls, createCalls });
}

describe("deadline da criação e dimensionamento da janela de stale", () => {
  it("a janela de stale é MAIOR que a soma dos deadlines de rede", () => {
    const stale = constOf<number>("STALE_CLAIM_MS");
    const create = constOf<number>("CREATE_ACCOUNT_TIMEOUT_MS");
    const resale = constOf<number>("RESALE_LOOKUP_TIMEOUT_MS");

    expect(
      stale,
      "a claim é declarada morta antes de o fetch do detentor ser abortado — " +
        "retomada com o POST em voo cria a segunda subconta",
    ).toBeGreaterThan(create + resale);
  });

  it("o POST de criação leva um AbortSignal (timer sem signal deixa a requisição em voo)", async () => {
    const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
    const f = makeFetch(db, [REAL_CREATE_OK], 200, [EMPTY_RESALE]);
    await ensure(db, ensureParams(), f);

    const signal = f.createCalls[0]?.init?.signal;
    expect(signal, "POST /v2/accounts saiu sem signal — não há como abortá-lo").toBeTruthy();
  });

  it("fetch pendurado é ABORTADO no deadline e vira estado NÃO-retomável", async () => {
    // Capturado ANTES do fake: é o que permite ceder ao event loop de verdade
    // enquanto o relógio está congelado. Sem isso, o `advance` roda antes de o
    // POST sair, o timer do deadline nem existe ainda e o teste pendura junto.
    const realSetTimeout = globalThis.setTimeout;
    const cedeAoLoop = () => new Promise((r) => realSetTimeout(r, 0));

    vi.useFakeTimers();
    try {
      const ensure = fnOf<EnsureFn>("ensureNotificameSubaccount");
      const timeout = constOf<number>("CREATE_ACCOUNT_TIMEOUT_MS");
      const f = makeHangingCreateFetch(db);

      const pendente = ensure(db, ensureParams(), f);
      for (let i = 0; i < 100 && f.createCalls.length === 0; i++) await cedeAoLoop();
      expect(f.createCalls, "o POST nem chegou a sair — o teste não prova nada").toHaveLength(1);

      await vi.advanceTimersByTimeAsync(timeout + 1_000);
      const r = readEnsure(await pendente);

      expect(r.ok).toBe(false);
      expect(f.createCalls[0]?.init?.signal?.aborted, "a requisição seguiu em voo").toBe(true);
      const row = db.rows("notificame_subaccounts")[0];
      expect(row.status).toBe("failed");
      // Terminal: a requisição SAIU, então a subconta pode ter nascido.
      expect(row.last_error_code).toBe("create_account_timeout");
    } finally {
      vi.useRealTimers();
    }
  });
});
