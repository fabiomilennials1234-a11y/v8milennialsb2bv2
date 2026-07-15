/**
 * omie-disconnect
 *
 * Removes an org's Omie connection (cascade drops the encrypted secrets) so
 * syncing stops cleanly. Admin-only. No body.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const json = (body: unknown, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });

Deno.serve(
  withErrorBoundary("omie-disconnect", async (req) => {
    const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autorizado" }, cors);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await asUser.auth.getUser();
    if (authError || !user) return json({ error: "Usuário não autenticado" }, cors);

    const { data: member } = await admin
      .from("team_members")
      .select("organization_id, role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member?.organization_id) {
      return json({ error: "Usuário não vinculado a uma organização" }, cors);
    }
    if (!["admin", "master"].includes(member.role)) {
      return json({ error: "Apenas administradores podem desconectar o Omie" }, cors);
    }

    // Deleting the connection cascades to omie_connection_secrets.
    const { error } = await admin
      .from("omie_connections")
      .delete()
      .eq("organization_id", member.organization_id);
    if (error) return json({ error: "Erro ao desconectar" }, cors);

    await logRuntime({
      organizationId: member.organization_id,
      module: "general",
      action: "omie_disconnect",
      status: "success",
    });

    return json({ success: true }, cors);
  }),
);
