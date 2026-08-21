/**
 * Fatia "lead vinculado a identidade de Instagram" — O VETOR.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ESTE ARQUIVO MEDE UMA AUSÊNCIA, E A AUSÊNCIA É O PRODUTO.                ║
 * ║                                                                          ║
 * ║  O fornecedor CONFIRMOU POR ESCRITO que não assina o corpo do webhook.    ║
 * ║  Logo, o endpoint tem autenticidade de ORIGEM (secret no path + uuid da   ║
 * ║  subconta + allowlist de IP) e NENHUMA autenticidade de CONTEÚDO: quem    ║
 * ║  descobrir os dois identificadores POSTA mensagem forjada numa org.       ║
 * ║                                                                          ║
 * ║  A fatia do vínculo acrescenta ao produto um caminho que CRIA LEAD. Se    ║
 * ║  esse caminho encostasse no webhook, o custo de inflar a base de uma org  ║
 * ║  cairia para "uma requisição por lead" — e o dano não seria só volume:    ║
 * ║  lead criado dispara trg_auto_assign_lead_default_pipe, entra em funil,   ║
 * ║  aciona gatilho `lead_created` de workflow e conta em toda métrica de     ║
 * ║  entrada. Uma varredura viraria um funil inteiro de leads inventados.     ║
 * ║                                                                          ║
 * ║  Por isso o desenho aprovado é: QUEM CRIA É HUMANO AUTENTICADO NO CHAT,   ║
 * ║  via RPC SECURITY DEFINER; o webhook ganha, no máximo, um RESOLVE DE      ║
 * ║  LEITURA. Este arquivo é a trava dessa decisão — em COMPORTAMENTO (o      ║
 * ║  handler real, exercido ponta a ponta) e em ESTRUTURA (o endpoint não     ║
 * ║  tem sequer de onde tirar um lead).                                       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── POR QUE O DUBLÊ REGISTRA OPERAÇÃO, E NÃO SÓ TABELA ─────────────────────
 *
 * `notificame-webhook-inbound.test.ts` assere `new Set(db.touched)` — conjunto
 * FECHADO por TABELA. Ela ficou VERMELHA no minuto em que o resolve de leitura
 * entrou (uma quarta tabela CONSULTADA), um falso alarme sobre mudança aprovada:
 * conjunto por tabela não sabe distinguir LER de ESCREVER. Aqui o dublê registra
 * `{tabela, operação}`, então a asserção é a que sobrevive à fatia inteira:
 *
 *     NENHUMA operação de ESCRITA em `leads`, `pipeline_entries`, `pipe_*`,
 *     `lead_history` ou `lead_social_identities`, jamais — e leitura é livre.
 *
 * É a diferença entre "o webhook não mudou" e "o webhook não CRIA". O invariante
 * é o segundo.
 *
 * Sem rede. Deno é polyfillado e `withErrorBoundary` vira identidade, como no
 * arquivo irmão, para que o handler entregue a `Deno.serve` seja capturado.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ─── Ambiente ────────────────────────────────────────────────────────────────

const SECRET = "s3cr3t-do-notificame-que-ninguem-inspeciona";

const env: Record<string, string> = {
  SUPABASE_URL: "https://local.supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  NOTIFICAME_WEBHOOK_SECRET: SECRET,
  NOTIFICAME_WEBHOOK_IPS: "unrestricted",
};

let handler: ((req: Request) => Promise<Response>) | null = null;

vi.stubGlobal("Deno", {
  env: { get: (k: string) => env[k] ?? undefined, toObject: () => ({ ...env }) },
  serve: (h: (req: Request) => Promise<Response>) => {
    handler = h;
  },
});

vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_name: string, fn: unknown) => fn,
}));

vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn(async () => {}),
  redactSecrets: (v: unknown) => v,
}));

vi.mock("../../supabase/functions/_shared/security-headers.ts", () => ({
  withSecurityHeaders: (h: Record<string, string>) => h,
}));

vi.mock("../../supabase/functions/_shared/auth.ts", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    checkRateLimit: () => ({ allowed: true }),
    checkRateLimitPersistent: async () => ({ allowed: true }),
  };
});

let db: ReturnType<typeof makeDb>;
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => ({ from: (table: string) => db.from(table) }),
}));

await import("../../supabase/functions/notificame-webhook/index.ts");

if (!handler) throw new Error("o módulo não registrou handler em Deno.serve");
const invoke = handler as (req: Request) => Promise<Response>;

// ─── Dublê de banco: uma LOJA, com a chave única de verdade e um DIÁRIO ──────

type Row = Record<string, unknown>;
type Op = "select" | "insert" | "upsert" | "update" | "delete";

/** Colunas do `onConflict` desta rota — a UNIQUE que absorve reentrega. */
const CONFLICT_COLS = ["external_id", "channel", "organization_id"] as const;

/**
 * Loja em memória + diário de `{tabela, operação}`.
 *
 * A operação é registrada no MOMENTO EM QUE A QUERY RODA (não no `from`), porque
 * é aí que ela já se declarou leitura ou escrita. Um `from('leads').select()` que
 * ninguém aguarda não conta como nada — e é isso que se quer: o diário mede o que
 * o banco de verdade veria.
 */
function makeDb(seed: Record<string, Row[]> = {}, opts: { failSelectOn?: string } = {}) {
  const store: Record<string, Row[]> = {
    notificame_subaccounts: [],
    messaging_channels: [],
    channel_messages: [],
    notificame_webhook_events: [],
    leads: [],
    lead_social_identities: [],
    lead_history: [],
    pipeline_entries: [],
    ...structuredClone(seed),
  };
  const ops: Array<{ table: string; op: Op }> = [];
  let seq = 0;

  function from(table: string) {
    const eqs: Array<[string, unknown]> = [];
    const iss: Array<[string, unknown]> = [];
    let op: Op = "select";
    let payload: Row | null = null;
    let single = false;
    let cap = Infinity;

    const rows = () => {
      let out = [...(store[table] ?? [])];
      for (const [c, v] of eqs) out = out.filter((r) => r[c] === v);
      for (const [c, v] of iss) out = out.filter((r) => (r[c] ?? null) === v);
      return out;
    };

    const run = (): { data: unknown; error: { message: string } | null } => {
      ops.push({ table, op });
      if (op === "insert") {
        (store[table] ??= []).push({ id: `${table}-${++seq}`, ...(payload as Row) });
        return { data: null, error: null };
      }
      if (op === "upsert") {
        const p = payload as Row;
        const clash = (store[table] ?? []).find((r) =>
          CONFLICT_COLS.every((c) => r[c] === p[c]),
        );
        // ON CONFLICT DO NOTHING ... RETURNING devolve ZERO linhas na colisão.
        if (clash) return { data: [], error: null };
        const fresh = { id: `${table}-${++seq}`, ...p };
        (store[table] ??= []).push(fresh);
        return { data: [{ id: fresh.id }], error: null };
      }
      if (op === "update") {
        for (const r of rows()) Object.assign(r, payload);
        return { data: null, error: null };
      }
      if (op === "delete") {
        const doomed = new Set(rows());
        store[table] = (store[table] ?? []).filter((r) => !doomed.has(r));
        return { data: null, error: null };
      }
      if (opts.failSelectOn === table) {
        // Erro de LEITURA injetado: RLS, timeout, coluna renomeada. O resolve é
        // best-effort e não pode derrubar a mensagem.
        return { data: null, error: { message: `select em ${table} falhou (injetado)` } };
      }
      const out = rows().slice(0, cap);
      return { data: single ? (out[0] ?? null) : out, error: null };
    };

    const api = {
      select: () => api,
      eq(c: string, v: unknown) {
        eqs.push([c, v]);
        return api;
      },
      is(c: string, v: unknown) {
        iss.push([c, v]);
        return api;
      },
      limit(n: number) {
        cap = n;
        return api;
      },
      maybeSingle() {
        single = true;
        return api;
      },
      insert(row: Row) {
        op = "insert";
        payload = row;
        return api;
      },
      upsert(row: Row, _o?: Record<string, unknown>) {
        op = "upsert";
        payload = row;
        return api;
      },
      update(patch: Row) {
        op = "update";
        payload = patch;
        return api;
      },
      delete() {
        op = "delete";
        return api;
      },
      then<T>(res: (v: { data: unknown; error: unknown }) => T) {
        return Promise.resolve(run()).then(res);
      },
    };
    return api;
  }

  const writes = () => ops.filter((o) => o.op !== "select");

  return { from, store, ops, writes };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const SUB_A = "11111111-1111-4111-8111-111111111111";
const CH_A = "cccccccc-1111-4111-8111-111111111111";
const LEAD_EXISTENTE = "eeeeeeee-1111-4111-8111-111111111111";
const IGSID = "igsid-cliente-777";

const BASE_SEED = () => ({
  notificame_subaccounts: [{ id: SUB_A, organization_id: ORG_A }],
  messaging_channels: [
    {
      id: CH_A,
      organization_id: ORG_A,
      provider: "notificame",
      channel_type: "instagram",
      external_channel_id: "ch_ig_org_a",
      status: "connected",
      handle: null,
    },
  ],
});

const happyBody = (over: Record<string, unknown> = {}) => ({
  eventType: "MESSAGE",
  direction: "IN",
  channelId: "ch_ig_org_a",
  id: "mid-fornecedor-001",
  from: { id: IGSID, name: "Fulana", username: "@fulana" },
  contents: [{ type: "text", text: "oi, tem em estoque?" }],
  timestamp: "2026-08-13T18:04:00.000Z",
  ...over,
});

function post(body: unknown, o: { secret?: string; sub?: string } = {}) {
  const secret = o.secret ?? SECRET;
  return new Request(
    `https://local.supabase.test/notificame-webhook/${encodeURIComponent(secret)}/${encodeURIComponent(o.sub ?? SUB_A)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
      body: JSON.stringify(body),
    },
  );
}

/**
 * As tabelas que só um humano autenticado pode escrever nesta fatia. Escrever em
 * QUALQUER uma delas a partir de um corpo não-assinado é o vetor.
 */
const TABELAS_DE_LEAD = [
  "leads",
  "lead_social_identities",
  "lead_history",
  "pipeline_entries",
  "pipe_whatsapp",
  "pipe_confirmacao",
  "pipe_propostas",
  "custom_pipe_entries",
  "lead_tags",
];

beforeEach(() => {
  vi.clearAllMocks();
  env.NOTIFICAME_WEBHOOK_IPS = "unrestricted";
  db = makeDb(BASE_SEED());
});

// ─── 0. CONTROLE POSITIVO ────────────────────────────────────────────────────

describe("0. CONTROLE POSITIVO — o corpo entra, senão todo o resto é vácuo", () => {
  it("uma mensagem válida vira linha de channel_messages e responde 200", async () => {
    const res = await invoke(post(happyBody()));

    expect(res.status).toBe(200);
    expect(db.store.channel_messages).toHaveLength(1);
    expect(db.store.channel_messages[0].contact_external_id).toBe(IGSID);
    // Sem este caso, "0 leads criados" seria satisfeito por um handler que
    // rejeitasse tudo — verde por ausência, a falha que mais se disfarça aqui.
    expect(db.writes().some((w) => w.table === "channel_messages")).toBe(true);
  });
});

// ─── 1. O VETOR: nenhum lead nasce de um corpo não-assinado ──────────────────

describe("1. o inbound NÃO cria lead", () => {
  it("mensagem de um IGSID desconhecido: a mensagem entra, o lead NÃO nasce", async () => {
    await invoke(post(happyBody()));

    expect(db.store.channel_messages).toHaveLength(1);
    // O desfecho certo é conversa órfã no inbox, esperando um humano. Órfã é
    // recuperável; base inflada não é — ninguém audita 40.485 leads para achar
    // os inventados.
    expect(db.store.leads).toEqual([]);
    expect(db.store.lead_social_identities).toEqual([]);
  });

  it("nenhuma ESCRITA em tabela de lead — a asserção que sobrevive ao resolve", async () => {
    await invoke(post(happyBody()));

    const escritasProibidas = db.writes().filter((w) => TABELAS_DE_LEAD.includes(w.table));
    // Mensagem de erro útil: quem quebrar isto vê O QUE escreveu e ONDE.
    expect(escritasProibidas).toEqual([]);
  });

  it("300 requisições forjadas, 300 IGSIDs distintos ⇒ 300 mensagens e ZERO leads", async () => {
    // Este caso quantifica o vetor. Se um dia o inbound criar lead, o custo de
    // inflar a base de uma org vira exatamente isto: um `for`.
    for (let i = 0; i < 300; i++) {
      await invoke(
        post(
          happyBody({
            id: `mid-forjado-${i}`,
            from: { id: `igsid-inventado-${i}`, name: `Vítima ${i}`, username: `@v${i}` },
          }),
        ),
      );
    }

    expect(db.store.channel_messages).toHaveLength(300);
    expect(db.store.leads).toHaveLength(0);
    expect(db.writes().filter((w) => TABELAS_DE_LEAD.includes(w.table))).toEqual([]);
  });

  it("`lead_id` da linha nasce NULL quando não há identidade vinculada", async () => {
    await invoke(post(happyBody()));
    // ?? null: tolerante ao parâmetro `leadId` que a fatia acrescenta ao builder.
    // O que se cobra é "sem identidade, sem vínculo", não a forma do argumento.
    expect(db.store.channel_messages[0].lead_id ?? null).toBeNull();
  });
});

// ─── 2. o resolve que a fatia acrescenta só pode LER ─────────────────────────

describe("2. com identidade JÁ vinculada, o webhook resolve — e nada mais", () => {
  beforeEach(() => {
    db = makeDb({
      ...BASE_SEED(),
      leads: [{ id: LEAD_EXISTENTE, organization_id: ORG_A, name: "Fulana", phone: null }],
      lead_social_identities: [
        {
          id: "identidade-1",
          organization_id: ORG_A,
          lead_id: LEAD_EXISTENTE,
          channel_type: "instagram",
          external_user_id: IGSID,
          messaging_channel_id: CH_A,
        },
      ],
    });
  });

  it("a identidade existente NÃO é reescrita, movida nem duplicada pelo inbound", async () => {
    await invoke(post(happyBody()));

    // Uma linha, apontando para o mesmo lead. Um corpo forjado não pode
    // REAPONTAR a identidade de uma pessoa para outro lead — seria sequestro de
    // conversa dentro da org, com o histórico junto.
    expect(db.store.lead_social_identities).toHaveLength(1);
    expect(db.store.lead_social_identities[0].lead_id).toBe(LEAD_EXISTENTE);
    expect(db.writes().filter((w) => w.table === "lead_social_identities")).toEqual([]);
  });

  it("o lead existente não é tocado: nem UPDATE, nem lead_history, nem funil", async () => {
    await invoke(post(happyBody()));

    expect(db.store.leads).toHaveLength(1);
    expect(db.store.lead_history).toEqual([]);
    expect(db.store.pipeline_entries).toEqual([]);
    expect(db.writes().filter((w) => TABELAS_DE_LEAD.includes(w.table))).toEqual([]);
  });

  it("ler `lead_social_identities` é permitido; escrever nela, nunca", async () => {
    await invoke(post(happyBody()));
    // Contrato do resolve: SELECT à vontade (best-effort, falha vira null),
    // INSERT jamais. A leitura ACONTECE hoje — e é só a escrita que é proibida.
    expect(db.ops.some((o) => o.table === "lead_social_identities" && o.op === "select")).toBe(true);
    expect(db.writes().filter((w) => w.table === "lead_social_identities")).toEqual([]);
  });

  it("a mensagem NOVA já nasce vinculada — o FUTURO do cache", async () => {
    // Sem isto, o vínculo cobriria só o passado da thread (o backfill da RPC) e a
    // primeira mensagem depois do clique nasceria órfã.
    await invoke(post(happyBody()));
    expect(db.store.channel_messages[0].lead_id).toBe(LEAD_EXISTENTE);
  });

  it("identidade de OUTRA org com o MESMO IGSID não vaza para esta", async () => {
    // O IGSID é a mesma PESSOA em toda org — é o caso normal do B2B. O recorte
    // por `organization_id` é o que impede a org A de descobrir, pelo lead_id
    // preenchido, que a org B já conhece aquela pessoa.
    db = makeDb({
      ...BASE_SEED(),
      leads: [{ id: "lead-da-org-b", organization_id: "org-b", name: "Fulana" }],
      lead_social_identities: [
        {
          id: "identidade-org-b",
          organization_id: "org-b",
          lead_id: "lead-da-org-b",
          channel_type: "instagram",
          external_user_id: IGSID,
        },
      ],
    });

    await invoke(post(happyBody()));
    expect(db.store.channel_messages[0].lead_id ?? null).toBeNull();
  });

  it("resolve que FALHA não derruba a mensagem — best-effort de verdade", async () => {
    // RLS, timeout, coluna renomeada, tabela ainda não aplicada. O inbound é o
    // caminho que não pode cair: perder o evento seria perder a conversa; perder o
    // vínculo é degradação recuperável (o próximo clique humano backfilla).
    db = makeDb(
      {
        ...BASE_SEED(),
        leads: [{ id: LEAD_EXISTENTE, organization_id: ORG_A, name: "Fulana" }],
        lead_social_identities: [
          {
            id: "identidade-1",
            organization_id: ORG_A,
            lead_id: LEAD_EXISTENTE,
            channel_type: "instagram",
            external_user_id: IGSID,
          },
        ],
      },
      { failSelectOn: "lead_social_identities" },
    );

    const res = await invoke(post(happyBody()));

    expect(res.status).toBe(200);
    expect(db.store.channel_messages).toHaveLength(1);
    expect(db.store.channel_messages[0].lead_id ?? null).toBeNull();
  });
});

// ─── 3. ESTRUTURAL — o endpoint não tem de onde tirar um lead ────────────────

const FN_DIR = path.resolve(__dirname, "../../supabase/functions");
const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const WEBHOOK_SRC = semComentarios(readFileSync(path.join(FN_DIR, "notificame-webhook/index.ts"), "utf8"));
const INBOUND_SRC = semComentarios(readFileSync(path.join(FN_DIR, "_shared/notificame-inbound.ts"), "utf8"));

describe("3. estrutural — nenhum caminho de criação existe no código do ingress", () => {
  it.each([
    ["notificame-webhook/index.ts", WEBHOOK_SRC],
    ["_shared/notificame-inbound.ts", INBOUND_SRC],
  ])("%s não CRIA lead — só a leitura resolve-only é permitida", (_nome, src) => {
    // O criador canônico tem o guard `if (!phone && !email) return null`, que
    // protege 8 call sites — inclusive o caminho quente de `agent-message`.
    // Chamá-lo daqui exigiria afrouxar aquele guard, e afrouxá-lo derrubaria a
    // barreira estrutural dos outros sete.
    expect(src).not.toMatch(/getOrCreateLead/);

    // ⚠️ A PROIBIÇÃO ERA DE IMPORTAR O MÓDULO INTEIRO, e isso era mais largo que
    // a intenção: o que não pode acontecer aqui é CRIAR lead. Ler para resolver
    // um vínculo que já existe é o oposto disso — foi o que o #1686 precisou
    // para disparar o gatilho de "lead respondeu", que exige o id do lead.
    //
    // A guarda passou a nomear o que é permitido, em vez de proibir o pacote:
    // qualquer OUTRO símbolo de `lead-service` continua barrado, e um import
    // novo cai aqui em vermelho — que é o efeito que a regra original queria.
    const importsDeLeadService = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*lead-service/g)];
    for (const m of importsDeLeadService) {
      const simbolos = m[1].split(",").map((x) => x.trim()).filter(Boolean);
      expect(simbolos, "só a leitura resolve-only é permitida no ingress")
        .toEqual(["findLeadByPhoneOrEmail"]);
    }
  });

  it.each([
    ["notificame-webhook/index.ts", WEBHOOK_SRC],
    ["_shared/notificame-inbound.ts", INBOUND_SRC],
  ])("%s não escreve em nenhuma tabela de lead", (_nome, src) => {
    for (const tabela of TABELAS_DE_LEAD) {
      // `.from("leads")` seguido, em qualquer ponto do encadeamento, de uma
      // operação de escrita.
      const escrita = new RegExp(
        `from\\(\\s*["'\`]${tabela}["'\`]\\s*\\)[\\s\\S]{0,400}?\\.(insert|upsert|update|delete)\\s*\\(`,
      );
      expect({ tabela, escreve: escrita.test(src) }).toEqual({ tabela, escreve: false });
    }
  });

  it("o webhook não invoca as RPCs de criação/vínculo desta fatia", () => {
    // As três RPCs são SECURITY DEFINER e gateiam pelo `auth.uid()` de quem
    // chama. O webhook roda como service_role: chamá-las de lá passaria por cima
    // dos quatro gates de uma vez, que é o mesmo que não ter gate.
    expect(WEBHOOK_SRC).not.toMatch(/create_lead_from_social_conversation/);
    expect(WEBHOOK_SRC).not.toMatch(/link_social_conversation_to_lead/);
    expect(WEBHOOK_SRC).not.toMatch(/unlink_social_conversation_from_lead/);
  });

  it("CONTROLE POSITIVO: a mesma varredura ENCONTRA o criador em lead-webhook", () => {
    // Sem este caso, os três acima passariam com regex quebrada — a forma de
    // verde por ausência que este repo já pagou para aprender.
    const leadWebhook = semComentarios(readFileSync(path.join(FN_DIR, "lead-webhook/index.ts"), "utf8"));
    expect(leadWebhook).toMatch(/getOrCreateLead/);
    expect(leadWebhook).toMatch(/lead-service/);
  });
});
