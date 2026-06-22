export interface Config {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Shared secret the caller must present via the x-mcp-secret header. */
  gatewaySecret: string;
  /** Dedicated ops-master credentials the function signs in with (RLS-inherited). */
  masterEmail: string;
  masterPassword: string;
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
 */
export function loadConfig(env: EnvMap): Config {
  const missing = REQUIRED_KEYS.filter((k) => !env[k]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required env var(s): ${missing.join(", ")}`);
  }
  return {
    supabaseUrl: env.SUPABASE_URL!,
    supabaseAnonKey: env.SUPABASE_ANON_KEY!,
    gatewaySecret: env.MCP_GATEWAY_SECRET!,
    masterEmail: env.MCP_MASTER_EMAIL!,
    masterPassword: env.MCP_MASTER_PASSWORD!,
    project: env.TORQUE_MCP_PROJECT === "prod" ? "prod" : "dev",
    allowMutations: env.TORQUE_MCP_ALLOW_MUTATIONS === "true",
  };
}
