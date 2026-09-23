import { afterEach, expect, it, vi } from "vitest";
import { clearDenoEnv, setDenoEnv } from "../helpers/deno-mock";

afterEach(() => { vi.unstubAllGlobals(); clearDenoEnv(); vi.resetModules(); });

async function loadHandler(options: { valid?: boolean; email?: string | null; pending?: boolean } = {}) {
  vi.resetModules();
  setDenoEnv("SUPABASE_URL", "https://db.test");
  setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service");
  setDenoEnv("SUPABASE_ANON_KEY", "test-anon");
  let handler: ((req: Request) => Promise<Response>) | undefined;
  vi.stubGlobal("Deno", { ...globalThis.Deno, serve: (callback: typeof handler) => { handler = callback; } });
  const requests: Request[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    const url = new URL(request.url);
    if (url.pathname === "/auth/v1/user") {
      expect(request.headers.get("authorization")).toBe("Bearer valid-token");
      if (options.valid === false) return Response.json({ message: "invalid JWT", code: "bad_jwt" }, { status: 401 });
      return Response.json({ id: "authenticated-user", email: options.email === undefined ? "Member@Example.test" : options.email });
    }
    if (url.pathname.endsWith("/pending_org_invites") && request.method === "GET") {
      expect(url.searchParams.get("email")).toBe("eq.member@example.test");
      return Response.json(options.pending ? [{ id: "invite-1", organization_id: "invited-org", role: "sdr", metric_type: "meetings" }] : []);
    }
    if (url.pathname.endsWith("/team_members") && request.method === "GET") return Response.json([]);
    return new Response(null, { status: 204 });
  });
  await import("../../supabase/functions/attach-to-org-by-pending-invite/index.ts");
  if (!handler) throw new Error("Handler not registered");
  return { handler, requests };
}

function request(token = "valid-token") {
  return new Request("https://edge.test/attach", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify({ organization_id: "attacker-org", user_id: "attacker-user", email: "attacker@example.test" }) });
}

it("accepts the real supabase-js v2 getUser envelope and returns no pending invite", async () => {
  const { handler, requests } = await loadHandler();
  const response = await handler(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, attached: false });
  expect(requests.filter(r => r.method !== "GET")).toHaveLength(0);
});

it("uses only authenticated identity and stored invitation for organization attachment", async () => {
  const { handler, requests } = await loadHandler({ pending: true });
  const response = await handler(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ attached: true, organization_id: "invited-org" });
  const insert = requests.find(r => r.method === "POST" && r.url.includes("/team_members"));
  expect(insert).toBeDefined();
  expect(await insert!.json()).toMatchObject({ user_id: "authenticated-user", organization_id: "invited-org", email: "Member@Example.test" });
  expect(requests.some(r => r.method === "DELETE" && r.url.includes("pending_org_invites"))).toBe(true);
});

it.each([{ valid: false }, { email: null }])("rejects invalid identity before any service-role data access: %j", async options => {
  const { handler, requests } = await loadHandler(options);
  const response = await handler(request());
  expect(response.status).toBe(401);
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toContain("/auth/v1/user");
});

it("rejects a missing bearer without calling auth or database", async () => {
  const { handler, requests } = await loadHandler();
  expect((await handler(request(""))).status).toBe(401);
  expect(requests).toHaveLength(0);
});
