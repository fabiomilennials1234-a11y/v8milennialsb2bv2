/**
 * crm-mcp config (DESIGN §4.5). Pure over an injected env map (testable).
 *
 * Two non-negotiable invariants live here:
 *  1. crm-mcp signs with its OWN dedicated ES256 key (CRM_MCP_JWT_SIGNING_KEY), never the
 *     project legacy/service_role secret (DESIGN §4.4, H2).
 *  2. ASSERT-ABSENT (H3): the function MUST NOT have any ops/master/service_role secret in
 *     its env. We fail the boot loudly if one is present — turning "don't copy the wrong
 *     secret bundle into this function" from a deploy convention into an enforced, tested
 *     invariant (the MEMORY is full of "wrong env in prod" incidents).
 */

export interface CrmMcpConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Project ref (e.g. "jsjsmuncfkbsbzqzqhfq") for the JWT `iss` claim. */
  projectRef: string;
  /** ES256 private key material (JWK JSON string). Imported to a CryptoKey at boot. */
  jwtSigningKeyJwk: string;
  /** `kid` advertised in the minted JWT header — must match the public key the project trusts. */
  jwtKid: string;
  /** Optional pepper for HMAC-SHA256 token hashing (DESIGN §4.2, D2). */
  patPepper?: string;
}

type EnvMap = Record<string, string | undefined>;

const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "CRM_MCP_JWT_SIGNING_KEY",
  "CRM_MCP_JWT_KID",
] as const;

/**
 * Secrets whose mere PRESENCE in this function's env is a deploy mistake. crm-mcp is
 * customer-facing and RLS-pure per-user: it must never hold the master creds, the gateway
 * secret, or service_role. Boot fails if any is set (DESIGN §4.5/§4.7, H3).
 */
const FORBIDDEN = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "MCP_MASTER_EMAIL",
  "MCP_MASTER_PASSWORD",
  "MCP_GATEWAY_SECRET",
] as const;

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

export function loadConfig(env: EnvMap): CrmMcpConfig {
  const present = FORBIDDEN.filter((k) => (env[k] ?? "").trim().length > 0);
  if (present.length > 0) {
    // Fail loud — this function must never be deployed with ops/service_role secrets.
    throw new Error(
      `crm-mcp boot refused: forbidden ops secret(s) present in env: ${present.join(", ")}. ` +
        "crm-mcp is RLS-pure per-user and must not hold master/service_role/gateway secrets.",
    );
  }

  const missing = REQUIRED.filter((k) => !(env[k] ?? "").trim());
  if (missing.length > 0) {
    throw new Error(`crm-mcp boot refused: missing required env var(s): ${missing.join(", ")}`);
  }

  return {
    supabaseUrl: env.SUPABASE_URL!,
    supabaseAnonKey: env.SUPABASE_ANON_KEY!,
    projectRef: deriveProjectRef(env, env.SUPABASE_URL!),
    jwtSigningKeyJwk: env.CRM_MCP_JWT_SIGNING_KEY!,
    jwtKid: env.CRM_MCP_JWT_KID!,
    patPepper: env.CRM_MCP_PAT_PEPPER?.trim() || undefined,
  };
}
