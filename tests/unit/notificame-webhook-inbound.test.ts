/**
 * Fatia 2-IG — o INGRESS de eventos do NotificaMe (`notificame-webhook`).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  O QUE ESTE ARQUIVO MEDE É "NADA SE PERDE", NÃO "O FORMATO ESTÁ CERTO".   ║
 * ║                                                                          ║
 * ║  NENHUM EVENTO REAL FOI OBSERVADO. Nenhum canal foi conectado; as 10.982  ║
 * ║  linhas de `channel_messages` são 100% `channel='whatsapp'`. Todo alias   ║
 * ║  de `_shared/notificame-inbound.ts` é DERIVADO DE DOC — e a doc do        ║
 * ║  fornecedor já se provou errada uma vez (dois hosts, duas versões).       ║
 * ║                                                                          ║
 * ║  Um teste que fixasse O FORMATO seria, portanto, um teste que fixa um     ║
 * ║  chute: ele ficaria VERDE no dia em que o formato real chegasse diferente ║
 * ║  e nada entrasse no inbox. O que dá para asserir hoje — e é o que este    ║
 * ║  arquivo asserre — é o COMPORTAMENTO DIANTE DO DESCONHECIDO:              ║
 * ║                                                                          ║
 * ║    corpo que não entendemos  ⇒ GUARDADO INTEIRO, nunca descartado;        ║
 * ║    sem id do fornecedor      ⇒ a linha NÃO NASCE (jamais um id sintético);║
 * ║    reentrega                 ⇒ absorvida, uma linha só;                   ║
 * ║    origem forjada            ⇒ 404/403, e o banco nem é aberto;           ║
 * ║    canal de outra org        ⇒ zero escrita, evidência parkada.           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── OS CINCO CASOS PEDIDOS, E ONDE ESTÃO ───────────────────────────────────
 *
 *   1. ORIGEM FORJADA ................ describe "1. origem forjada"
 *   2. SEM O CAMPO DE CANAL .......... describe "2. corpo sem o campo de canal"
 *   3. REENTREGA (duplicado) ......... describe "3. reentrega"
 *   4. FORMATO INESPERADO ............ describe "4. corpo que não bate com o formato"
 *   5. ISOLAMENTO ENTRE ORGS ......... describe "5. isolamento entre organizações"
 *
 * ─── POR QUE O DUBLÊ DE BANCO É UMA LOJA DE VERDADE ─────────────────────────
 *
 * O `upsert` deste caminho é a ÚNICA guarda de idempotência da rota, e ela é uma
 * propriedade do ÍNDICE, não da linha: `(external_id, channel, organization_id)`.
 * Um dublê que devolvesse `{data:[{id}]}` para todo upsert deixaria o caso 3
 * passar sem existir. Por isso o dublê aqui MANTÉM as linhas e aplica a chave
 * única de verdade — reentrega devolve ZERO linhas, como o Postgres devolve sob
 * `ON CONFLICT DO NOTHING ... RETURNING`.
 *
 * Sem rede. Deno é polyfillado; `withErrorBoundary` vira identidade para que o
 * handler passado a `Deno.serve` possa ser capturado e chamado direto.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ─── Ambiente ────────────────────────────────────────────────────────────────

const SECRET = "s3cr3t-do-notificame-que-ninguem-inspeciona";

/**
 * ⚠️ `NOTIFICAME_WEBHOOK_IPS` é lido A CADA REQUISIÇÃO (`Deno.env.get` dentro do
 * handler), enquanto SUPABASE_URL / SERVICE_ROLE_KEY / SECRET são lidos UMA VEZ,
 * no topo do módulo. Só o primeiro pode mudar entre casos — e é justamente o que
 * o teste de fail-closed precisa mexer.
 */
const env: Record<string, string> = {
  SUPABASE_URL: "https://local.supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  NOTIFICAME_WEBHOOK_SECRET: SECRET,
  NOTIFICAME_WEBHOOK_IPS: "unrestricted",
};

/** O handler que o módulo entrega a `Deno.serve`. Capturado no import. */
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

const logRuntime = vi.fn(async () => {});
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime,
  redactSecrets: (v: unknown) => v,
}));

vi.mock("../../supabase/functions/_shared/security-headers.ts", () => ({
  withSecurityHeaders: (h: Record<string, string>) => h,
}));

/**
 * `timingSafeCompare` é o REAL (importOriginal): é ele que decide 404 vs. seguir,
 * e trocá-lo por `===` deixaria de exercer o caminho de comprimento diferente.
 * Só os dois limitadores de taxa viram constantes — o persistente faria RPC.
 */
vi.mock("../../supabase/functions/_shared/auth.ts", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    checkRateLimit: () => ({ allowed: true }),
    checkRateLimitPersistent: async () => ({ allowed: true }),
  };
});

/** O client que `createClient` devolve delega para a loja do caso corrente. */
let db: ReturnType<typeof makeDb>;
const createClient = vi.fn(() => ({
  from: (table: string) => db.from(table),
}));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: (...args: unknown[]) => createClient(...(args as [])),
}));

await import("../../supabase/functions/notificame-webhook/index.ts");

if (!handler) throw new Error("o módulo não registrou handler em Deno.serve");
const invoke = handler as (req: Request) => Promise<Response>;

// ─── Dublê de banco: uma LOJA, com a chave única de verdade ──────────────────

type Row = Record<string, unknown>;

/** As colunas do `onConflict` desta rota. Fixadas aqui de propósito: se alguém
 *  mudar o `onConflict` do handler sem mudar aqui, o caso 3 fica vermelho. */
const CONFLICT_COLS = ["external_id", "channel", "organization_id"] as const;

function makeDb(seed: Record<string, Row[]>, opts: { failInsertOn?: string } = {}) {
  const store: Record<string, Row[]> = {
    notificame_subaccounts: [],
    messaging_channels: [],
    channel_messages: [],
    notificame_webhook_events: [],
    ...structuredClone(seed),
  };
  const touched: string[] = [];
  const upsertOpts: Array<Record<string, unknown>> = [];
  let seq = 0;

  function from(table: string) {
    touched.push(table);
    const eqs: Array<[string, unknown]> = [];
    const iss: Array<[string, unknown]> = [];
    let op: "select" | "insert" | "upsert" | "update" = "select";
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
      if (op === "insert") {
        if (opts.failInsertOn === table) {
          return { data: null, error: { message: `insert em ${table} falhou (injetado)` } };
        }
        (store[table] ??= []).push({ id: `${table}-${++seq}`, ...(payload as Row) });
        return { data: null, error: null };
      }
      if (op === "upsert") {
        const p = payload as Row;
        const clash = (store[table] ?? []).find((r) =>
          CONFLICT_COLS.every((c) => r[c] === p[c])
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
      upsert(row: Row, o: Record<string, unknown>) {
        op = "upsert";
        payload = row;
        upsertOpts.push(o);
        return api;
      },
      update(patch: Row) {
        op = "update";
        payload = patch;
        return api;
      },
      then<T>(res: (v: { data: unknown; error: unknown }) => T) {
        return Promise.resolve(run()).then(res);
      },
    };
    return api;
  }

  return { from, store, touched, upsertOpts };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const SUB_A = "11111111-1111-4111-8111-111111111111";
const SUB_B = "22222222-2222-4222-8222-222222222222";
const CH_A = "cccccccc-1111-4111-8111-111111111111";
const CH_B = "dddddddd-2222-4222-8222-222222222222";

const BASE_SEED = () => ({
  notificame_subaccounts: [
    { id: SUB_A, organization_id: ORG_A },
    { id: SUB_B, organization_id: ORG_B },
  ],
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
    {
      id: CH_B,
      organization_id: ORG_B,
      provider: "notificame",
      channel_type: "instagram",
      external_channel_id: "ch_ig_org_b",
      status: "connected",
      handle: null,
    },
  ],
});

/** Um corpo NO FORMATO QUE A DOC SUGERE. Não é verdade observada — é a hipótese
 *  corrente, e existe para dar CONTROLE POSITIVO aos casos negativos. */
const happyBody = (over: Record<string, unknown> = {}) => ({
  eventType: "MESSAGE",
  direction: "IN",
  channelId: "ch_ig_org_a",
  id: "mid-fornecedor-001",
  from: { id: "igsid-cliente-777", name: "Fulana", username: "@fulana" },
  contents: [{ type: "text", text: "oi, tem em estoque?" }],
  timestamp: "2026-08-13T18:04:00.000Z",
  ...over,
});

function post(
  body: unknown,
  o: { secret?: string; sub?: string | null; ip?: string; raw?: string } = {},
) {
  const secret = o.secret ?? SECRET;
  const sub = o.sub === null ? "" : `/${encodeURIComponent(o.sub ?? SUB_A)}`;
  return new Request(
    `https://local.supabase.test/notificame-webhook/${encodeURIComponent(secret)}${sub}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": o.ip ?? "203.0.113.10",
      },
      body: o.raw ?? JSON.stringify(body),
    },
  );
}

const parked = () => db.store.notificame_webhook_events;
const messages = () => db.store.channel_messages;

beforeEach(() => {
  vi.clearAllMocks();
  env.NOTIFICAME_WEBHOOK_IPS = "unrestricted";
  db = makeDb(BASE_SEED());
});

// ─── 0. controle positivo ────────────────────────────────────────────────────
//
// Sem ele, TODOS os casos negativos abaixo passariam num handler que devolvesse
// 404 para tudo. "Verde por ausência" é a falha que mais se disfarça neste repo.

describe("0. CONTROLE POSITIVO — o caminho feliz escreve, e escreve o que se espera", () => {
  it("grava uma linha de channel_messages e responde 200 stored", async () => {
    const res = await invoke(post(happyBody()));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "stored" });
    expect(parked()).toHaveLength(0);
    expect(messages()).toHaveLength(1);

    const row = messages()[0];
    expect(row.organization_id).toBe(ORG_A);
    expect(row.messaging_channel_id).toBe(CH_A);
    expect(row.channel).toBe("instagram");
    // `incoming`, NUNCA `inbound`: o CHECK channel_messages_direction_check aceita
    // exatamente ('incoming','outgoing'), e `inbound` é o literal morto que deixou
    // useIncomingMessageToast sem efeito.
    expect(row.direction).toBe("incoming");
    expect(row.external_id).toBe("mid-fornecedor-001");
    expect(row.contact_external_id).toBe("igsid-cliente-777");
    expect(row.status).toBe("received");
    // O corpo CRU INTEGRAL. É ele que ensina o formato quando a doc estiver errada.
    expect(row.raw_payload).toEqual(happyBody());
  });

  it("phone_number e remote_jid ficam NULL — nunca string vazia", async () => {
    await invoke(post(happyBody()));
    const row = messages()[0];

    // ⚠️ `''` seria pior que NULL: `normalizePhone('')` devolve `''`, e `''` casa
    // com `''` — TODOS os contatos de Instagram da org colapsariam num contato só.
    // E dois caminhos EXECUTAM esse campo (formatPhoneForWhatsApp,
    // LeadContactModal), o que viraria tentativa de discar para um @usuário.
    expect(row.phone_number).toBeNull();
    expect(row.remote_jid).toBeNull();
    expect(row.instance_id).toBeNull();
    expect(row.page_id).toBeNull();
    // Fatia inbound-only: nenhum lead nasce daqui (leads não tem coluna de
    // identidade social; um lead sem telefone é invisível para dispatch e funil).
    expect(row.lead_id).toBeNull();
  });

  it("o upsert usa a UNIQUE como guarda — onConflict + ignoreDuplicates", async () => {
    await invoke(post(happyBody()));
    // Contrato explícito: é a UNIQUE (external_id, channel, organization_id) que
    // absorve reentrega. Trocar por SELECT-antes-de-INSERT (o que meta-webhook faz
    // em L274) perde a corrida entre duas entregas simultâneas.
    expect(db.upsertOpts[0]).toEqual({
      onConflict: "external_id,channel,organization_id",
      ignoreDuplicates: true,
    });
  });

  it("INERTE por decisão: nenhum gatilho de automação é acordado", async () => {
    await invoke(post(happyBody()));
    // Sem assinatura do fornecedor não há autenticidade de CONTEÚDO: quem tiver
    // secret+uuid injeta uma mensagem falsa naquela org. Se esta rota acordasse
    // Copilot/workflow, um corpo forjado faria um agente IA RESPONDER.
    // Só quatro tabelas podem ser tocadas neste caminho.
    expect(new Set(db.touched)).toEqual(
      new Set(["notificame_subaccounts", "messaging_channels", "channel_messages"]),
    );
  });
});

// ─── 1. ORIGEM FORJADA ───────────────────────────────────────────────────────

describe("1. origem forjada — secret, IP e método", () => {
  it("secret errado ⇒ 404, e o banco NEM É ABERTO", async () => {
    const res = await invoke(post(happyBody(), { secret: "chute-do-atacante" }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    // 404 e não 401: 401 confirmaria que a rota existe e que só falta credencial.
    // A asserção que importa é a segunda — sem createClient, uma varredura não
    // consegue nem gerar linha de parking, que seria escrita amplificada de graça.
    expect(createClient).not.toHaveBeenCalled();
    expect(parked()).toHaveLength(0);
    expect(messages()).toHaveLength(0);
  });

  it("secret de COMPRIMENTO diferente ⇒ 404 (timingSafeCompare, não ===)", async () => {
    const res = await invoke(post(happyBody(), { secret: SECRET.slice(0, 8) }));
    expect(res.status).toBe(404);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("secret certo com sufixo ⇒ 404 (nada de comparação por prefixo)", async () => {
    const res = await invoke(post(happyBody(), { secret: `${SECRET}x` }));
    expect(res.status).toBe(404);
  });

  it("o secret NÃO vai inteiro para o log — só o prefixo", async () => {
    await invoke(post(happyBody(), { secret: "chute-do-atacante-completo" }));

    const call = logRuntime.mock.calls.find(
      (c) => (c[0] as { action?: string })?.action === "notificame_auth_fail",
    );
    expect(call).toBeDefined();
    const snap = (call![0] as { payloadSnapshot: Record<string, unknown> }).payloadSnapshot;
    expect(snap.path_secret_prefix).toBe("chute-do");
    // runtime_logs é lido por humanos; o valor inteiro ali É o secret.
    expect(JSON.stringify(snap)).not.toContain("chute-do-atacante-completo");
  });

  it("IP fora da allowlist ⇒ 403, sem escrita nenhuma", async () => {
    env.NOTIFICAME_WEBHOOK_IPS = "198.51.100.0/24, 203.0.113.7";
    const res = await invoke(post(happyBody(), { ip: "203.0.113.10" }));

    expect(res.status).toBe(403);
    expect(parked()).toHaveLength(0);
    expect(messages()).toHaveLength(0);
  });

  it("IP DENTRO da faixa CIDR passa — a allowlist não é só igualdade literal", async () => {
    env.NOTIFICAME_WEBHOOK_IPS = "198.51.100.0/24";
    const res = await invoke(post(happyBody(), { ip: "198.51.100.42" }));
    expect(res.status).toBe(200);
    expect(messages()).toHaveLength(1);
  });

  it("allowlist AUSENTE ⇒ 503 fail-closed: esquecer de configurar NÃO abre a porta", async () => {
    delete env.NOTIFICAME_WEBHOOK_IPS;
    const res = await invoke(post(happyBody()));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ip_allowlist_unset" });
    // 503 e não 500: é configuração faltando, e o fornecedor deve REENTREGAR
    // depois que ela existir. Nada foi perdido.
    expect(messages()).toHaveLength(0);
  });

  it("allowlist vazia (só vírgulas) também ⇒ 503, não 'lista vazia libera tudo'", async () => {
    env.NOTIFICAME_WEBHOOK_IPS = " , , ";
    expect((await invoke(post(happyBody()))).status).toBe(503);
  });

  it("GET e outros métodos não entram", async () => {
    const res = await invoke(
      new Request(`https://x/notificame-webhook/${encodeURIComponent(SECRET)}/${SUB_A}`, {
        method: "PUT",
      }),
    );
    expect(res.status).toBe(405);
  });

  it("subconta desconhecida ⇒ o corpo é GUARDADO, e sem org", async () => {
    // Secret vazado + uuid chutado: o dano fica em uma linha de fila. O uuid da
    // subconta é o SEGUNDO fator de portador — o secret sozinho não escolhe tenant.
    const res = await invoke(post(happyBody(), { sub: "99999999-9999-4999-8999-999999999999" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "parked", reason: "unknown_subaccount" });
    expect(messages()).toHaveLength(0);
    expect(parked()).toHaveLength(1);
    expect(parked()[0].organization_id).toBeNull();
    expect(parked()[0].payload).toEqual(happyBody());
  });

  it("o path guardado na fila vem REDIGIDO — a URL carrega o secret", async () => {
    await invoke(post(happyBody(), { sub: "99999999-9999-4999-8999-999999999999" }));

    const urlPath = String(parked()[0].url_path);
    expect(urlPath).toContain("<redacted>");
    expect(urlPath).not.toContain(SECRET);
  });
});

// ─── 2. CORPO SEM O CAMPO DE CANAL ───────────────────────────────────────────

describe("2. corpo sem o campo de canal", () => {
  it("org com UM canal conectado: resolve pelo path e grava", async () => {
    const body = happyBody();
    delete (body as Record<string, unknown>).channelId;

    const res = await invoke(post(body));

    expect(res.status).toBe(200);
    expect(messages()).toHaveLength(1);
    // A org saiu do uuid da subconta no PATH; o canal, do único conectado dela.
    expect(messages()[0].organization_id).toBe(ORG_A);
    expect(messages()[0].messaging_channel_id).toBe(CH_A);
  });

  it("org com DOIS canais e corpo sem canal ⇒ ambiguous_channel, ZERO escrita", async () => {
    db = makeDb({
      ...BASE_SEED(),
      messaging_channels: [
        ...BASE_SEED().messaging_channels,
        {
          id: "eeeeeeee-3333-4333-8333-333333333333",
          organization_id: ORG_A,
          provider: "notificame",
          channel_type: "instagram",
          external_channel_id: "ch_ig_org_a_2",
          status: "connected",
          handle: null,
        },
      ],
    });

    const body = happyBody();
    delete (body as Record<string, unknown>).channelId;
    const res = await invoke(post(body));

    // Falha FECHADO: escolher um dos dois seria adivinhar a caixa de entrada de um
    // cliente. O corpo fica guardado e um humano decide.
    expect(await res.json()).toEqual({ status: "parked", reason: "ambiguous_channel" });
    expect(messages()).toHaveLength(0);
    expect(parked()[0].payload).toEqual(body);
  });

  it("`channel: 'instagram'` é PALAVRA, não id — não vira busca por id", async () => {
    // ⚠️ Esta é a armadilha que CHANNEL_WORDS existe para desarmar. Na doc da
    // subscription, `criteria.channel` é o TIPO do canal. Se o picker tratasse a
    // palavra como identificador, procuraria em messaging_channels um canal com
    // external_channel_id = 'instagram', não acharia, e TODO evento de TODA org
    // pararia em unresolved_channel — com o sintoma apontando para o banco.
    const body = happyBody({ channel: "instagram" });
    delete (body as Record<string, unknown>).channelId;

    const res = await invoke(post(body));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "stored" });
    expect(messages()[0].messaging_channel_id).toBe(CH_A);
  });

  it("canal NOMEADO que não conhecemos ⇒ parka, não cai no canal único", async () => {
    const res = await invoke(post(happyBody({ channelId: "ch_que_ninguem_registrou" })));

    // Cair no canal único da org aqui seria adivinhar POR CIMA de uma declaração
    // explícita — e é justamente o caso em que o picker pode estar lendo o campo
    // errado. Parka e ensina.
    expect(await res.json()).toEqual({ status: "parked", reason: "unresolved_channel" });
    expect(messages()).toHaveLength(0);
  });

  it("palavra de canal DIVERGENTE do nosso tipo ⇒ channel_type_mismatch", async () => {
    // O tipo que decide destino é o NOSSO (messaging_channels.channel_type). O
    // `channel` do corpo é declarado pelo remetente e só é CONFERIDO.
    const res = await invoke(post(happyBody({ channel: "whatsapp" })));

    expect(await res.json()).toEqual({ status: "parked", reason: "channel_type_mismatch" });
    expect(messages()).toHaveLength(0);
  });
});

// ─── 3. REENTREGA ────────────────────────────────────────────────────────────

describe("3. reentrega — o mesmo evento entregue duas vezes", () => {
  it("segunda entrega ⇒ 200 duplicate e UMA linha só", async () => {
    const first = await invoke(post(happyBody()));
    expect(await first.json()).toEqual({ status: "stored" });

    const second = await invoke(post(happyBody()));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: "duplicate" });

    // A guarda é a UNIQUE, não uma checagem no código. Reentrega é o caminho FELIZ.
    expect(messages()).toHaveLength(1);
    expect(parked()).toHaveLength(0);
  });

  it("reentrega com conteúdo DIFERENTE não sobrescreve a linha original", async () => {
    await invoke(post(happyBody()));
    await invoke(post(happyBody({ contents: [{ type: "text", text: "TEXTO TROCADO" }] })));

    expect(messages()).toHaveLength(1);
    expect(messages()[0].content).toBe("oi, tem em estoque?");
  });

  it("MESMO external_id em ORG DIFERENTE é mensagem NOVA, não reentrega", async () => {
    // A UNIQUE inclui organization_id. Se o dedupe fosse só por external_id, a
    // mensagem da org B seria engolida como "reentrega" da org A e sumiria.
    await invoke(post(happyBody()));
    await invoke(post(happyBody({ channelId: "ch_ig_org_b" }), { sub: SUB_B }));

    expect(messages()).toHaveLength(2);
    expect(messages().map((m) => m.organization_id)).toEqual([ORG_A, ORG_B]);
  });

  it("dois eventos distintos da mesma org ⇒ duas linhas", async () => {
    // CONTROLE POSITIVO da chave única: sem ele, um dublê que engolisse TODO
    // segundo upsert deixaria os casos acima verdes por acidente.
    await invoke(post(happyBody({ id: "mid-1" })));
    await invoke(post(happyBody({ id: "mid-2" })));
    expect(messages()).toHaveLength(2);
  });
});

// ─── 4. FORMATO INESPERADO ───────────────────────────────────────────────────

describe("4. corpo que não bate com o formato — GRAVA, nunca descarta", () => {
  it("JSON inválido ⇒ o TEXTO cru é guardado, e a resposta é 200", async () => {
    const res = await invoke(post(null, { raw: "isto-nao-e-json {{{" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "parked", reason: "invalid_json" });
    // `req.json()` direto PERDERIA o corpo — e o corpo é o ativo.
    expect(parked()[0].payload).toEqual({ raw_text: "isto-nao-e-json {{{", truncated: false });
  });

  it("corpo VAZIO de campos conhecidos ⇒ guardado INTEIRO, com os campos alheios", async () => {
    // O caso que este arquivo inteiro existe para cobrir: o fornecedor manda um
    // formato que ninguém previu. Nada aqui é reconhecível; TUDO tem de sobreviver.
    const alien = {
      hub: { evento: "mensagem_recebida" },
      carga: { de: "@cliente", texto: "oi", quando: 1755100000 },
      nested: { deep: [{ a: 1 }, { b: null }] },
    };
    const res = await invoke(post(alien));

    expect(res.status).toBe(200);
    expect(messages()).toHaveLength(0);
    expect(parked()).toHaveLength(1);
    // DEEP EQUAL contra o corpo original: nem recorte, nem redação, nem truncagem.
    // É desta linha que o formato real vai ser aprendido.
    expect(parked()[0].payload).toEqual(alien);
  });

  it("eventType desconhecido PARKA — não é descartado em silêncio", async () => {
    const res = await invoke(post(happyBody({ eventType: "MESSAGE_REACTION" })));

    expect(await res.json()).toEqual({ status: "parked", reason: "unhandled_event" });
    expect(parked()[0].payload).toEqual(happyBody({ eventType: "MESSAGE_REACTION" }));
    // Descartar produziria o pior sintoma possível: silêncio, indistinguível de
    // "ninguém mandou nada".
    expect(messages()).toHaveLength(0);
  });

  it("MESSAGE_STATUS também parka (fatia inbound-only, sem linha de saída)", async () => {
    const res = await invoke(post(happyBody({ eventType: "MESSAGE_STATUS" })));
    expect(await res.json()).toEqual({ status: "parked", reason: "unhandled_event" });
    expect(parked()[0].event_type).toBe("message_status");
  });

  it("direção ILEGÍVEL parka — nunca 'assume incoming'", async () => {
    const res = await invoke(post(happyBody({ direction: "LATERAL" })));

    // Assumir `incoming` gravaria uma mensagem NOSSA como se o cliente tivesse
    // enviado — erro que a UI mostra invertido e que nenhum log denuncia.
    expect(await res.json()).toEqual({ status: "parked", reason: "unreadable_direction" });
    expect(messages()).toHaveLength(0);
  });

  it("direção AUSENTE parka (não há default)", async () => {
    const body = happyBody();
    delete (body as Record<string, unknown>).direction;
    expect(await (await invoke(post(body))).json()).toEqual({
      status: "parked",
      reason: "unreadable_direction",
    });
  });

  it("SEM id do fornecedor a linha NÃO NASCE — jamais um id sintético", async () => {
    // ⚠️ O defeito que este caso existe para não deixar copiar:
    // send-meta-message/index.ts:137 usa `result.message_id || meta_${Date.now()}`.
    // Um id sintético é NOVO a cada reentrega: derrota a UNIQUE — a única guarda
    // de idempotência desta rota — e duplica a mensagem no inbox do cliente.
    const body = happyBody();
    delete (body as Record<string, unknown>).id;

    const res = await invoke(post(body));

    expect(await res.json()).toEqual({ status: "parked", reason: "missing_external_id" });
    expect(messages()).toHaveLength(0);
    expect(parked()[0].external_id).toBeNull();
  });

  it("external_id STRING VAZIA conta como ausência", async () => {
    // `''` passaria por `typeof === 'string'` e viraria um external_id vazio, que
    // colide com TODA outra mensagem vazia da mesma org na UNIQUE: mensagens
    // diferentes se absorveriam como reentrega uma da outra.
    const res = await invoke(post(happyBody({ id: "   " })));
    expect(await res.json()).toEqual({ status: "parked", reason: "missing_external_id" });
    expect(messages()).toHaveLength(0);
  });

  it("interlocutor ausente parka como `missing_contact_id` — NÃO como `missing_external_id`", async () => {
    // Este caso parkava sob o MESMO rótulo de "não veio id da mensagem" — duas
    // causas distintas colapsadas numa coluna só, justamente a que o operador vai
    // AGRUPAR ao abrir a fila pela primeira vez. As duas faltas apontam para
    // pickers DIFERENTES: esta manda ajustar os aliases de `pickContact`; a outra,
    // os de `pickExternalId`. Um rótulo só mandava editar o alias errado.
    const body = happyBody();
    delete (body as Record<string, unknown>).from;
    const res = await invoke(post(body));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "parked", reason: "missing_contact_id" });
    expect(messages()).toHaveLength(0);
    expect(parked()).toHaveLength(1);
    expect(parked()[0].reason).toBe("missing_contact_id");
    // O id da MENSAGEM veio; o que faltou foi o do interlocutor. A fila guarda os
    // dois fatos, e é essa diferença que o rótulo passa a carregar.
    expect(parked()[0].external_id).toBe("mid-fornecedor-001");
  });

  it("os dois `missing_*` são DISTINGUÍVEIS no mesmo lote da fila", async () => {
    // O controle positivo do rótulo: sem ele, um `reason` constante deixaria o
    // caso acima verde e a distinção existiria só no tipo TypeScript.
    const semId = happyBody();
    delete (semId as Record<string, unknown>).id;
    const semContato = happyBody();
    delete (semContato as Record<string, unknown>).from;

    await invoke(post(semId));
    await invoke(post(semContato));

    expect(parked().map((p) => p.reason)).toEqual([
      "missing_external_id",
      "missing_contact_id",
    ]);
  });

  it("texto ilegível NÃO parka — a conversa aparece, e o corpo cru ensina o resto", async () => {
    // Conteúdo é cosmético; identidade não é. Parkar por causa do texto esconderia
    // a conversa inteira por um campo que o raw_payload já preserva.
    const body = happyBody();
    delete (body as Record<string, unknown>).contents;

    const res = await invoke(post({ ...body, coisa_estranha: { texto: "oi" } }));

    expect(await res.json()).toEqual({ status: "stored" });
    expect(messages()[0].content).toBeNull();
    expect(messages()[0].message_type).toBe("text");
    expect((messages()[0].raw_payload as Record<string, unknown>).coisa_estranha).toEqual({
      texto: "oi",
    });
  });

  it("timestamp ilegível NÃO parka — o relógio local entra, e só ele", async () => {
    const res = await invoke(post(happyBody({ timestamp: "ontem de tarde" })));
    expect(await res.json()).toEqual({ status: "stored" });
    // channel_messages.timestamp é NOT NULL; o fallback mora no handler, nunca no
    // módulo puro de identidade (ver o teste estrutural no fim do arquivo).
    expect(typeof messages()[0].timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(String(messages()[0].timestamp)))).toBe(false);
  });

  it("timestamp em epoch de SEGUNDOS vira ISO correto", async () => {
    await invoke(post(happyBody({ timestamp: 1755100000 })));
    expect(messages()[0].timestamp).toBe(new Date(1755100000 * 1000).toISOString());
  });

  it("se NEM GUARDAR deu ⇒ 5xx, para o fornecedor reentregar", async () => {
    // O único desfecho em que perder o evento ainda é possível — e por isso ele
    // NÃO pode responder 200. É a lição do enqueueDlq (incidente 2026-08-06).
    db = makeDb(BASE_SEED(), { failInsertOn: "notificame_webhook_events" });

    const res = await invoke(post(happyBody({ eventType: "COISA_NOVA" })));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "park_failed", reason: "unhandled_event" });
  });

  it("o corpo cru NUNCA vai para runtime_logs — só escalares nossos", async () => {
    const segredo = { eventType: "COISA_NOVA", token: "tk_super_secreto", texto: "PII do cliente" };
    await invoke(post(segredo));

    // redactSecrets redige por NOME DE CHAVE; um JSON.stringify do payload sob uma
    // chave nossa (o que whatsapp-webhook L1470 faz com raw_truncated) não casa
    // chave nenhuma e atravessa token inteiro para uma tabela lida por humanos.
    const logged = JSON.stringify(logRuntime.mock.calls);
    expect(logged).not.toContain("tk_super_secreto");
    expect(logged).not.toContain("PII do cliente");
    // …mas a fila tem o corpo inteiro (RLS service_role-only).
    expect(parked()[0].payload).toEqual(segredo);
  });
});

// ─── 5. ISOLAMENTO ENTRE ORGANIZAÇÕES ────────────────────────────────────────

describe("5. isolamento entre organizações", () => {
  it("canal da org B declarado no path da org A ⇒ channel_org_mismatch, ZERO escrita", async () => {
    const res = await invoke(post(happyBody({ channelId: "ch_ig_org_b" }), { sub: SUB_A }));

    expect(await res.json()).toEqual({ status: "parked", reason: "channel_org_mismatch" });
    expect(messages()).toHaveLength(0);
    // A busca do canal é GLOBAL de propósito: encontrar a linha e COMPARAR a org
    // dela com a do path é o que transforma a forja em sintoma VISÍVEL. Filtrar por
    // org devolveria "não achei", indistinguível de canal desconhecido.
    expect(parked()[0].organization_id).toBe(ORG_A);
    expect(parked()[0].messaging_channel_id).toBe(CH_B);
  });

  it("o mismatch é LOGADO como erro — não some junto com o park", async () => {
    await invoke(post(happyBody({ channelId: "ch_ig_org_b" }), { sub: SUB_A }));
    const call = logRuntime.mock.calls.find(
      (c) => (c[0] as { action?: string })?.action === "notificame_channel_org_mismatch",
    );
    expect(call).toBeDefined();
    expect((call![0] as { status: string }).status).toBe("error");
  });

  it("o corpo NÃO consegue escolher tenant: organization_id vem do PATH", async () => {
    // A tentação que o handler recusa tem nome: "é a única org com a flag ligada".
    // Hoje é verdade (só Milennials), amanhã não é, e o fallback teria virado
    // entrega cross-tenant sem nenhum sintoma.
    const res = await invoke(
      post(happyBody({ organization_id: ORG_B, organizationId: ORG_B, org_id: ORG_B })),
      { sub: SUB_A },
    );

    expect(await res.json()).toEqual({ status: "stored" });
    expect(messages()).toHaveLength(1);
    expect(messages()[0].organization_id).toBe(ORG_A);
  });

  it("mensagem da org A não aparece na leitura da org B (nem por canal, nem por org)", async () => {
    await invoke(post(happyBody()));
    await invoke(post(happyBody({ id: "mid-b-1", channelId: "ch_ig_org_b" }), { sub: SUB_B }));

    // A RPC get_social_conversation_list recorta por (organization_id,
    // messaging_channel_id) e tem gate de p_channel ∈ p_org. Aqui medimos o dado
    // que ela vai ler: cada linha carrega exatamente uma org e um canal.
    const doB = messages().filter((m) => m.organization_id === ORG_B);
    expect(doB).toHaveLength(1);
    expect(doB[0].external_id).toBe("mid-b-1");
    expect(doB[0].messaging_channel_id).toBe(CH_B);

    const daA = messages().filter((m) => m.organization_id === ORG_A);
    expect(daA).toHaveLength(1);
    expect(daA.every((m) => m.messaging_channel_id === CH_A)).toBe(true);
  });

  it("segmento de subconta ausente ⇒ parka, e NÃO cai na 'única org com a flag'", async () => {
    const res = await invoke(post(happyBody(), { sub: null }));

    expect(await res.json()).toEqual({
      status: "parked",
      reason: "missing_subaccount_segment",
    });
    expect(messages()).toHaveLength(0);
    expect(parked()[0].organization_id).toBeNull();
  });

  it("subconta que não é uuid ⇒ parka antes de qualquer consulta de canal", async () => {
    const res = await invoke(post(happyBody(), { sub: "../../admin" }));
    expect(await res.json()).toEqual({
      status: "parked",
      reason: "missing_subaccount_segment",
    });
    expect(db.touched).not.toContain("messaging_channels");
  });
});

// ─── 6. backfill do handle ───────────────────────────────────────────────────

describe("6. backfill do handle da NOSSA conta", () => {
  it("preenche messaging_channels.handle quando o corpo o traz e a coluna está NULL", async () => {
    // buildMessagingChannelRow deixa a coluna NULL porque GET /v1/channels não
    // devolve o @usuário; o evento de entrada é a primeira chance de saber.
    await invoke(post(happyBody({ account: { username: "@milennials" } })));

    expect(db.store.messaging_channels.find((c) => c.id === CH_A)?.handle).toBe("milennials");
  });

  it("NÃO usa o @ do interlocutor como identidade da nossa conta", async () => {
    // Aliases deliberadamente distintos: gravar o handle do interlocutor exibiria,
    // na lista de caixas, o nome de um cliente qualquer como identidade da empresa.
    await invoke(post(happyBody()));
    expect(db.store.messaging_channels.find((c) => c.id === CH_A)?.handle).toBeNull();
  });

  it("handle já preenchido não é sobrescrito", async () => {
    const seed = BASE_SEED();
    seed.messaging_channels[0].handle = "handle_antigo";
    db = makeDb(seed);

    await invoke(post(happyBody({ account: { username: "@outro" } })));
    expect(db.store.messaging_channels.find((c) => c.id === CH_A)?.handle).toBe("handle_antigo");
  });
});

// ─── 7. asserção ESTRUTURAL: nenhum id sintético pode nascer ─────────────────

describe("7. estrutural — o módulo de identidade não tem de onde tirar um id", () => {
  it("_shared/notificame-inbound.ts não toca relógio, aleatório nem gerador de uuid", () => {
    // Os casos de comportamento acima provam que HOJE nenhum id é inventado. Esta
    // asserção protege o AMANHÃ: um `|| Date.now()` acrescentado "para não deixar
    // vazio" seria exatamente o defeito de send-meta-message:137, e um teste de
    // comportamento não o pegaria se o novo caminho tivesse um alias a mais.
    const src = readFileSync(
      path.resolve(
        __dirname,
        "../../supabase/functions/_shared/notificame-inbound.ts",
      ),
      "utf8",
    );
    // Comentários citam o defeito pelo nome; a asserção olha só o CÓDIGO.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(code).not.toMatch(/Date\.now\s*\(/);
    expect(code).not.toMatch(/Math\.random\s*\(/);
    expect(code).not.toMatch(/randomUUID|crypto\.random/);
    // `new Date(...)` é permitido — pickTimestampIso converte epoch declarado PELO
    // CORPO. O que não pode é `new Date()` SEM argumento, que é o relógio local.
    expect(code).not.toMatch(/new\s+Date\s*\(\s*\)/);
  });
});
