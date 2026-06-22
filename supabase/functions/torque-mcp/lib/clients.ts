import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Config } from "./config.ts";
import type { SignInResult } from "./auth.ts";

/**
 * Sign in as the dedicated ops-master and return an RLS-scoped client.
 *
 * The returned client carries the master's JWT, so every PostgREST query runs
 * with RLS ON under master-ghost policies — the MCP inherits exactly the
 * master's visibility, never service_role. (See docs/adr/0011.)
 */
export async function signInAsMaster(config: Config): Promise<SignInResult<SupabaseClient>> {
  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: config.masterEmail,
    password: config.masterPassword,
  });
  if (error || !data.session) {
    // Fail loud — no degraded/anonymous mode (docs/adr/0011, REQ-M04).
    throw new Error(`MCP master sign-in failed: ${error?.message ?? "no session returned"}`);
  }
  return { client, session: { expires_at: data.session.expires_at } };
}
