/**
 * toth-connect
 *
 * Valida endereço + credenciais do ERP Toth de uma org fazendo login de verdade,
 * e só então persiste: a conexão em `toth_connections` e o par usuário/senha
 * cifrado no cofre deny-all. Admin da org apenas.
 *
 * Body: { base_url: string, user: string, password: string, token_transport?: "query" | "header" }
 *
 * Nada é gravado antes do login dar certo — conexão salva que não autentica é
 * pior que conexão ausente: a UI diz "conectado" e a sincronização falha calada.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { logRuntime } from "../_shared/logger.ts";
import { resolveAdminOrg } from "../_shared/erp/erp-admin-auth.ts";
import { TothClient, TothAuthError, TothRequestError } from "../_shared/erp/toth-client.ts";
import { UnsafeErpUrlError } from "../_shared/erp/toth-url.ts";
import { storeTothCredentials } from "../_shared/erp/toth-credentials.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOW_INSECURE = Deno.env.get("TOTH_ALLOW_INSECURE") === "1";

const json = (body: unknown, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });

Deno.serve(
  withErrorBoundary("toth-connect", async (req) => {
    const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const auth = await resolveAdminOrg(admin, req.headers.get("Authorization"), "conectar o ERP");
    if (!auth.ok) return json({ error: auth.error }, cors);
    const { organizationId, userId } = auth;

    const body = await req.json().catch(() => ({}));
    const baseUrl = typeof body.base_url === "string" ? body.base_url.trim() : "";
    const user = typeof body.user === "string" ? body.user.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const tokenTransport = body.token_transport === "header" ? "header" : "query";

    if (!baseUrl || !user || !password) {
      return json({ error: "Endereço, usuário e senha são obrigatórios" }, cors);
    }

    let client: TothClient;
    try {
      client = new TothClient(
        { baseUrl, user, password, tokenTransport },
        { urlPolicy: { allowInsecure: ALLOW_INSECURE } },
      );
    } catch (err) {
      // Endereço recusado pela guarda anti-SSRF — a mensagem já é acionável.
      if (err instanceof UnsafeErpUrlError) return json({ error: err.message }, cors);
      throw err;
    }

    // Prova de vida: autentica e lê uma página mínima de clientes. Só então grava.
    try {
      await client.login();
      await client.get("clientes", { limit: "1" });
    } catch (err) {
      if (err instanceof TothAuthError) return json({ error: err.message }, cors);
      if (err instanceof TothRequestError) {
        return json({ error: err.message }, cors);
      }
      const msg = err instanceof Error ? err.message : "Erro ao conectar";
      return json({ error: `Falha ao validar a conexão com o ERP: ${msg}` }, cors);
    }

    const { data: conn, error: connErr } = await admin
      .from("toth_connections")
      .upsert(
        {
          organization_id: organizationId,
          user_id: userId,
          status: "connected",
          base_url: client.baseUrl,
          token_transport: tokenTransport,
          connected_at: new Date().toISOString(),
          last_error: null,
        },
        { onConflict: "organization_id" },
      )
      .select("id")
      .maybeSingle();

    if (connErr || !conn) return json({ error: "Erro ao salvar conexão" }, cors);

    try {
      await storeTothCredentials(admin, {
        connectionId: conn.id,
        organizationId,
        user,
        password,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar credenciais";
      return json({ error: msg }, cors);
    }

    await logRuntime({
      organizationId,
      module: "general",
      action: "toth_connect",
      status: "success",
    });

    return json({ success: true, base_url: client.baseUrl }, cors);
  }),
);
