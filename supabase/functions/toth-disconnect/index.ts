/**
 * toth-disconnect
 *
 * Marca a conexão como desconectada e APAGA o segredo. Não basta virar o status:
 * credencial que continua no banco depois do "desconectar" é credencial viva sem
 * dono — o admin acredita que revogou o acesso e não revogou.
 *
 * A linha de `toth_connections` sobrevive de propósito: guarda base_url, cursor e
 * histórico, então reconectar é digitar a senha de novo, não reconfigurar tudo.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { logRuntime } from "../_shared/logger.ts";
import { resolveAdminOrg } from "../_shared/erp/erp-admin-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });

Deno.serve(
  withErrorBoundary("toth-disconnect", async (req) => {
    const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const auth = await resolveAdminOrg(
      admin,
      req.headers.get("Authorization"),
      "desconectar o ERP",
    );
    if (!auth.ok) return json({ error: auth.error }, cors);
    const { organizationId } = auth;

    const { data: conn } = await admin
      .from("toth_connections")
      .select("id")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!conn) return json({ success: true, already_disconnected: true }, cors);

    // Segredo primeiro: se a segunda escrita falhar, o pior estado possível é
    // "sem credencial, status ainda conectado" — falha ruidosa, não acesso vivo.
    const { error: secretErr } = await admin
      .from("toth_connection_secrets")
      .delete()
      .eq("connection_id", conn.id);
    if (secretErr) {
      return json({ error: `Erro ao remover credenciais: ${secretErr.message}` }, cors);
    }

    const { error: connErr } = await admin
      .from("toth_connections")
      .update({ status: "disconnected", last_error: null })
      .eq("id", conn.id);
    if (connErr) return json({ error: `Erro ao desconectar: ${connErr.message}` }, cors);

    await logRuntime({
      organizationId,
      module: "general",
      action: "toth_disconnect",
      status: "success",
    });

    return json({ success: true }, cors);
  }),
);
