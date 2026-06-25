import { assertEquals, assertThrows } from "@std/assert";
import { loadConfig } from "./config.ts";

const OK_ENV: Record<string, string> = {
  SUPABASE_URL: "https://jsjsmuncfkbsbzqzqhfq.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  CRM_MCP_JWT_SIGNING_KEY: '{"kty":"EC","crv":"P-256","d":"x","x":"y","z":"z"}',
  CRM_MCP_JWT_KID: "kid-1",
};

Deno.test("loadConfig: parses a valid env and derives the project ref from the URL", () => {
  const cfg = loadConfig(OK_ENV);
  assertEquals(cfg.supabaseUrl, OK_ENV.SUPABASE_URL);
  assertEquals(cfg.projectRef, "jsjsmuncfkbsbzqzqhfq");
  assertEquals(cfg.jwtKid, "kid-1");
  assertEquals(cfg.patPepper, undefined);
});

Deno.test("loadConfig: picks up an optional pepper", () => {
  const cfg = loadConfig({ ...OK_ENV, CRM_MCP_PAT_PEPPER: "pep" });
  assertEquals(cfg.patPepper, "pep");
});

Deno.test("loadConfig: throws naming each missing required var", () => {
  for (
    const k of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "CRM_MCP_JWT_SIGNING_KEY", "CRM_MCP_JWT_KID"]
  ) {
    const env = { ...OK_ENV };
    delete env[k];
    assertThrows(() => loadConfig(env), Error, k);
  }
});

Deno.test("loadConfig: ASSERT-ABSENT — boot refuses if any ops/service_role secret is present (H3)", () => {
  for (
    const k of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "MCP_MASTER_EMAIL",
      "MCP_MASTER_PASSWORD",
      "MCP_GATEWAY_SECRET",
    ]
  ) {
    assertThrows(() => loadConfig({ ...OK_ENV, [k]: "leaked" }), Error, "forbidden ops secret");
  }
});

Deno.test("loadConfig: an empty forbidden var (set but blank) does not trip the guard", () => {
  // Blank/whitespace is treated as absent — only a real value is a misconfiguration.
  const cfg = loadConfig({ ...OK_ENV, SUPABASE_SERVICE_ROLE_KEY: "   " });
  assertEquals(cfg.projectRef, "jsjsmuncfkbsbzqzqhfq");
});
