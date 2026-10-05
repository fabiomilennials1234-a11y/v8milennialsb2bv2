// @vitest-environment node
/**
 * whatsapp-health-monitor — leitura de secrets em lote.
 *
 * Antes: uma leitura de whatsapp_instance_secrets POR instância dentro do loop
 * (~139 instâncias × ~7 execuções/h ≈ 989 leituras/h). Agora: uma leitura
 * `.in('instance_id', ids)` por execução, com o mesmo comportamento por
 * instância (token ausente → probe_failed; token presente → sonda Uazapi).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase } from "../helpers/supabase-mock";

const hoist = vi.hoisted(() => {
  const envStore: Record<string, string> = {};
  const capture = { handler: null as null | ((req: Request) => Promise<Response>) };
  (globalThis as any).Deno = {
    env: {
      get: (k: string) => envStore[k] ?? undefined,
      set: (k: string, v: string) => { envStore[k] = v; },
      toObject: () => ({ ...envStore }),
    },
    serve: (h: any) => { capture.handler = h; return { finished: Promise.resolve() }; },
  };
  return { capture, probe: vi.fn() };
});

let activeSb: any = null;
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({ createClient: () => activeSb }));
vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({ withErrorBoundary: (_n: string, h: any) => h }));
vi.mock("../../supabase/functions/_shared/cors.ts", () => ({ getCorsHeaders: () => ({}) }));
vi.mock("../../supabase/functions/_shared/security-headers.ts", () => ({ withSecurityHeaders: (h: any) => h }));
vi.mock("../../supabase/functions/_shared/auth.ts", () => ({ timingSafeCompare: (a: string, b: string) => a === b }));
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({ logRuntime: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../supabase/functions/_shared/uazapi-inbound-window.ts", () => ({ countUazapiInboundWindow: hoist.probe }));

import "../../supabase/functions/whatsapp-health-monitor/index";

const CRON = "test-cron-secret";
const env = (globalThis as any).Deno.env;

function instance(id: string) {
  return { id, organization_id: "org-1", instance_name: `Caixa ${id}`, provider: "uazapi", status: "connected", session_dead_since: null };
}

function setup(instances: unknown[], secrets: unknown[], opts: { secretsError?: boolean } = {}) {
  const mock = createMockSupabase();
  mock.mockTable("whatsapp_instances", instances as any);
  mock.mockTable("whatsapp_instance_secrets", secrets as any);
  mock.mockTable("whatsapp_messages", []);
  mock.mockTable("whatsapp_health_checks", []);
  if (opts.secretsError) mock.mockSelectError("whatsapp_instance_secrets", { code: "XX000", message: "boom" });
  const fromCalls: string[] = [];
  const from = mock.sb.from;
  mock.sb.from = (table: string) => { fromCalls.push(table); return from(table); };
  activeSb = mock.sb;
  return { ...mock, fromCalls };
}

async function invoke(): Promise<any> {
  const res = await hoist.capture.handler!(new Request("https://edge/whatsapp-health-monitor", {
    method: "POST", headers: { "x-cron-secret": CRON },
  }));
  return res.json();
}

describe("whatsapp-health-monitor secrets em lote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.set("SUPABASE_URL", "https://test.supabase.co");
    env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role");
    env.set("CRON_SECRET", CRON);
    env.set("UAZAPI_BASE_URL", "https://uaz.test");
    hoist.probe.mockResolvedValue(0);
  });

  it("lê whatsapp_instance_secrets uma única vez por execução, qualquer que seja o número de instâncias", async () => {
    const { fromCalls } = setup(
      [instance("a"), instance("b"), instance("c")],
      [
        { instance_id: "a", uazapi_token: "fixture-tok-a" },
        { instance_id: "b", uazapi_token: "fixture-tok-b" },
        { instance_id: "c", uazapi_token: "fixture-tok-c" },
        { instance_id: "outra", uazapi_token: "fixture-tok-x" },
      ],
    );
    const summary = await invoke();
    expect(summary.checked).toBe(3);
    expect(fromCalls.filter((t) => t === "whatsapp_instance_secrets")).toHaveLength(1);
    // Cada instância é sondada com o PRÓPRIO token.
    expect(hoist.probe.mock.calls.map((c) => c[1]).sort()).toEqual(["fixture-tok-a", "fixture-tok-b", "fixture-tok-c"]);
  });

  it("instância sem token continua probe_failed com a mesma nota; as outras seguem", async () => {
    const { getInserted } = setup(
      [instance("a"), instance("b")],
      [{ instance_id: "a", uazapi_token: "fixture-tok-a" }, { instance_id: "b", uazapi_token: null }],
    );
    const summary = await invoke();
    expect(summary.probe_failed).toBe(1);
    expect(summary.healthy).toBe(1);
    const failed = getInserted("whatsapp_health_checks").filter((r) => r.status === "probe_failed");
    expect(failed).toEqual([expect.objectContaining({ instance_id: "b", notes: "uazapi_token missing in whatsapp_instance_secrets" })]);
  });

  it("falha na leitura em lote → todas probe_failed (mesmo efeito da leitura por linha que falhava)", async () => {
    setup([instance("a"), instance("b")], [], { secretsError: true });
    const summary = await invoke();
    expect(summary.probe_failed).toBe(2);
    expect(hoist.probe).not.toHaveBeenCalled();
  });

  it("sem instâncias conectadas → nenhuma leitura de secrets", async () => {
    const { fromCalls } = setup([], []);
    const summary = await invoke();
    expect(summary.checked).toBe(0);
    expect(fromCalls).not.toContain("whatsapp_instance_secrets");
  });
});
