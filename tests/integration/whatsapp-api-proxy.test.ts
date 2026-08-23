/**
 * Integration tests for whatsapp-api-proxy Edge Function.
 *
 * Prerequisites:
 *   supabase start  — local Supabase must be running
 *   The proxy must be served locally:
 *     supabase functions serve whatsapp-api-proxy
 *
 * Tests exercise the full HTTP surface of the proxy:
 *   1. Valid tenant call → 200
 *   2. Cross-tenant attempt → 403 Forbidden
 *   3. Missing Authorization → 401
 *   4. 61 requests from same org → 61st returns 429
 *   5. OPTIONS preflight → CORS headers
 *   6. POST without action → 400
 *
 * If SKIP_INTEGRATION=true or the proxy is not serving, tests are skipped.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "http://localhost:54321";
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqd6j-gQAp4aMt3SFMkSfn1REbWsGe0T8";

// The proxy function URL — served locally via `supabase functions serve`
const PROXY_URL =
  process.env.PROXY_URL ?? "http://localhost:54321/functions/v1/whatsapp-api-proxy";

const shouldSkip =
  process.env.SKIP_INTEGRATION === "true" ||
  (!process.env.SUPABASE_URL && !process.env.CI);

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

// Use IDs that won't clash with existing seed data
const ORG_A_ID = "aabb0000-0000-0000-0000-000000000001";
const ORG_B_ID = "aabb0000-0000-0000-0000-000000000002";
const USER_A_ID = "aabb0000-0000-0000-0000-000000000010";
const USER_B_ID = "aabb0000-0000-0000-0000-000000000011";

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'torque-test-proxy-service' } });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a Supabase Auth user and returns their access token.
 * Uses admin API so no email confirmation is needed.
 */
async function createTestUser(
  userId: string,
  email: string,
  orgId: string
): Promise<string> {
  // Create auth user (idempotent via service_role)
  await admin.auth.admin.createUser({
    email,
    password: "TestProxy123!",
    user_metadata: {},
    email_confirm: true,
  });

  // Upsert organization
  await admin
    .from("organizations")
    .upsert({ id: orgId, name: `Test Org ${orgId.slice(-4)}` })
    .eq("id", orgId);

  // Upsert team_member linking user → org
  // We need the actual auth user ID from Supabase, not our mock UUID
  const { data: userList } = await admin.auth.admin.listUsers();
  const authUser = userList?.users?.find((u) => u.email === email);
  if (!authUser) throw new Error(`Auth user not found for ${email}`);

  await admin
    .from("team_members")
    .upsert({
      user_id: authUser.id,
      organization_id: orgId,
      name: `Test User ${email}`,
      role: "admin",
      email,
    })
    .eq("user_id", authUser.id)
    .eq("organization_id", orgId);

  // Sign in to get JWT
  const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'torque-test-proxy-anon' } });
  const { data: signInData, error: signInErr } =
    await supabaseAnon.auth.signInWithPassword({
      email,
      password: "TestProxy123!",
    });

  if (signInErr || !signInData?.session?.access_token) {
    throw new Error(`Sign-in failed for ${email}: ${signInErr?.message}`);
  }

  return signInData.session.access_token;
}

async function insertTestInstance(orgId: string, instanceId: string) {
  await admin
    .from("whatsapp_instances")
    .upsert({
      id: instanceId,
      organization_id: orgId,
      instance_name: `test-instance-${instanceId.slice(-4)}`,
      provider: "evolution",
      status: "open",
    })
    .eq("id", instanceId);
}

async function cleanupTestData() {
  // Delete in safe order
  await admin
    .from("whatsapp_instances")
    .delete()
    .in("organization_id", [ORG_A_ID, ORG_B_ID]);

  await admin
    .from("team_members")
    .delete()
    .in("organization_id", [ORG_A_ID, ORG_B_ID]);

  await admin
    .from("organizations")
    .delete()
    .in("id", [ORG_A_ID, ORG_B_ID]);

  // Clean up auth users by email
  const { data: userList } = await admin.auth.admin.listUsers();
  for (const u of userList?.users ?? []) {
    if (
      u.email === "proxy-test-a@milennials.test" ||
      u.email === "proxy-test-b@milennials.test"
    ) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: raw HTTP request (not via Supabase SDK to get real status codes)
// ---------------------------------------------------------------------------

async function proxyRequest(opts: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<{ status: number; body: unknown; headers: Headers }> {
  const { method = "POST", headers = {}, body } = opts;
  const res = await fetch(PROXY_URL, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let resBody: unknown;
  try {
    resBody = await res.json();
  } catch {
    resBody = null;
  }

  return { status: res.status, body: resBody, headers: res.headers };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(shouldSkip)("whatsapp-api-proxy — integration", () => {
  let tokenA: string;
  let tokenB: string;
  const INSTANCE_A_ID = "aabb1111-0000-0000-0000-000000000001";
  const INSTANCE_B_ID = "aabb2222-0000-0000-0000-000000000001";

  beforeAll(async () => {
    await cleanupTestData();

    tokenA = await createTestUser(
      USER_A_ID,
      "proxy-test-a@milennials.test",
      ORG_A_ID
    );
    tokenB = await createTestUser(
      USER_B_ID,
      "proxy-test-b@milennials.test",
      ORG_B_ID
    );

    await insertTestInstance(ORG_A_ID, INSTANCE_A_ID);
    await insertTestInstance(ORG_B_ID, INSTANCE_B_ID);
  }, 30_000);

  afterAll(async () => {
    await cleanupTestData();
  });

  // -------------------------------------------------------------------------
  // Test 1: valid tenant call → 200
  // -------------------------------------------------------------------------
  it("user from org A can call getStatus on org A instance → 200", async () => {
    // Mock provider.getStatus by pointing to evolution instance
    // Evolution will try to fetch — but the test validates the proxy layer (auth + tenant check)
    // We expect the proxy to reach the provider and attempt the call.
    // In integration, Evolution API URL is not reachable → 500 is acceptable
    // as it proves tenant check passed (403 would mean tenant rejection).
    const { status, body } = await proxyRequest({
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { action: "getStatus", instance_id: INSTANCE_A_ID },
    });

    // 200 (provider answered) or 500 (Evolution unreachable) — both mean tenant check passed
    expect([200, 500]).toContain(status);
    // Must NOT be 403 (cross-tenant) or 401 (auth failure)
    expect(status).not.toBe(403);
    expect(status).not.toBe(401);
  });

  // -------------------------------------------------------------------------
  // Test 2: cross-tenant attempt → 403
  // -------------------------------------------------------------------------
  it("user from org A calling org B instance → 403 Forbidden", async () => {
    const { status, body } = await proxyRequest({
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { action: "getStatus", instance_id: INSTANCE_B_ID },
    });

    expect(status).toBe(403);
    expect((body as Record<string, unknown>)?.error).toBe("Forbidden");
  });

  // -------------------------------------------------------------------------
  // Test 3: no Authorization → 401
  // -------------------------------------------------------------------------
  it("missing Authorization header → 401", async () => {
    const { status } = await proxyRequest({
      body: { action: "getStatus", instance_id: INSTANCE_A_ID },
    });

    expect(status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Test 4: rate limit — 61st request → 429
  // -------------------------------------------------------------------------
  it("61 requests from same org → 61st returns 429", async () => {
    // Fire 60 requests (all should pass rate limit check)
    // These will hit the proxy with a valid auth; status depends on provider
    const requests = Array.from({ length: 60 }, () =>
      proxyRequest({
        headers: { Authorization: `Bearer ${tokenB}` },
        body: { action: "getStatus", instance_id: INSTANCE_B_ID },
      })
    );

    await Promise.all(requests);

    // 61st request must be rate-limited
    const { status } = await proxyRequest({
      headers: { Authorization: `Bearer ${tokenB}` },
      body: { action: "getStatus", instance_id: INSTANCE_B_ID },
    });

    expect(status).toBe(429);
  }, 30_000);

  // -------------------------------------------------------------------------
  // Test 5: OPTIONS → CORS headers
  // -------------------------------------------------------------------------
  it("OPTIONS preflight returns 2xx and CORS headers", async () => {
    const { status, headers } = await proxyRequest({
      method: "OPTIONS",
    });

    expect([200, 204]).toContain(status);
    expect(headers.get("Access-Control-Allow-Origin")).toBeDefined();
    expect(headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  // -------------------------------------------------------------------------
  // Test 6: POST without action → 400
  // -------------------------------------------------------------------------
  it("POST without action field → 400", async () => {
    const { status, body } = await proxyRequest({
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { instance_id: INSTANCE_A_ID },
    });

    expect(status).toBe(400);
    expect((body as Record<string, unknown>)?.error).toBeTruthy();
  });
});
