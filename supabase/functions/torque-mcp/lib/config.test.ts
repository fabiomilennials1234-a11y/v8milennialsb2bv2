import { assertEquals, assertThrows } from "@std/assert";
import { loadConfig } from "./config.ts";

const validEnv = {
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "anon-key",
  MCP_GATEWAY_SECRET: "gw-secret",
  MCP_MASTER_EMAIL: "mcp-ops@test.com",
  MCP_MASTER_PASSWORD: "Test123!@#",
};

Deno.test("loadConfig — valid env returns parsed config with safe defaults", () => {
  const cfg = loadConfig(validEnv);
  assertEquals(cfg.supabaseUrl, "http://localhost:54321");
  assertEquals(cfg.supabaseAnonKey, "anon-key");
  assertEquals(cfg.gatewaySecret, "gw-secret");
  assertEquals(cfg.masterEmail, "mcp-ops@test.com");
  assertEquals(cfg.masterPassword, "Test123!@#");
  // safety defaults: dev target, mutations OFF
  assertEquals(cfg.project, "dev");
  assertEquals(cfg.allowMutations, false);
});

Deno.test("loadConfig — missing required key throws naming the key", () => {
  const { MCP_GATEWAY_SECRET: _omit, ...partial } = validEnv;
  assertThrows(() => loadConfig(partial), Error, "MCP_GATEWAY_SECRET");
});

Deno.test("loadConfig — opt-in flags require exact values", () => {
  const prodMutating = loadConfig({
    ...validEnv,
    TORQUE_MCP_PROJECT: "prod",
    TORQUE_MCP_ALLOW_MUTATIONS: "true",
    SUPABASE_SERVICE_ROLE_KEY: "svc-key",
  });
  assertEquals(prodMutating.project, "prod");
  assertEquals(prodMutating.allowMutations, true);
  assertEquals(prodMutating.serviceRoleKey, "svc-key");

  const fuzzy = loadConfig({
    ...validEnv,
    TORQUE_MCP_PROJECT: "production",
    TORQUE_MCP_ALLOW_MUTATIONS: "1",
  });
  assertEquals(fuzzy.project, "dev");
  assertEquals(fuzzy.allowMutations, false);
});

Deno.test("loadConfig — mutations on without service_role key throws", () => {
  assertThrows(
    () =>
      loadConfig({
        ...validEnv,
        TORQUE_MCP_PROJECT: "dev",
        TORQUE_MCP_ALLOW_MUTATIONS: "true",
      }),
    Error,
    "SUPABASE_SERVICE_ROLE_KEY",
  );
});

Deno.test("loadConfig — mutations on with blank service_role key throws", () => {
  assertThrows(
    () =>
      loadConfig({
        ...validEnv,
        TORQUE_MCP_PROJECT: "dev",
        TORQUE_MCP_ALLOW_MUTATIONS: "true",
        SUPABASE_SERVICE_ROLE_KEY: "   ",
      }),
    Error,
    "SUPABASE_SERVICE_ROLE_KEY",
  );
});

Deno.test("loadConfig — mutations on without explicit project throws", () => {
  assertThrows(
    () =>
      loadConfig({
        ...validEnv,
        TORQUE_MCP_ALLOW_MUTATIONS: "true",
        SUPABASE_SERVICE_ROLE_KEY: "svc-key",
      }),
    Error,
    "TORQUE_MCP_PROJECT",
  );
});

Deno.test("loadConfig — mutations off ignores missing service_role + project", () => {
  const cfg = loadConfig(validEnv);
  assertEquals(cfg.allowMutations, false);
  assertEquals(cfg.serviceRoleKey, "");
  assertEquals(cfg.project, "dev");
});
