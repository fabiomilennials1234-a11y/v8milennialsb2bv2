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

/**
 * Projeta a linha pelas colunas pedidas no `.select(...)`, como o PostgREST faz:
 * o que não foi pedido NÃO volta.
 *
 * Sem isto o stub devolvia a linha inteira independentemente do `select`, e uma
 * coluna removida da consulta ficava indetectável — o código lia um campo que a
 * consulta real nunca teria trazido. Era um jeito de a suíte ficar verde sobre
 * um `select` mutilado.
 */
function project(
  row: Record<string, unknown> | null,
  selected: string | null,
): Record<string, unknown> | null {
  if (!row || !selected || selected.includes("*")) return row;
  const cols = selected.split(",").map((c) => c.trim()).filter(Boolean);
  // Select com relacionamento embutido (`tabela(coluna)`) não é projetável
  // coluna a coluna; devolve inteiro em vez de mentir.
  if (cols.some((c) => c.includes("("))) return row;
  const out: Record<string, unknown> = {};
  for (const c of cols) out[c] = row[c];
  return out;
}

function stubClient(spec: StubSpec) {
  const calls: { rpc: Record<string, unknown>[] } = { rpc: [] };

  const makeQuery = (table: string) => {
    const filters: Filters = {};
    let selected: string | null = null;
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "limit", "order", "neq"]) {
      chain[m] = (a?: unknown, b?: unknown) => {
        if (m === "select") {
          if (typeof a === "string") selected = a;
        } else if (m !== "limit" && typeof a === "string") {
          filters[a] = b;
        }
        return chain;
      };
    }
    chain.maybeSingle = () =>
      Promise.resolve({
        data: project((spec.tables[table] ?? (() => null))(filters), selected),
        error: null,
      });
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
const INSTANCE = "e1111111-1111-1111-1111-111111111111";

/**
 * O cliente com o JWT do chamador, como `resolveCaller` o entrega. É por ele
 * que o choke pergunta "este usuário ENXERGA este lead?" — em produção quem
 * responde é a RLS de `leads`; aqui, este stub. Por padrão o lead está visível.
 */
const leadVisivel = () =>
  stubClient({ tables: { leads: (f) => (f.id === LEAD ? { id: LEAD } : null) } });
const leadInvisivel = () => stubClient({ tables: { leads: () => null } });
/** A RLS não devolve vazio, devolve ERRO — e o gate tem que negar do mesmo jeito. */
const leadComErro = () => ({
  from: () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "maybeSingle"]) {
      chain[m] = () =>
        m === "maybeSingle"
          ? Promise.resolve({ data: null, error: { message: "permission denied" } })
          : chain;
    }
    return chain;
  },
  // deno-lint-ignore no-explicit-any
}) as any;

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
    asUser: leadVisivel(),
    ...over,
  } as unknown as Caller;
}

const openSession = () => ({
  tc_session_id: "tc-sess",
  organization_id: ORG,
  status: "open",
  // A sessão é quem carrega a instância — é exatamente por isso que o vínculo
  // usuário↔instância tem que ser checado aqui: o front escolhe a sessão.
  whatsapp_instance_id: INSTANCE,
});

/**
 * Um lead da org, sem dono nenhum. Desde 2026-09-02 o choke não lê coluna de
 * responsável — nem as canônicas (`pre_sale_responsible_id`,
 * `sale_responsible_id`) nem as legadas marcadas para drop (#755). Elas ficam
 * de fora do fixture de propósito: um `select` que voltasse a pedi-las quebra
 * na projeção do stub.
 */
const orgLead = () => ({
  id: LEAD,
  organization_id: ORG,
  normalized_phone: "5548 99100-5289",
  phone_digits: null,
  phone: null,
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

/**
 * O choke consulta DUAS RPCs: `fn_voip_can_use_instance` (o vínculo
 * usuário↔instância) e `fn_voip_call_reserve` (o governor). Este envelope deixa
 * o gate de instância PASSAR e delega o resto ao stub de reserva do teste — o
 * padrão de produção hoje, onde a única instância com voz não tem lista de
 * vendedores e portanto é aberta a toda a organização.
 */
const allowingInstance =
  (reserve: () => unknown) => (name: string): unknown =>
    name === "fn_voip_can_use_instance" ? true : reserve();

const okReserve = allowingInstance(() => ({
  ok: true,
  call_id: CALL,
  tc_call_id: TC_CALL,
  token_jti: "jti-1",
}));

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------

Deno.test("autoriza e emite três tokens com atos e validades distintas", async () => {
  await setupSigningKey();

  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: orgLead,
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
      leads: orgLead,
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

// O defeito de produção, medido de ponta a ponta pelo choke.
//
// `leads.normalized_phone` é chave de busca: `normalizePhoneForSearch` remove o
// DDI de propósito. O choke lia essa coluna e mandava os dígitos para a rede; a
// VPS montava `+51985960716`, que é PERU, e o WhatsApp respondia corretamente
// que aquele número não existe. Duas linhas em `voip_calls` provam:
// `end_reason = 'vps_refused:51985960716: number is not on WhatsApp'`.
//
// Mede as TRÊS saídas do choke, não só a devolvida: o token que a VPS vai ler,
// o `p_peer_phone` que vira `peer_phone` no ledger (e conta o teto por destino)
// e o `peer` da resposta. Divergência entre elas foi o que produziu o defeito
// de `tc_call_id` em outra fatia.
Deno.test("o DDI é reposto antes de o número sair para a rede (caso de produção)", async () => {
  await setupSigningKey();

  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: () => ({ ...orgLead(), normalized_phone: "51985960716" }),
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
  assertEquals(res.peer, "5551985960716");
  assertEquals(decodeClaims(res.tokens.start).peer, "5551985960716");

  const reserve = db.__calls.rpc.find((c: Record<string, unknown>) => c.name === "fn_voip_call_reserve");
  assertEquals((reserve!.args as Record<string, unknown>).p_peer_phone, "5551985960716");
});

// O lado oposto: número que já está internacional não pode ser alterado. Se o
// choke empilhasse o DDI, `5551985960716` viraria `555551985960716` e a chamada
// falharia do mesmo jeito, só que com o defeito invertido.
Deno.test("número que já tem DDI atravessa o choke intocado", async () => {
  await setupSigningKey();

  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: () => ({ ...orgLead(), normalized_phone: "5551985960716" }),
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
  assertEquals(res.peer, "5551985960716");
  assertEquals(decodeClaims(res.tokens.start).peer, "5551985960716");
});

Deno.test("nega outbound sem lead_id", async () => {
  await setupSigningKey();
  const db = stubClient({
    tables: { voip_sessions: openSession },
    // Sem isto o gate de instância fail-closa antes de chegar ao lead — o que é
    // o comportamento certo, mas não é o que ESTE teste mede.
    rpc: allowingInstance(() => null),
  });

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

// ─── Vê o lead → pode ligar (2026-09-02) ─────────────────────────────────────
//
// Até aqui havia um gate de DONO: membro só ligava para lead de que fosse
// responsável — e lendo colunas legadas, não `pre_sale_responsible_id` /
// `sale_responsible_id`. A leitura (`voip_calls_select_org`) nunca foi assim —
// era por visibilidade — e o dado de dono é raro (~8% dos leads com conversa).
// Resultado medido: o botão sumia para o SDR que estava no chat. A condição
// agora é a RLS de `leads`, consultada com o JWT do chamador — e a policy já
// olha as canônicas via `is_user_responsible(...)`.

Deno.test("lead invisível sob a RLS do chamador → lead_not_visible, mesmo existindo na org", async () => {
  await setupSigningKey();
  // O admin ACHA o lead (existe, é da org, tem telefone). O que nega é o
  // cliente do USUÁRIO devolver vazio — é isto que prova que a pergunta é
  // feita ao cliente certo, e não ao service_role.
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: orgLead,
      consent_records: grantedConsent,
      ...permissiveEngine,
    },
    rpc: okReserve,
  });

  const res = await authorizeCallAndMint(memberCaller({ asUser: leadInvisivel() }), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: LEAD,
  });

  assert(!res.ok);
  assertEquals(res.code, "lead_not_visible");
  // Negou ANTES da reserva: cota não é consumida por lead que não se vê.
  assertEquals(db.__calls.rpc.filter((c) => c.name === "fn_voip_call_reserve").length, 0);
});

Deno.test("membro que NÃO é dono do lead, mas o enxerga, é autorizado", async () => {
  await setupSigningKey();
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: orgLead,
      consent_records: grantedConsent,
      ...permissiveEngine,
    },
    rpc: okReserve,
  });

  // `memberCaller()` é membro comum, `teamMemberId` que não bate com nada, e
  // `orgLead()` não tem coluna de dono nenhuma.
  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: LEAD,
  });

  assert(res.ok, `membro que vê o lead deveria passar, veio ${JSON.stringify(res)}`);
});

Deno.test("erro na consulta de visibilidade NEGA — fail-closed", async () => {
  await setupSigningKey();
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: orgLead,
      consent_records: grantedConsent,
      ...permissiveEngine,
    },
    rpc: okReserve,
  });

  const res = await authorizeCallAndMint(memberCaller({ asUser: leadComErro() }), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: LEAD,
  });

  assert(!res.ok);
  assertEquals(res.code, "lead_not_visible");
});

Deno.test("admin também passa pela RLS — não há mais dono a bypassar", async () => {
  await setupSigningKey();
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: orgLead,
      consent_records: grantedConsent,
      ...permissiveEngine,
    },
    rpc: okReserve,
  });

  const res = await authorizeCallAndMint(
    memberCaller({ role: "admin", asUser: leadInvisivel() }),
    {
      supabaseAdmin: db,
      tcSessionId: "tc-sess",
      direction: "outbound",
      leadId: LEAD,
    },
  );

  assert(!res.ok);
  assertEquals(res.code, "lead_not_visible");
});

// Desde 2026-07-31, por decisão do CTO, o padrão é assumir todo lead
// consentido: `organizations.require_voice_consent` nasce `false`. A trava não
// foi apagada — os dois testes seguintes provam os DOIS lados, e é isso que
// impede a decisão de virar remoção silenciosa da proteção.
Deno.test("sem a exigência ligada, autoriza mesmo sem consentimento nenhum", async () => {
  await setupSigningKey();
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: orgLead,
      organizations: () => ({ require_voice_consent: false }),
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

  assert(res.ok, `deveria autorizar, veio ${JSON.stringify(res)}`);
});

Deno.test("org sem linha legível NÃO vira trava silenciosa", async () => {
  await setupSigningKey();
  // Ausência resolve para "não exige" — mesmo default da coluna. Se isto
  // invertesse, uma leitura falha derrubaria a voz da organização inteira sem
  // que ninguém soubesse por quê.
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: orgLead,
      organizations: () => null,
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

  assert(res.ok, `ausência de linha deveria liberar, veio ${JSON.stringify(res)}`);
});

Deno.test("com a exigência LIGADA, nega sem consentimento de voz", async () => {
  await setupSigningKey();
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: orgLead,
      organizations: () => ({ require_voice_consent: true }),
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

Deno.test("com a exigência ligada, consentimento com source='manual' não conta", async () => {
  await setupSigningKey();

  // A tabela devolve a linha SÓ quando o filtro de source inclui 'manual' —
  // isto é, o teste falha se o choke parar de restringir a origem. Continua
  // valendo para quem liga a exigência: 'manual' é o vendedor afirmando o
  // consentimento do lead, o que não é consentimento.
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: orgLead,
      organizations: () => ({ require_voice_consent: true }),
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
      leads: orgLead,
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

// ---------------------------------------------------------------------------
// Vínculo usuário ↔ instância
// ---------------------------------------------------------------------------
// A sessão carrega a instância, e o `tc_session_id` vem do front. Sem este gate,
// qualquer membro da org que conheça um id de sessão disca pelo número de
// qualquer colega — esconder o botão na interface não fecha nada.

Deno.test("nega quem não opera pela instância da sessão, sem chegar à reserva", async () => {
  await setupSigningKey();
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: orgLead,
      consent_records: grantedConsent,
      ...permissiveEngine,
    },
    // Instância COM lista de vendedores da qual este operador não faz parte.
    rpc: (name: string) =>
      name === "fn_voip_can_use_instance"
        ? false
        : { ok: true, call_id: CALL, tc_call_id: TC_CALL, token_jti: "jti-1" },
  });

  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: LEAD,
  });

  assert(!res.ok);
  assertEquals(res.code, "not_instance_member");

  // NEGATIVA PURA: a reserva nunca é chamada, então nada de cota consumida,
  // nada de linha em voip_calls, nada de operador preso pelo UNIQUE parcial.
  assertEquals(
    db.__calls.rpc.filter((c: Record<string, unknown>) => c.name === "fn_voip_call_reserve").length,
    0,
    "a reserva não pode ser chamada depois da negativa de instância",
  );
});

Deno.test("o gate pergunta pelo usuário do Caller e pela instância da SESSÃO", async () => {
  await setupSigningKey();
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: orgLead,
      consent_records: grantedConsent,
      ...permissiveEngine,
    },
    rpc: okReserve,
  });

  await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: LEAD,
  });

  const gate = db.__calls.rpc.find(
    (c: Record<string, unknown>) => c.name === "fn_voip_can_use_instance",
  );
  assert(gate, "o gate de instância tem que ser consultado");
  // Os dois argumentos são o ponto do desenho: a identidade vem do `Caller`
  // opaco (nunca do corpo da requisição) e a instância vem da SESSÃO (nunca de
  // um id de instância que o cliente escolheu).
  assertEquals((gate.args as Record<string, unknown>).p_user_id, USER);
  assertEquals((gate.args as Record<string, unknown>).p_instance_id, INSTANCE);
});

Deno.test("erro do gate de instância NEGA — fail-closed", async () => {
  await setupSigningKey();
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: orgLead,
      consent_records: grantedConsent,
      ...permissiveEngine,
    },
    // `null` é o que um erro de RPC devolve no lugar do boolean. Um gate que
    // interpretasse isso como "não negou, então pode" abriria o furo inteiro
    // sempre que o banco tossisse.
    rpc: (name: string) =>
      name === "fn_voip_can_use_instance"
        ? null
        : { ok: true, call_id: CALL, tc_call_id: TC_CALL, token_jti: "jti-1" },
  });

  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: LEAD,
  });

  assert(!res.ok);
  assertEquals(res.code, "not_instance_member");
});

Deno.test("atender chamada de ENTRADA também passa pelo gate de instância", async () => {
  await setupSigningKey();
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      voip_calls: () => ({
        id: CALL,
        organization_id: ORG,
        tc_session_id: "tc-sess",
        peer_phone: "554891005289",
        lead_id: null,
        status: "ringing",
        tc_call_id: TC_CALL,
      }),
      ...permissiveEngine,
    },
    rpc: (name: string) =>
      name === "fn_voip_can_use_instance"
        ? false
        : { ok: true, call_id: CALL, tc_call_id: TC_CALL, token_jti: "jti-1" },
  });

  const res = await authorizeCallAndMint(memberCaller(), {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "inbound",
    existingCallId: CALL,
  });

  assert(!res.ok);
  assertEquals(res.code, "not_instance_member");
});

Deno.test("atender chamada de OUTRA sessão é recusado — autorizar e agir usam a mesma chave", async () => {
  await setupSigningKey();
  // O gate de instância aprova, porque a SESSÃO nomeada é de uma instância que
  // este operador pode usar. A chamada, porém, chegou por outra sessão — ou
  // seja, por outra instância. Se o pedido seguisse, a autorização teria sido
  // dada sobre a instância errada.
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      voip_calls: () => ({
        id: CALL,
        organization_id: ORG,
        tc_session_id: "tc-sess-de-outra-instancia",
        peer_phone: "554891005289",
        lead_id: null,
        status: "ringing",
        tc_call_id: TC_CALL,
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

  assert(!res.ok);
  assertEquals(res.code, "call_not_answerable");
  assertEquals(
    db.__calls.rpc.filter((c: Record<string, unknown>) => c.name === "fn_voip_call_reserve").length,
    0,
    "não pode chegar à reserva com a chamada de outra sessão",
  );
});

// CONTROLE POSITIVO do atendimento. É a irmã da asserção 33 do pgTAP, que o
// TypeScript não tinha.
//
// MUTANTE QUE ISTO MATA: remover `tc_session_id` do `.select(...)` da consulta a
// `voip_calls`. Sem a coluna, `call.tc_session_id` fica indefinido, a comparação
// com `tcSessionId` passa a ser SEMPRE verdadeira, e `authorizeCallAndMint`
// recusa TODO atendimento. Não é furo de segurança — erra para o lado
// restritivo — e é pior de diagnosticar: some a capacidade de atender, e o
// sintoma chega como "ninguém consegue atender", que não aponta para um select.
//
// Só pega porque o stub agora projeta as colunas pedidas (ver `project`). Com o
// stub devolvendo a linha inteira, este teste ficaria verde sobre o mutante.
Deno.test("atender pela sessão CERTA devolve sucesso e os três tokens", async () => {
  await setupSigningKey();
  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      voip_calls: () => ({
        id: CALL,
        organization_id: ORG,
        tc_session_id: "tc-sess",
        peer_phone: "554891005289",
        lead_id: null,
        status: "ringing",
        tc_call_id: TC_CALL,
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

  assert(res.ok, `esperava sucesso, veio ${JSON.stringify(res)}`);
  assertEquals(res.callId, CALL);
  assertEquals(res.tcCallId, TC_CALL);
  assert(res.tokens.start && res.tokens.media && res.tokens.ctl);
  // E o token de início é o de ATENDER, não o de discar.
  assertEquals(decodeClaims(res.tokens.start).act, ["call.accept"]);
  // A reserva foi de fato consultada — o sucesso passou pelo governor.
  assertEquals(
    db.__calls.rpc.filter((c: Record<string, unknown>) => c.name === "fn_voip_call_reserve").length,
    1,
  );
});

Deno.test("repassa a negativa do governor sem assinar nada", async () => {
  await setupSigningKey();

  for (
    const [code, retry] of [
      ["voice_calls_disabled", undefined],
      // O gate de instância vive nos DOIS lados. Se a recusa antecipada passar
      // (por corrida: lista alterada entre a checagem e a reserva), quem nega é
      // fn_voip_call_reserve — e o código tem que chegar íntegro ao operador,
      // não virar `reserve_failed`.
      ["not_instance_member", undefined],
      ["operator_busy", undefined],
      ["daily_cap_reached", undefined],
      ["org_concurrency_reached", 5000],
    ] as const
  ) {
    const db = stubClient({
      tables: {
        voip_sessions: openSession,
        leads: orgLead,
        consent_records: grantedConsent,
        ...permissiveEngine,
      },
      rpc: allowingInstance(() => ({ ok: false, code, retry_after_ms: retry })),
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
        tc_session_id: "tc-sess",
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
        tc_session_id: "tc-sess",
        peer_phone: "554891005289",
        lead_id: null,
        status: "ended",
      }),
      ...permissiveEngine,
    },
    rpc: allowingInstance(() => null),
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
        tc_session_id: "tc-sess",
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
  // Por NOME: o choke consulta o gate de instância antes disto, então contar
  // todas as RPCs mediria a coisa errada.
  assertEquals(
    db.__calls.rpc.filter((c: Record<string, unknown>) => c.name === "fn_voip_call_reserve").length,
    0,
    "não deveria ter chamado fn_voip_call_reserve",
  );
});

// O arquivo inteiro não tinha UMA asserção sobre o cid — por isso a suíte ficou
// verde enquanto, em produção, todo token de chamada era recusado por formato.
Deno.test("o cid assinado é o id de rede, não o uuid da linha", async () => {
  await setupSigningKey();

  const db = stubClient({
    tables: {
      voip_sessions: openSession,
      leads: orgLead,
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
      leads: orgLead,
      consent_records: grantedConsent,
      ...permissiveEngine,
    },
    rpc: allowingInstance(() => ({ ok: true, call_id: CALL, token_jti: "jti-1" })),
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
