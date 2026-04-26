/**
 * Onda 2 / T2.B.3 — Wrapper de Supabase admin client com header de
 * identificação de origin function.
 *
 * Por que: trigger audit_table_change (audit_log) lê
 * `current_setting('request.headers.x-edge-function', true)` para registrar
 * qual edge function fez a mutation. Sem esse header, audit_log.actor_function
 * fica null (mutation ainda registrada, só sem contexto).
 *
 * Uso (opcional, recomendado em functions que escrevem em tabelas críticas):
 *
 *   import { createAdminClient } from "../_shared/supabase-admin.ts";
 *   const supabase = createAdminClient("agent-message");
 *
 * Functions legacy podem continuar usando createClient direto — não quebra
 * audit, apenas perde dado de origem.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function createAdminClient(functionName: string): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("[createAdminClient] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
  }

  return createClient(url, key, {
    global: {
      headers: {
        "x-edge-function": functionName,
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
