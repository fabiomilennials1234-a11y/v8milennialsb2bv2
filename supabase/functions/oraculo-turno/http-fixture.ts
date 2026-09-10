/** External-service fixture. The deployed handler, auth, SDK, store and LLM adapter stay real. */
type Row = Record<string, unknown>;
export const ANA = "10000000-0000-4000-8000-000000000001";
export const ORG_A = "20000000-0000-4000-8000-000000000001";
export const ORG_B = "20000000-0000-4000-8000-000000000002";
export const CONVERSA_A = "30000000-0000-4000-8000-000000000001";
export const OWNER_TM = "40000000-0000-4000-8000-000000000001";
export const SEGREDO = "O contrato confidencial da organização A vale R$ 713.250.";

export class ExternalServices {
  tables: Record<string, Row[]> = {
    master_users: [], gestores: [], feature_permissions: [],
    team_members: [ORG_A, ORG_B].map((organization_id, i) => ({
      id: `40000000-0000-4000-8000-00000000000${i + 1}`, user_id: ANA,
      organization_id, role: "admin", is_active: true,
    })),
    organizations: [ORG_A, ORG_B].map((id) => ({ id, oraculo_daily_turn_limit: 25 })),
    oraculo_conversations: [{ id: CONVERSA_A, user_id: ANA, organization_id: ORG_A, summary: null }],
    oraculo_turns: [{ id: crypto.randomUUID(), conversation_id: CONVERSA_A,
      user_id: ANA, organization_id: ORG_A, role: "user", content: SEGREDO,
      created_at: "2026-01-01T00:00:00.000Z" }],
    oraculo_interview_questions: [],
    oraculo_operation_profile_entries: [],
  };
  modelRequests: Row[] = [];
  savedTurnResults: Row[] = [];
  features = { oraculo: true };
  failWrite: string | null = null;
  failRead: string | null = null;
  failReadMethod: string | null = null;
  currentUser = ANA;
  model: (body: Row) => Response | Promise<Response> = (body) => this.completion(
    JSON.stringify(body.messages).includes(SEGREDO) ? SEGREDO : "Sem informação confidencial.",
  );

  completion(content: string): Response {
    return Response.json({ model: "test-model", choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 } });
  }

  fetch: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.hostname === "openrouter.ai") {
      const body = await req.json();
      this.modelRequests.push(body);
      return this.model(body);
    }
    if (url.origin !== "http://127.0.0.1:54399") throw new Error(`Unexpected external request: ${url.origin}`);
    if (url.pathname === "/auth/v1/user") {
      return Response.json({ id: this.currentUser, aud: "authenticated", role: "authenticated" });
    }
    if (url.pathname === "/rest/v1/rpc/org_get_features_and_limits") {
      return Response.json({ plan_name: "test", features: this.features });
    }
    if (url.pathname === "/rest/v1/rpc/oraculo_metricas") return Response.json({ vendas: 1 });
    if (url.pathname === "/rest/v1/rpc/oraculo_meeting_profile_metrics") return Response.json({ reunioes_marcadas: 0, reunioes_realizadas: 0 });
    if (url.pathname === "/rest/v1/rpc/oraculo_get_profile_context") return Response.json(null);
    if (url.pathname === "/rest/v1/rpc/oraculo_conversa_detalhe") {
      const body = await req.json();
      return Response.json(body.p_team_member_id === OWNER_TM
        ? [{ papel: "lead", conteudo: SEGREDO }]
        : []);
    }
    if (url.pathname === "/rest/v1/rpc/oraculo_save_turn") {
      const body = await req.json();
      this.savedTurnResults.push(body.p_result);
      const conversation = this.tables.oraculo_conversations.find((row) =>
        row.id === body.p_conversation_id && row.organization_id === body.p_organization_id && row.user_id === body.p_user_id);
      if (!conversation) return Response.json({ code: "42501", message: "Conversa indisponível" }, { status: 403 });
      if ((conversation.last_message_at ?? null) !== body.p_expected_last_message_at) {
        return Response.json({ code: "PT409", message: "Conversa alterada" }, { status: 409 });
      }
      if (this.failWrite) return Response.json({ code: "08006", message: "storage unavailable" }, { status: 503 });
      const now = Math.max(Date.now(), Date.parse(String(conversation.last_message_at ?? 0)) + 2 || 0);
      const base = { conversation_id: conversation.id, organization_id: conversation.organization_id, user_id: conversation.user_id };
      this.tables.oraculo_turns.push(
        { ...base, id: crypto.randomUUID(), role: "user", content: body.p_question, created_at: new Date(now).toISOString() },
        { ...base, id: crypto.randomUUID(), role: "assistant", content: body.p_result.text, latency_ms: body.p_result.telemetry.latencyMs, created_at: new Date(now + 1).toISOString() },
      );
      Object.assign(conversation, { summary: body.p_summary, last_message_at: new Date(now + 1).toISOString() });
      return new Response(null, { status: 204 });
    }
    const table = url.pathname.replace("/rest/v1/", "");
    const rows = this.tables[table];
    if (!rows) throw new Error(`Unexpected external resource: ${url.pathname}`);
    if ((req.method === "GET" || req.method === "HEAD") && this.failRead === table &&
      (!this.failReadMethod || req.method === this.failReadMethod)) {
      return Response.json({ message: "storage unavailable", code: "08006" }, { status: 503 });
    }
    const matches = (row: Row) => [...url.searchParams].every(([key, filter]) => {
      if (filter.startsWith("eq.")) return String(row[key]) === filter.slice(3);
      if (filter.startsWith("gt.")) return String(row[key]) > filter.slice(3);
      if (filter.startsWith("gte.")) return String(row[key]) >= filter.slice(4);
      if (filter === "is.null") return row[key] == null;
      return true;
    });
    let selected = rows.filter(matches);
    if (req.method === "POST" || req.method === "PATCH") {
      if (this.failWrite === table) return Response.json({ message: "storage unavailable", code: "08006" }, { status: 503 });
      const body = await req.json();
      if (req.method === "POST") {
        selected = (Array.isArray(body) ? body : [body]).map((row) => ({
          id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row,
        }));
        rows.push(...selected);
      } else selected.forEach((row) => Object.assign(row, body));
      if (!req.headers.get("prefer")?.includes("return=representation")) return new Response(null, { status: 204 });
    }
    if (req.method === "HEAD") return new Response(null, { headers: { "content-range": `0-0/${selected.length}` } });
    const order = url.searchParams.get("order");
    if (order) {
      const [key, direction] = order.split(".");
      selected.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (direction === "desc" ? -1 : 1));
    }
    const limit = Number(url.searchParams.get("limit") ?? selected.length);
    selected = selected.slice(0, limit);
    return Response.json(req.headers.get("accept")?.includes("application/vnd.pgrst.object+json")
      ? selected[0] ?? null : selected);
  };
}

let imports = 0;
export async function withOracle(
  run: (services: ExternalServices, post: (body: Row) => Promise<Response>) => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  const originalServe = Deno.serve;
  const env = { SUPABASE_URL: "http://127.0.0.1:54399", SUPABASE_SERVICE_ROLE_KEY: "test-service",
    ANON_KEY_2: "test-anon", OPENROUTER_API_KEY: "test-model-key" };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, Deno.env.get(key)]));
  const services = new ExternalServices();
  let handler: (req: Request) => Promise<Response>;
  // Only the hosting runtime is replaced; invoke the actual deployed HTTP entry point.
  Deno.serve = ((callback: typeof handler) => { handler = callback; return {}; }) as typeof Deno.serve;
  globalThis.fetch = services.fetch;
  Object.entries(env).forEach(([key, value]) => Deno.env.set(key, value));
  try {
    await import(`./index.ts?http-test=${imports++}`);
    await run(services, (body) => handler(new Request("http://localhost/functions/v1/oraculo-turno", {
      method: "POST", headers: { authorization: "Bearer test-user", "content-type": "application/json" },
      body: JSON.stringify(body),
    })));
  } finally {
    globalThis.fetch = originalFetch;
    Deno.serve = originalServe;
    Object.entries(previous).forEach(([key, value]) => value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value));
  }
}
