import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authorizeCallAndMint, renewCallControlToken } from "./call-plane.ts";
import { __resetKeyCacheForTests } from "./internal/sign.ts";
import type { Caller } from "./caller.ts";

// ---------------------------------------------------------------------------
// Ambiente
// ---------------------------------------------------------------------------
// SUPABASE_URL / SERVICE_ROLE_KEY ficam DE FORA de propósito: sem eles
// logRuntime retorna cedo e o teste não tenta escrever em banco nenhum.

async function setupSigningKey(): Promise<void> {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;

  const priv = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const seed = b64urlToBytes(priv.d!);
  const pub = b64urlToBytes(priv.x!);

  const combined = new Uint8Array(64);
  combined.set(seed, 0);
  combined.set(pub, 32);

  let bin = "";
  for (const b of combined) bin += String.fromCharCode(b);

  Deno.env.set("TORQUECALLS_SIGNING_SK", btoa(bin));
  Deno.env.set("TORQUECALLS_AUDIENCE", "calls.torquecrm.com.br");
  Deno.env.set("TORQUECALLS_ENV", "test");
  __resetKeyCacheForTests();
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeClaims(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
}

// ---------------------------------------------------------------------------
// Cliente de mentira
// ---------------------------------------------------------------------------
// Cada tabela é uma função dos filtros aplicados, para que o teste possa provar
// que um filtro específico (ex.: source do consentimento) é o que nega.

type Filters = Record<string, unknown>;
type TableFn = (f: Filters) => Record<string, unknown> | null;

interface StubSpec {
  tables: Record<string, TableFn>;
  rpc?: (name: string, args: Record<string, unknown>) => unknown;
}

function stubClient(spec: StubSpec) {
  const calls: { rpc: Record<string, unknown>[] } = { rpc: [] };

  const makeQuery = (table: string) => {
    const filters: Filters = {};
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "limit", "order", "neq"]) {
      chain[m] = (a?: unknown, b?: unknown) => {
        if (m !== "select" && m !== "limit" && typeof a === "string") {
          filters[a] = b;
        }
        return chain;
      };
    }
    chain.maybeSingle = () =>
      Promise.resolve({ data: (spec.tables[table] ?? (() => null))(filters), error: null });
    chain.single = chain.maybeSingle;
    return chain;
  };

  return {
    from: (table: string) => makeQuery(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.rpc.push({ name, args });
      return Promise.resolve({ data: spec.rpc ? spec.rpc(name, args) : null, error: null });
    },
    __calls: calls,
    // deno-lint-ignore no-explicit-any
  } as any;
}

const ORG = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_ORG = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER = "11111111-1111-1111-1111-111111111111";
const TM = "b1111111-1111-1111-1111-111111111111";
const LEAD = "c1111111-1111-1111-1111-111111111111";
const CALL = "d1111111-1111-1111-1111-111111111111";

// O cast é a prova pelo avesso do teste de tipo em types.test.ts: fora de
// resolveCaller, só se produz um Caller mentindo para o compilador.
function memberCaller(over: Partial<Caller> = {}): Caller {
  return {
    orgId: ORG,
    userId: USER,
    teamMemberId: TM,
    role: "member",
    isMaster: false,
    isGestor: false,
    ...over,
  } as unknown as Caller;
}

const openSession = () => ({
  tc_session_id: "tc-sess",
  organization_id: ORG,
  status: "open",
});

const ownedLead = () => ({
  id: LEAD,
  organization_id: ORG,
  normalized_phone: "5548 99100-5289",
  phone_digits: null,
  phone: null,
  sdr_id: TM,
  closer_id: null,
  responsible_id: null,
});

const grantedConsent = (f: Filters) =>
  Array.isArray(f.source) && (f.source as string[]).includes("form")
    ? { id: "consent-1" }
    : null;

/** Permite qualquer feature para um membro comum. */
const permissiveEngine = {
  master_users: () => null,
  team_members: () => ({ id: TM, role: "member" }),
  feature_permissions: () => ({ is_admin_only: false, default_value: true }),
  member_feature_permissions: () => null,
};

// O id de rede que a reserva passa a cunhar. 32 chars de [0-9A-F] — o formato
// exato que validCallID aceita do outro lado.
const TC_CALL = "D1111111111111111111111111111111";

const okReserve = () => ({ ok: true, call_id: CALL, tc_call_id: TC_CALL, token_jti: "jti-1" });

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------

Deno.test("autoriza e emite três tokens com atos e validades distintas", async () => {
  await setupSigningKey();

  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: ownedLead,
      consent_records: grantedConsent,
      ...permissiveEngine,
    },
    rpc: okReserve,
  });

  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: LEAD,
  });

  assert(res.ok, `esperava autorização, veio ${JSON.stringify(res)}`);
  assertEquals(res.callId, CALL);

  const start = decodeClaims(res.tokens.start);
  const media = decodeClaims(res.tokens.media);
  const ctl = decodeClaims(res.tokens.ctl);

  assertEquals(start.act, ["call.start"]);
  assertEquals(media.act, ["call.media"]);
  assertEquals(ctl.act, ["call.end"]);

  // Três tokens, não um com três atos: sem jti compartilhado, consumir um não
  // invalida os outros.
  assert(start.jti !== media.jti && media.jti !== ctl.jti, "jti tem que ser distinto");

  // Validades: start curto, ctl longo (encerrar não pode depender da rede do CRM).
  assert((start.exp as number) < (media.exp as number));
  assert((media.exp as number) < (ctl.exp as number));

  assertEquals(start.org, ORG);
  assertEquals(start.sub, USER);
  assertEquals(start.aud, "calls.torquecrm.com.br");
  assertEquals(start.env, "test");
});

Deno.test("o número discado vem do lead, não do chamador — e normalizado", async () => {
  await setupSigningKey();

  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: ownedLead,
      consent_records: grantedConsent,
      ...permissiveEngine,
    },
    rpc: okReserve,
  });

  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: LEAD,
  });

  assert(res.ok);
  // O lead guarda "5548 99100-5289" com máscara; o que vai para a reserva e para
  // o token é só dígito — teto por destino não pode ser burlado trocando formato.
  assertEquals(res.peer, "5548991005289");
  assertEquals(decodeClaims(res.tokens.start).peer, "5548991005289");

  const reserve = db.__calls.rpc.find((c: Record<string, unknown>) => c.name === "fn_voip_call_reserve");
  assertEquals((reserve!.args as Record<string, unknown>).p_peer_phone, "5548991005289");
  assertEquals((reserve!.args as Record<string, unknown>).p_organization_id, ORG);
});

Deno.test("nega outbound sem lead_id", async () => {
  await setupSigningKey();
  const db = stubClient({ tables: { voip_sessions: openSession } });

  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
  });

  assert(!res.ok);
  assertEquals(res.code, "lead_required");
});

Deno.test("nega sessão de outra organização", async () => {
  await setupSigningKey();
  const db = stubClient({
    tables: {
      voip_sessions: () => ({ tc_session_id: "tc-sess", organization_id: OTHER_ORG, status: "open" }),
    },
  });

  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: LEAD,
  });

  assert(!res.ok);
  assertEquals(res.code, "session_org_mismatch");
});

Deno.test("nega lead que não é do operador", async () => {
  await setupSigningKey();
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: () => ({ ...ownedLead(), sdr_id: "outro", closer_id: null, responsible_id: null }),
      consent_records: grantedConsent,
      ...permissiveEngine,
    },
    rpc: okReserve,
  });

  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: LEAD,
  });

  assert(!res.ok);
  assertEquals(res.code, "not_lead_owner");
});

Deno.test("admin alcança lead de qualquer um da org", async () => {
  await setupSigningKey();
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: () => ({ ...ownedLead(), sdr_id: "outro", closer_id: null, responsible_id: null }),
      consent_records: grantedConsent,
      ...permissiveEngine,
    },
    rpc: okReserve,
  });

  const res = await authorizeCallAndMint(memberCaller({ role: "admin" }), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: LEAD,
  });

  assert(res.ok, `admin deveria passar, veio ${JSON.stringify(res)}`);
});

Deno.test("nega sem consentimento de voz", async () => {
  await setupSigningKey();
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: ownedLead,
      consent_records: () => null,
      ...permissiveEngine,
    },
    rpc: okReserve,
  });

  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: LEAD,
  });

  assert(!res.ok);
  assertEquals(res.code, "consent_missing");
});

Deno.test("consentimento com source='manual' não conta", async () => {
  await setupSigningKey();

  // A tabela devolve a linha SÓ quando o filtro de source inclui 'manual' —
  // isto é, o teste falha se o choke parar de restringir a origem.
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: ownedLead,
      consent_records: (f) =>
        Array.isArray(f.source) && (f.source as string[]).includes("manual")
          ? { id: "consent-manual" }
          : null,
      ...permissiveEngine,
    },
    rpc: okReserve,
  });

  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: LEAD,
  });

  assert(!res.ok);
  assertEquals(res.code, "consent_missing");
});

Deno.test("nega quando o membro não tem voip.call.start", async () => {
  await setupSigningKey();
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: ownedLead,
      consent_records: grantedConsent,
      master_users: () => null,
      team_members: () => ({ id: TM, role: "member" }),
      feature_permissions: () => ({ is_admin_only: false, default_value: false }),
      member_feature_permissions: () => null,
    },
    rpc: okReserve,
  });

  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: LEAD,
  });

  assert(!res.ok);
  assertEquals(res.code, "permission_denied");
});

Deno.test("repassa a negativa do governor sem assinar nada", async () => {
  await setupSigningKey();

  for (
    const [code, retry] of [
      ["voice_calls_disabled", undefined],
      ["operator_busy", undefined],
      ["daily_cap_reached", undefined],
      ["org_concurrency_reached", 5000],
    ] as const
  ) {
    const db = stubClient({
      tables: {
        voip_sessions: openSession,
        leads: ownedLead,
        consent_records: grantedConsent,
        ...permissiveEngine,
      },
      rpc: () => ({ ok: false, code, retry_after_ms: retry }),
    });

    const res = await authorizeCallAndMint(memberCaller(), {
      supabaseAdmin: db,
      tcSessionId: "tc-sess",
      direction: "outbound",
      leadId: LEAD,
    });

    assert(!res.ok, `${code} deveria negar`);
    assertEquals(res.code, code);
    if (retry !== undefined) assertEquals(res.retryAfterMs, retry);
  }
});

Deno.test("atender chamada de entrada não exige consentimento e usa act=call.accept", async () => {
  await setupSigningKey();

  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      voip_calls: () => ({
        id: CALL,
        organization_id: ORG,
        peer_phone: "554891005289",
        lead_id: null,
        status: "ringing",
        tc_call_id: TC_CALL,
      }),
      // Nenhuma linha de consentimento: quem ligou foi o outro lado.
      consent_records: () => null,
      ...permissiveEngine,
    },
    rpc: okReserve,
  });

  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "inbound",
    existingCallId: CALL,
  });

  assert(res.ok, `esperava autorização, veio ${JSON.stringify(res)}`);
  assertEquals(decodeClaims(res.tokens.start).act, ["call.accept"]);
});

Deno.test("chamada de entrada já encerrada não é atendível", async () => {
  await setupSigningKey();
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      voip_calls: () => ({
        id: CALL,
        organization_id: ORG,
        peer_phone: "554891005289",
        lead_id: null,
        status: "ended",
      }),
      ...permissiveEngine,
    },
  });

  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "inbound",
    existingCallId: CALL,
  });

  assert(!res.ok);
  assertEquals(res.code, "call_not_answerable");
});

// Achado I1 (metade TypeScript): a migration 20270730000008 já protege o banco
// (o WHERE do UPDATE nega sem gravar operator_user_id), mas sem este pré-check
// o pedido ainda ia até fn_voip_call_reserve para levar a mesma negativa — uma
// ida inútil, e um `call_not_answerable` genérico que não diz por quê.
Deno.test("atender chamada de entrada sem tc_call_id nega cedo, sem chamar a reserva", async () => {
  await setupSigningKey();

  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      voip_calls: () => ({
        id: CALL,
        organization_id: ORG,
        peer_phone: "554891005289",
        lead_id: null,
        status: "ringing",
        tc_call_id: null,
      }),
      ...permissiveEngine,
    },
    rpc: okReserve,
  });

  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "inbound",
    existingCallId: CALL,
  });

  assert(!res.ok, `esperava negativa, veio ${JSON.stringify(res)}`);
  assertEquals(res.code, "no_tc_call_id");
  assertEquals(db.__calls.rpc.length, 0, "não deveria ter chamado fn_voip_call_reserve");
});

// O arquivo inteiro não tinha UMA asserção sobre o cid — por isso a suíte ficou
// verde enquanto, em produção, todo token de chamada era recusado por formato.
Deno.test("o cid assinado é o id de rede, não o uuid da linha", async () => {
  await setupSigningKey();

  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: ownedLead,
      consent_records: grantedConsent,
      ...permissiveEngine,
    },
    rpc: okReserve,
  });

  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: LEAD,
  });

  assert(res.ok, `esperava autorização, veio ${JSON.stringify(res)}`);

  // O uuid continua identificando a linha do ledger.
  assertEquals(res.callId, CALL);
  // E o id de rede é o que vai para a VPS.
  assertEquals(res.tcCallId, TC_CALL);

  // A asserção que importa: callIDFor compara o cid da claim com o id do path,
  // e o path é montado a partir do tc_call_id.
  for (const tok of [res.tokens.start, res.tokens.media, res.tokens.ctl]) {
    const c = decodeClaims(tok);
    assertEquals(c.cid, TC_CALL, "o cid tem que ser o id de rede");
    assertMatch(c.cid as string, /^[0-9A-F]{32}$/, "o cid tem que passar no validCallID da VPS");
  }
});

Deno.test("recusa sem assinar quando a reserva não devolve tc_call_id", async () => {
  await setupSigningKey();

  // Fail-closed. Assinar sem id de rede produz token que a VPS recusa por
  // formato, e o sintoma chega como "a chamada não completa" em vez de erro de
  // contrato.
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: ownedLead,
      consent_records: grantedConsent,
      ...permissiveEngine,
    },
    rpc: () => ({ ok: true, call_id: CALL, token_jti: "jti-1" }),
  });

  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: LEAD,
  });

  assertEquals(res.ok, false);
  assertEquals((res as { code?: string }).code, "reserve_failed");
});

// renewCallControlToken é o outro chamador de signCallToken. Sem este teste, o
// caminho de desligar continuaria com o uuid no cid e tomando 401 — e o defeito
// só apareceria ao vivo, no portão.
Deno.test("renewCallControlToken também assina o cid com o id de rede", async () => {
  await setupSigningKey();

  const db = stubClient({
    tables: {
      voip_calls: () => ({
        id: CALL,
        organization_id: ORG,
        tc_session_id: "tc-sess",
        tc_call_id: TC_CALL,
        peer_phone: "5548991005289",
        lead_id: LEAD,
        operator_user_id: USER,
        status: "connected",
      }),
      ...permissiveEngine,
    },
  });

  const res = await renewCallControlToken(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    callId: CALL,
  });

  assert(res.ok, `esperava renovação, veio ${JSON.stringify(res)}`);
  assertMatch(decodeClaims(res.ctl).cid as string, /^[0-9A-F]{32}$/);
  assertEquals(decodeClaims(res.ctl).cid, TC_CALL);
});

// Achado C2 (CRITICAL). A rota POST /calls/{id}/reject da VPS exige o ato
// call.reject; terminate() em torquecalls-signal manda o token de
// renewCallControlToken tanto para /reject quanto para o DELETE de encerrar.
// Emitir só call.end fazia recusar chamada de entrada tomar 401 sempre — este
// teste decodifica a credencial e prova que os DOIS atos saem juntos.
Deno.test("renewCallControlToken emite call.end E call.reject — recusar chamada de entrada não pode ser 401", async () => {
  await setupSigningKey();

  const db = stubClient({
    tables: {
      voip_calls: () => ({
        id: CALL,
        organization_id: ORG,
        tc_session_id: "tc-sess",
        tc_call_id: TC_CALL,
        peer_phone: "5548991005289",
        lead_id: LEAD,
        operator_user_id: USER,
        status: "ringing",
      }),
      ...permissiveEngine,
    },
  });

  const res = await renewCallControlToken(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    callId: CALL,
  });

  assert(res.ok, `esperava renovação, veio ${JSON.stringify(res)}`);
  assertEquals(decodeClaims(res.ctl).act, ["call.end", "call.reject"]);
});
