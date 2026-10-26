import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { AuthError, requireAuth } from "../_shared/user-auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { createDescriptionHandler } from "./handler.ts";
import { generateDescription } from "./generate.ts";

Deno.serve(withErrorBoundary("master-task-description", createDescriptionHandler({
  headers: req => withSecurityHeaders(getCorsHeaders(req.headers.get("Origin"))),
  authenticate: async req => {
    const authorization = req.headers.get("Authorization") ?? "";
    if (!/^Bearer\s+\S+$/i.test(authorization)) return null;
    try {
      const auth = await requireAuth(req);
      const client = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("ANON_KEY_2")?.trim() || Deno.env.get("ANON_KEY")?.trim() || Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data, error } = await client.from("master_users").select("is_active, permissions")
        .eq("user_id", auth.userId).maybeSingle();
      if (error) throw new Error("Falha ao verificar acesso às tarefas.");
      return data ? { isActive: data.is_active === true, permissions: data.permissions } : { isActive: false, permissions: null };
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) return null;
      if (error instanceof AuthError && error.status === 403) return { isActive: false, permissions: null };
      throw error;
    }
  },
  generate: input => {
    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) throw new Error("Description provider not configured");
    return generateDescription(input, { apiKey, model: Deno.env.get("MASTER_TASK_DESCRIPTION_MODEL") });
  },
})));
