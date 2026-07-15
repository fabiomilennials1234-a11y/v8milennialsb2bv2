/**
 * omie-connect
 *
 * Validates an org's Omie app_key + app_secret by pinging the API, then stores
 * them encrypted in the deny-all vault and marks the connection connected.
 * Admin-only. Body: { app_key: string, app_secret: string }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { logRuntime } from "../_shared/logger.ts";
import { OmieClient, OmieFaultError, OmieRateLimitError } from "../_shared/erp/omie-client.ts";
import { storeOmieCredentials } from "../_shared/erp/omie-credentials.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const json = (body: unknown, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });

Deno.serve(
  withErrorBoundary("omie-connect", async (req) => {
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

    // Resolve org + require admin/master — connecting an ERP is an admin action.
    const { data: member } = await admin
      .from("team_members")
      .select("organization_id, role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member?.organization_id) {
      return json({ error: "Usuário não vinculado a uma organização" }, cors);
    }
    if (!["admin", "master"].includes(member.role)) {
      return json({ error: "Apenas administradores podem conectar o Omie" }, cors);
    }
    const organizationId = member.organization_id as string;

    const { app_key, app_secret } = await req.json().catch(() => ({}));
    if (
      typeof app_key !== "string" ||
      typeof app_secret !== "string" ||
      app_key.trim().length < 5 ||
      app_secret.trim().length < 5
    ) {
      return json({ error: "app_key e app_secret são obrigatórios" }, cors);
    }

    // Validate the credentials against Omie before persisting anything.
    const client = new OmieClient({ appKey: app_key.trim(), appSecret: app_secret.trim() });
    try {
      await client.call("geral/clientes", "ListarClientes", {
        pagina: 1,
        registros_por_pagina: 1,
      });
    } catch (err) {
      if (err instanceof OmieFaultError) {
        return json({ error: `Credenciais Omie inválidas: ${err.faultstring}` }, cors);
      }
      if (err instanceof OmieRateLimitError) {
        return json({ error: "Omie está limitando as requisições. Tente novamente em instantes." }, cors);
      }
      const msg = err instanceof Error ? err.message : "Erro ao conectar";
      return json({ error: `Falha ao validar conexão com o Omie: ${msg}` }, cors);
    }

    // Upsert the connection (no secrets here) and get its id.
    const { data: conn, error: connErr } = await admin
      .from("omie_connections")
      .upsert(
        {
          organization_id: organizationId,
          user_id: user.id,
          status: "connected",
          omie_account_name: "Omie",
          connected_at: new Date().toISOString(),
          last_error: null,
        },
        { onConflict: "organization_id" },
      )
      .select("id")
      .maybeSingle();

    if (connErr || !conn) {
      return json({ error: "Erro ao salvar conexão" }, cors);
    }

    try {
      await storeOmieCredentials(admin, {
        connectionId: conn.id,
        organizationId,
        appKey: app_key.trim(),
        appSecret: app_secret.trim(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar credenciais";
      return json({ error: msg }, cors);
    }

    await logRuntime({
      organizationId,
      module: "general",
      action: "omie_connect",
      status: "success",
    });

    return json({ success: true, account_name: "Omie" }, cors);
  }),
);
