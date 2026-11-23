/**
 * crm-mcp config (DESIGN §4.5). Pure over an injected env map (testable).
 *
 * Three non-negotiable invariants live here:
 *  1. crm-mcp signs with its OWN dedicated ES256 key (CRM_MCP_JWT_SIGNING_KEY), never the
 *     project legacy/service_role secret (DESIGN §4.4).
 *  2. ASSERT-ABSENT (H3): secrets an operator would have to set BY HAND for this function
 *     to hold ops/master power (the torque-mcp gateway + master creds) fail the boot loudly.
 *     That turns "don't copy the wrong secret bundle into this function" from a deploy
 *     convention into an enforced, tested invariant.
 *  3. NEVER-READ (H3, platform half): the Supabase runtime injects SUPABASE_SERVICE_ROLE_KEY
 *     and SUPABASE_DB_URL into EVERY edge function; they cannot be unset per function, and
 *     the edge runtime ignores `Deno.env.delete` for them (measured on a preview branch,
 *     2026-11-23: the boot that refused to run with them present never served a request).
 *     So the guarantee is in the code, not the env: no crm-mcp module names them (source
 *     invariant test in config.test.ts) and no client is ever built from them. The boot
 *     still tries to drop them and logs which ones the runtime kept.
 */

export interface CrmMcpConfig {
  supabaseUrl: string;
  /** Public API key sent as `apikey` (the gateway key). Grants nothing by itself. */
  supabaseAnonKey: string;
  /** Project ref (e.g. "jsjsmuncfkbsbzqzqhfq") for the JWT `iss` claim. */
  projectRef: string;
  /** ES256 private key material (JWK JSON string). Imported to a CryptoKey at boot. */
  jwtSigningKeyJwk: string;
  /** `kid` advertised in the minted JWT header — must match the key the project trusts. */
  jwtKid: string;
  /** Optional pepper for HMAC-SHA256 token hashing (DESIGN §4.2, D2). Unset by default. */
  patPepper?: string;
}

type EnvMap = Record<string, string | undefined>;

const REQUIRED = [
  "SUPABASE_URL",
  "CRM_MCP_JWT_SIGNING_KEY",
  "CRM_MCP_JWT_KID",
] as const;

/** Set by hand only — their presence means someone deployed the ops bundle here. */
export const FORBIDDEN_OPS_SECRETS = [
  "MCP_MASTER_EMAIL",
  "MCP_MASTER_PASSWORD",
  "MCP_GATEWAY_SECRET",
] as const;

/** Injected by the platform into every function; removed from the isolate at boot. */
export const PLATFORM_PRIVILEGED_SECRETS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "SUPABASE_SECRET_KEYS",
] as const;

/** Same precedence as `_shared/user-auth.ts#getAnonKey` (the keys this project rotated). */
const ANON_KEY_VARS = ["ANON_KEY_2", "ANON_KEY", "SUPABASE_ANON_KEY"] as const;

function deriveProjectRef(env: EnvMap, url: string): string {
  if (env.CRM_MCP_PROJECT_REF?.trim()) return env.CRM_MCP_PROJECT_REF.trim();
  try {
    const host = new URL(url).hostname; // <ref>.supabase.co
    const first = host.split(".")[0];
    return /^[a-z0-9]{20}$/.test(first) ? first : "local";
  } catch {
    return "local";
  }
}

/**
 * Best-effort removal of the platform-injected privileged secrets from the isolate env.
 * Reports what was removed and what the runtime kept (Supabase keeps them — see the header);
 * the boot logs both. A delete that throws counts as kept.
 */
export function scrubPlatformSecrets(env: {
  get(key: string): string | undefined;
  delete(key: string): void;
}): { removed: string[]; kept: string[] } {
  const removed: string[] = [];
  const kept: string[] = [];
  for (const key of PLATFORM_PRIVILEGED_SECRETS) {
    if (env.get(key) === undefined) continue;
    try {
      env.delete(key);
    } catch {
      /* runtime refuses: reported as kept */
    }
    (env.get(key) === undefined ? removed : kept).push(key);
  }
  return { removed, kept };
}

export function loadConfig(env: EnvMap): CrmMcpConfig {
  const present = FORBIDDEN_OPS_SECRETS.filter((k) => (env[k] ?? "").trim().length > 0);
  if (present.length > 0) {
    throw new Error(
      `crm-mcp boot refused: forbidden ops secret(s) present in env: ${present.join(", ")}. ` +
        "crm-mcp is RLS-pure per-user and must not hold master/gateway secrets.",
    );
  }
  const missing: string[] = REQUIRED.filter((k) => !(env[k] ?? "").trim());
  const anonKey = ANON_KEY_VARS.map((k) => env[k]?.trim()).find((v) => !!v);
  if (!anonKey) missing.push("SUPABASE_ANON_KEY");
  if (missing.length > 0) {
    throw new Error(`crm-mcp boot refused: missing required env var(s): ${missing.join(", ")}`);
  }

  return {
    supabaseUrl: env.SUPABASE_URL!,
    supabaseAnonKey: anonKey!,
    projectRef: deriveProjectRef(env, env.SUPABASE_URL!),
    jwtSigningKeyJwk: env.CRM_MCP_JWT_SIGNING_KEY!,
    jwtKid: env.CRM_MCP_JWT_KID!,
    patPepper: env.CRM_MCP_PAT_PEPPER?.trim() || undefined,
  };
}
