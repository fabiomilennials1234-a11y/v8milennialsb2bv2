import { assert, assertEquals } from "@std/assert";
import type { Caller } from "../_shared/voip/caller.ts";
import { createSession, forwardSessionAction, resolveSessionCap, voiceFeatureOn } from "./index.ts";

Deno.test("teto vem da organização, não de constante", () => {
  assertEquals(resolveSessionCap({ voice_sessions_cap: 3 }), 3);
});

Deno.test("teto 0 significa nenhum número de voz", () => {
  assertEquals(resolveSessionCap({ voice_sessions_cap: 0 }), 0);
});

Deno.test("organização sem linha cai no padrão 10", () => {
  assertEquals(resolveSessionCap(null), 10);
});

Deno.test("feature ausente no plano é desligada, não liberada", () => {
  assertEquals(voiceFeatureOn({}), false);
  assertEquals(voiceFeatureOn({ voice_calls: false }), false);
  assertEquals(voiceFeatureOn({ voice_calls: true }), true);
});

// ─── Fiação do handler ───────────────────────────────────────────────────────
//
// As quatro funções acima são puras; nada garante que o handler as CHAMA na
// ordem certa, que os updates de `voice_calls_enabled` carregam o filtro de
// organização, ou que os dois ramos de desligamento disparam. Os testes
// abaixo exercitam `createSession`/`forwardSessionAction` de ponta a ponta
// com um `db` falso — sem rede, sem VPS real, sem chave de assinatura de
// verdade (a barreira do choke reprova qualquer arquivo fora de
// `_shared/voip/` que cite o nome da variável de ambiente da chave).

interface RecordedCall {
  table: string;
  ops: Array<{ op: string; args: unknown[] }>;
}

type Script = Record<string, { data?: unknown; error?: unknown; count?: number }>;

/**
 * Fake mínimo do query builder do supabase-js. `.from(table)` abre uma cadeia
 * que registra cada chamada em `ops`; o terminal — explícito
 * (`.maybeSingle()`/`.insert()`/`.upsert()`) ou implícito (`await` direto no
 * builder, como a contagem e os updates) — resolve olhando `script` pela
 * chave `table:terminal`. Chave ausente cai num `{ data: null, error: null }`
 * neutro: suficiente para os ramos que o teste em questão não exercita de
 * propósito.
 */
function fakeDb(script: Script = {}) {
  const calls: RecordedCall[] = [];

  function chain(table: string) {
    const ops: RecordedCall["ops"] = [];
    calls.push({ table, ops });
    const record = (op: string, args: unknown[]) => ops.push({ op, args });
    const resolve = (terminal: string) =>
      Promise.resolve(script[`${table}:${terminal}`] ?? { data: null, error: null });

    // deno-lint-ignore no-explicit-any
    const builder: any = {
      select(...a: unknown[]) {
        record("select", a);
        return builder;
      },
      eq(...a: unknown[]) {
        record("eq", a);
        return builder;
      },
      neq(...a: unknown[]) {
        record("neq", a);
        return builder;
      },
      order(...a: unknown[]) {
        record("order", a);
        return builder;
      },
      maybeSingle() {
        record("maybeSingle", []);
        return resolve("maybeSingle");
      },
      insert(...a: unknown[]) {
        record("insert", a);
        return resolve("insert");
      },
      upsert(...a: unknown[]) {
        record("upsert", a);
        return resolve("upsert");
      },
      update(...a: unknown[]) {
        record("update", a);
        return builder;
      },
      delete(...a: unknown[]) {
        record("delete", a);
        return builder;
      },
      // Cobre `await db.from(...).update(...).eq().eq()` sem terminal
      // explícito — mesmo caso da contagem de sessões e dos dois updates de
      // `voice_calls_enabled`.
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        const terminal = ops.some((o) => o.op === "update")
          ? "update"
          : ops.some((o) => o.op === "delete")
          ? "delete"
          : "select";
        return resolve(terminal).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  return {
    calls,
    from(table: string) {
      return chain(table);
    },
    rpc(name: string, args: unknown) {
      calls.push({ table: `rpc:${name}`, ops: [{ op: "rpc", args: [args] }] });
      return Promise.resolve(script[`rpc:${name}`] ?? { data: null, error: null });
    },
  };
}

/** `Caller` é opaco (só `resolveCaller()` fabrica um) — o cast é o escape hatch de teste, não uma forma de produção de contorná-lo. */
function fakeCaller(overrides: Partial<{ orgId: string; userId: string }> = {}): Caller {
  return {
    orgId: "org-1",
    userId: "user-1",
    teamMemberId: "member-1",
    role: "admin",
    isMaster: false,
    isGestor: false,
    ...overrides,
  } as unknown as Caller;
}

/** `signAdminToken`/`callVps` reais exigem chave Ed25519 e rede — os fakes fecham o ciclo sem nenhum dos dois. */
// deno-lint-ignore no-explicit-any
function fakeVoipDeps(callVpsResult: any = { ok: true, status: 200, data: { session: { id: "tc-sess-fake" } } }) {
  const vpsCalls: unknown[][] = [];
  return {
    vpsCalls,
    deps: {
      // deno-lint-ignore no-explicit-any
      signAdminToken: async (...args: any[]) => {
        void args;
        return { token: "fake-token", jti: "fake-jti", expiresAt: 0 };
      },
      // deno-lint-ignore no-explicit-any
      callVps: async (...args: any[]): Promise<any> => {
        vpsCalls.push(args);
        return callVpsResult;
      },
    },
  };
}

function findCall(calls: RecordedCall[], table: string, op: string): RecordedCall | undefined {
  return calls.find((c) => c.table === table && c.ops.some((o) => o.op === op));
}

function hasOpWithArgs(call: RecordedCall | undefined, op: string, args: unknown[]): boolean {
  return !!call?.ops.some((o) => o.op === op && JSON.stringify(o.args) === JSON.stringify(args));
}

Deno.test("createSession: feature desligada recusa 403 e não chama a VPS nem escreve", async () => {
  const db = fakeDb({
    "whatsapp_instances:maybeSingle": { data: { id: "inst-1", organization_id: "org-1" } },
    "organizations:maybeSingle": { data: { voice_sessions_cap: 10 } },
    "rpc:org_get_features_and_limits": { data: { features: { voice_calls: false }, plan_name: "starter" } },
  });
  const { deps, vpsCalls } = fakeVoipDeps();

  const res = await createSession(db, fakeCaller(), { whatsapp_instance_id: "inst-1" }, {}, deps);
  const body = await res.json();

  assertEquals(res.status, 403);
  assertEquals(body.code, "voice_feature_off");
  assertEquals(vpsCalls.length, 0, "VPS não deveria ser chamada quando a feature está desligada");
  assertEquals(findCall(db.calls, "voip_sessions", "insert"), undefined, "não deveria inserir sessão órfã sem a feature");
});

Deno.test("createSession: teto atingido recusa 409 e não chama a VPS nem escreve", async () => {
  const db = fakeDb({
    "whatsapp_instances:maybeSingle": { data: { id: "inst-1", organization_id: "org-1" } },
    "organizations:maybeSingle": { data: { voice_sessions_cap: 1 } },
    "rpc:org_get_features_and_limits": { data: { features: { voice_calls: true }, plan_name: "pro" } },
    "voip_sessions:select": { count: 1 },
  });
  const { deps, vpsCalls } = fakeVoipDeps();

  const res = await createSession(db, fakeCaller(), { whatsapp_instance_id: "inst-1" }, {}, deps);
  const body = await res.json();

  assertEquals(res.status, 409);
  assertEquals(body.code, "session_cap_reached");
  assertEquals(vpsCalls.length, 0, "VPS não deveria ser chamada quando o teto já foi atingido");
  assertEquals(findCall(db.calls, "voip_sessions", "insert"), undefined, "não deveria inserir sessão além do teto");
});

Deno.test("createSession: sucesso liga voice_calls_enabled=true filtrado por organização", async () => {
  const db = fakeDb({
    "whatsapp_instances:maybeSingle": { data: { id: "inst-1", organization_id: "org-1" } },
    "organizations:maybeSingle": { data: { voice_sessions_cap: 10 } },
    "rpc:org_get_features_and_limits": { data: { features: { voice_calls: true }, plan_name: "pro" } },
    "voip_sessions:select": { count: 0 },
    "voip_sessions:insert": { error: null },
  });
  const { deps } = fakeVoipDeps({ ok: true, status: 200, data: { session: { id: "tc-sess-1" } } });

  const res = await createSession(db, fakeCaller(), { whatsapp_instance_id: "inst-1" }, {}, deps);
  assertEquals(res.status, 200);

  const update = findCall(db.calls, "whatsapp_instances", "update");
  assert(hasOpWithArgs(update, "update", [{ voice_calls_enabled: true }]), "esperava update({voice_calls_enabled:true})");
  assert(hasOpWithArgs(update, "eq", ["organization_id", "org-1"]), "update tem que filtrar por organization_id");
});

Deno.test("logoutSession: desliga voice_calls_enabled=false filtrado por organização", async () => {
  const db = fakeDb({
    "voip_sessions:maybeSingle": { data: { whatsapp_instance_id: "inst-1" } },
  });
  const { deps } = fakeVoipDeps({ ok: true, status: 200, data: {} });

  const res = await forwardSessionAction(db, fakeCaller(), "logoutSession", "tc-sess-1", {}, {}, deps);
  assertEquals(res.status, 200);

  const update = findCall(db.calls, "whatsapp_instances", "update");
  assert(hasOpWithArgs(update, "update", [{ voice_calls_enabled: false }]), "esperava update({voice_calls_enabled:false})");
  assert(hasOpWithArgs(update, "eq", ["organization_id", "org-1"]), "update tem que filtrar por organization_id");
});

Deno.test("deleteSession: desliga voice_calls_enabled=false filtrado por organização", async () => {
  const db = fakeDb({
    "voip_sessions:maybeSingle": { data: { whatsapp_instance_id: "inst-1" } },
  });
  const { deps } = fakeVoipDeps({ ok: true, status: 200, data: {} });

  const res = await forwardSessionAction(db, fakeCaller(), "deleteSession", "tc-sess-1", {}, {}, deps);
  assertEquals(res.status, 200);

  const update = findCall(db.calls, "whatsapp_instances", "update");
  assert(hasOpWithArgs(update, "update", [{ voice_calls_enabled: false }]), "esperava update({voice_calls_enabled:false})");
  assert(hasOpWithArgs(update, "eq", ["organization_id", "org-1"]), "update tem que filtrar por organization_id");
});
