import { afterEach, expect, it, vi } from "vitest";
import { clearDenoEnv, setDenoEnv } from "../helpers/deno-mock";

afterEach(() => {
  vi.unstubAllGlobals();
  clearDenoEnv();
  vi.resetModules();
});

async function loadWorker() {
  vi.resetModules();
  setDenoEnv("SUPABASE_URL", "https://db.test");
  setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service");
  setDenoEnv("CRON_SECRET", "test-cron");
  let handler: ((request: Request) => Promise<Response>) | undefined;
  vi.stubGlobal("Deno", {
    ...globalThis.Deno,
    serve: (callback: typeof handler) => { handler = callback; },
  });
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const data = String(input).includes("/auth/v1/user")
      ? { id: "authenticated-user" }
      : [];
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  await import("../../supabase/functions/process-workflow-executions/index.ts");
  if (!handler) throw new Error("Worker did not register its handler");
  return { handler, fetch };
}

it("authenticates the cron probe without claiming, reconciling or sending work", async () => {
  const { handler, fetch } = await loadWorker();
  const response = await handler(new Request("https://edge.test/worker", {
    method: "POST",
    headers: { "x-cron-secret": "test-cron", "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "noop_probe" }),
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ mode: "noop_probe", healthy: true });
  expect(fetch).not.toHaveBeenCalled();
});

it.each([{}, { "x-cron-secret": "wrong" }, { authorization: "Bearer user-token" }])(
  "rejects a probe without valid cron authentication: %j", async (headers) => {
    const { handler, fetch } = await loadWorker();
    const response = await handler(new Request("https://edge.test/worker", {
      method: "POST", headers, body: JSON.stringify({ mode: "noop_probe" }),
    }));
    expect(response.status).toBe(401);
    expect(fetch.mock.calls.every(([url]) => String(url).includes("/auth/v1/user"))).toBe(true);
  },
);

it("continues recovering and claiming work for ordinary cron calls", async () => {
  const { handler, fetch } = await loadWorker();
  const response = await handler(new Request("https://edge.test/worker", {
    method: "POST", headers: { "x-cron-secret": "test-cron" }, body: "{}",
  }));
  expect(response.status).toBe(200);
  const urls = fetch.mock.calls.map(([url]) => String(url));
  expect(urls.some(url => url.includes("reconcile_workflow_button_questions"))).toBe(true);
  expect(urls.some(url => url.includes("claim_workflow_executions"))).toBe(true);
});
