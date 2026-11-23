import { assertEquals, assertThrows } from "@std/assert";
import { loadConfig, PRIVILEGED_ENV, scrubPrivilegedEnv } from "./config.ts";

const OK_ENV: Record<string, string> = {
  SUPABASE_URL: "https://jsjsmuncfkbsbzqzqhfq.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  CRM_MCP_JWT_SIGNING_KEY: '{"kty":"EC","crv":"P-256","d":"x","x":"y","z":"z"}',
  CRM_MCP_JWT_KID: "kid-1",
};

/** A Map-backed stand-in for Deno.env. `sticky` keys ignore delete (a hostile runtime). */
function fakeEnv(initial: Record<string, string>, sticky: string[] = []) {
  const m = new Map(Object.entries(initial));
  return {
    get: (k: string) => m.get(k),
    delete: (k: string) => {
      if (!sticky.includes(k)) m.delete(k);
    },
    has: (k: string) => m.has(k),
  };
}

Deno.test("loadConfig: parses a valid env and derives the project ref from the URL", () => {
  const cfg = loadConfig(OK_ENV);
  assertEquals(cfg.supabaseUrl, OK_ENV.SUPABASE_URL);
  assertEquals(cfg.projectRef, "jsjsmuncfkbsbzqzqhfq");
  assertEquals(cfg.jwtKid, "kid-1");
  assertEquals(cfg.supabaseAnonKey, "anon-key");
  assertEquals(cfg.patPepper, undefined);
});

Deno.test("loadConfig: anon key follows the project's rotation precedence (ANON_KEY_2 first)", () => {
  assertEquals(loadConfig({ ...OK_ENV, ANON_KEY: "a1" }).supabaseAnonKey, "a1");
  assertEquals(loadConfig({ ...OK_ENV, ANON_KEY: "a1", ANON_KEY_2: "a2" }).supabaseAnonKey, "a2");
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

Deno.test("loadConfig: project-wide privileged secrets do not block the boot (they cannot be removed)", () => {
  // Supabase secrets are project-wide: torque-mcp's MCP_MASTER_* reach crm-mcp in production.
  for (const k of PRIVILEGED_ENV) {
    assertEquals(loadConfig({ ...OK_ENV, [k]: "present" }).projectRef, "jsjsmuncfkbsbzqzqhfq");
  }
});

Deno.test("scrubPrivilegedEnv: removes what the runtime lets go, keeps the rest of the env", () => {
  const env = fakeEnv({
    ...OK_ENV,
    SUPABASE_SERVICE_ROLE_KEY: "srk",
    SUPABASE_DB_URL: "postgres://x",
    MCP_MASTER_PASSWORD: "pw",
  });
  assertEquals(scrubPrivilegedEnv(env), {
    removed: ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL", "MCP_MASTER_PASSWORD"],
    kept: [],
  });
  assertEquals(env.has("SUPABASE_SERVICE_ROLE_KEY"), false);
  assertEquals(env.get("SUPABASE_URL"), OK_ENV.SUPABASE_URL);
});

Deno.test("scrubPrivilegedEnv: reports (never throws on) what the runtime keeps — Supabase's case", () => {
  const env = fakeEnv({ ...OK_ENV, SUPABASE_SERVICE_ROLE_KEY: "srk" }, [
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);
  assertEquals(scrubPrivilegedEnv(env), { removed: [], kept: ["SUPABASE_SERVICE_ROLE_KEY"] });
});

Deno.test("source invariant: no crm-mcp/create-pat module outside lib/config.ts names a privileged secret", async () => {
  // The runtime keeps these in the env (project-wide secrets), so THIS is the guarantee: no
  // module ever reads them by name, and no client is built from them.
  const roots = [new URL("../", import.meta.url), new URL("../../create-pat/", import.meta.url)];
  const offenders: string[] = [];
  async function walk(dir: URL) {
    for await (const e of Deno.readDir(dir)) {
      const u = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
      if (e.isDirectory) await walk(u);
      else if (
        e.name.endsWith(".ts") && !u.pathname.endsWith("/lib/config.ts") &&
        !e.name.endsWith(".test.ts")
      ) {
        const src = await Deno.readTextFile(u);
        if (
          /SERVICE_ROLE|SUPABASE_DB_URL|SUPABASE_SECRET_KEYS|MCP_MASTER|MCP_GATEWAY|serviceDb\s*:\s*[^u\s]/
            .test(src)
        ) {
          offenders.push(u.pathname);
        }
      }
    }
  }
  for (const r of roots) await walk(r);
  assertEquals(offenders, []);
});
