export interface Config {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Shared secret the caller must present via the x-mcp-secret header. */
  gatewaySecret: string;
  /** Dedicated ops-master credentials the function signs in with (RLS-inherited). */
  masterEmail: string;
  masterPassword: string;
  /** service_role key — only required (and validated) when allowMutations is true. */
  serviceRoleKey: string;
  project: "dev" | "prod";
  allowMutations: boolean;
}

type EnvMap = Record<string, string | undefined>;

const REQUIRED_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "MCP_GATEWAY_SECRET",
  "MCP_MASTER_EMAIL",
  "MCP_MASTER_PASSWORD",
] as const;

/**
 * Parse the MCP edge function config from an env map (injected for testability).
 * Safety defaults: project="dev", allowMutations=false. Throws on missing required keys.
 *
 * When mutations are armed (allowMutations=true) the config is stricter — fail loud
 * rather than discover a missing service_role key or an ambiguous target at apply time:
 *  - SUPABASE_SERVICE_ROLE_KEY must be present (cron.toggle needs it; a blank key
 *    otherwise yields an opaque auth error deep inside the RPC call).
 *  - TORQUE_MCP_PROJECT must be set explicitly to "dev" or "prod" (no silent default) so
 *    arming mutations is always a deliberate, environment-aware act.
 */
export function loadConfig(env: EnvMap): Config {
  const missing = REQUIRED_KEYS.filter((k) => !env[k]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required env var(s): ${missing.join(", ")}`);
  }

  const allowMutations = env.TORQUE_MCP_ALLOW_MUTATIONS === "true";
  const projectRaw = env.TORQUE_MCP_PROJECT;

  if (allowMutations) {
    if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      throw new Error(
        "TORQUE_MCP_ALLOW_MUTATIONS=true requires SUPABASE_SERVICE_ROLE_KEY (privileged tools need it).",
      );
    }
    if (projectRaw !== "dev" && projectRaw !== "prod") {
      throw new Error(
        "TORQUE_MCP_ALLOW_MUTATIONS=true requires TORQUE_MCP_PROJECT set explicitly to 'dev' or 'prod'.",
      );
    }
  }

  return {
    supabaseUrl: env.SUPABASE_URL!,
    supabaseAnonKey: env.SUPABASE_ANON_KEY!,
    gatewaySecret: env.MCP_GATEWAY_SECRET!,
    masterEmail: env.MCP_MASTER_EMAIL!,
    masterPassword: env.MCP_MASTER_PASSWORD!,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    project: projectRaw === "prod" ? "prod" : "dev",
    allowMutations,
  };
}
