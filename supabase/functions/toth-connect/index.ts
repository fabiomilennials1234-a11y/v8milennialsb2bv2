/**
 * toth-connect
 *
 * Valida endereço + credenciais do ERP Toth de uma org fazendo login de verdade,
 * e só então persiste: a conexão em `toth_connections` e o par usuário/senha
 * cifrado no cofre deny-all. Admin da org apenas.
 *
 * Body: { base_url, user, password, token_transport?: "query"|"header",
 *         allow_insecure_transport?: boolean }
 *
 * `allow_insecure_transport` é o aceite consciente de tráfego sem TLS. O ERP da
 * Café Jurerê está publicado em http:// puro, então sem esse aceite a conexão é
 * recusada com a explicação do risco — em vez de aceitar http em silêncio.
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
import { storeTothCredentials, tothUrlPolicy } from "../_shared/erp/toth-credentials.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    const allowInsecureTransport = body.allow_insecure_transport === true;

    if (!baseUrl || !user || !password) {
      return json({ error: "Endereço, usuário e senha são obrigatórios" }, cors);
    }

    let client: TothClient;
    try {
      client = new TothClient(
        { baseUrl, user, password, tokenTransport },
        { urlPolicy: tothUrlPolicy({ allowInsecureTransport }) },
      );
    } catch (err) {
      // Endereço recusado pela guarda anti-SSRF — a mensagem já é acionável.
      if (err instanceof UnsafeErpUrlError) return json({ error: err.message }, cors);
      throw err;
    }

    // Prova de vida: SÓ o login. Não lê clientes.
    //
    // A versão anterior fazia `GET /clientes?limit=1` para "provar acesso a
    // dado", e isso estava errado por dois motivos que só apareceram contra o
    // ERP real (19/08, HTTP 500):
    //
    //  1. `limit` não existe na lista de parâmetros do fornecedor (`token`,
    //     `cnpj`, `diasCompras`, `marcas`). Mandar parâmetro inventado para um
    //     endpoint que não o conhece é pedir exceção do outro lado.
    //  2. Sem filtro, `/clientes` devolve a BASE INTEIRA. Validar uma conexão
    //     puxando todo o cadastro do cliente é caro e, num servidor on-premise
    //     de uma empresa só, potencialmente danoso.
    //
    // O login já prova o que a conexão precisa provar: endereço alcançável e
    // credencial aceita. Se o dado está acessível é pergunta do `toth-probe` e
    // do dry-run, que existem para isso e não gravam nada.
    try {
      await client.login();
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
          allow_insecure_transport: allowInsecureTransport,
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

    return json(
      {
        success: true,
        base_url: client.baseUrl,
        // A UI mostra esse aviso ao lado do status "conectado": quem olha a tela
        // precisa saber que a credencial vai em claro, não só quem marcou o
        // aceite no dia da configuração.
        insecure_transport: allowInsecureTransport && client.baseUrl.startsWith("http://"),
      },
      cors,
    );
  }),
);
