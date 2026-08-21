/**
 * toth-probe — ferramenta de descoberta de contrato. Admin da org apenas.
 *
 * Existe para substituir três perguntas que fizemos ao fornecedor do Toth por
 * uma leitura nossa, no minuto em que houver conectividade:
 *   1. qual o formato da resposta do login;
 *   2. quais campos `GET /clientes` devolve, e qual é o id imutável;
 *   3. quais outros endpoints existem.
 *
 * 🔒 NÃO devolve dado de cliente. A resposta é forma, não conteúdo: nome do
 * campo, tipo, formato inferido, taxa de preenchimento. Ver
 * `_shared/erp/toth-probe-shape.ts`. Isso é deliberado — uma ferramenta de
 * diagnóstico que despeja a base num log vira o vazamento que ela deveria evitar.
 *
 * Body: { path?: string, params?: Record<string,string>, discover?: boolean }
 *   - `discover: true` varre os caminhos prováveis e reporta o status de cada um
 *   - caso contrário, descreve a resposta de `path` (default "clientes")
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { resolveAdminOrg } from "../_shared/erp/erp-admin-auth.ts";
import { TothClient, TothAuthError, TothRequestError } from "../_shared/erp/toth-client.ts";
import { loadTothCredentials, tothUrlPolicy } from "../_shared/erp/toth-credentials.ts";
import { extractRows } from "../_shared/erp/toth-mappers.ts";
import { describePayload, describeEnvelope } from "../_shared/erp/toth-probe-shape.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Caminhos prováveis sob /toth/services, na ordem em que interessam. */
const CANDIDATE_PATHS = [
  "clientes",
  "pedidos",
  "pedidosVenda",
  "notas",
  "notasFiscais",
  "titulos",
  "contasReceber",
  "produtos",
];

const json = (body: unknown, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });

Deno.serve(
  withErrorBoundary("toth-probe", async (req) => {
    const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const auth = await resolveAdminOrg(admin, req.headers.get("Authorization"), "sondar o ERP");
    if (!auth.ok) return json({ error: auth.error }, cors);

    const creds = await loadTothCredentials(admin, auth.organizationId);
    if (!creds) return json({ error: "Nenhuma conexão ativa com o ERP Toth" }, cors);

    const client = new TothClient(creds, { urlPolicy: tothUrlPolicy(creds) });
    const body = await req.json().catch(() => ({}));

    // ── Modo varredura: quais endpoints respondem? ───────────────────────────
    if (body.discover === true) {
      const found: Array<{ path: string; ok: boolean; detail: string; rows?: number }> = [];
      for (const path of CANDIDATE_PATHS) {
        try {
          // Sem `limit`: não está na lista de parâmetros do fornecedor, e
          // parâmetro inventado provocou HTTP 500 no ERP real (19/08).
          const payload = await client.get(path);
          found.push({ path, ok: true, detail: "respondeu", rows: extractRows(payload).length });
        } catch (err) {
          if (err instanceof TothAuthError) {
            return json({ error: err.message }, cors);
          }
          const detail =
            err instanceof TothRequestError
              ? `HTTP ${err.status ?? "sem resposta"}`
              : err instanceof Error
                ? err.message
                : "erro";
          found.push({ path, ok: false, detail });
        }
      }
      return json({ base_url: client.baseUrl, discovered: found }, cors);
    }

    // ── Modo descrição: como é a resposta deste caminho? ─────────────────────
    const path = typeof body.path === "string" && body.path.trim() ? body.path.trim() : "clientes";
    const params: Record<string, string> = {};
    if (body.params && typeof body.params === "object") {
      for (const [k, v] of Object.entries(body.params as Record<string, unknown>)) {
        if (typeof v === "string" || typeof v === "number") params[k] = String(v);
      }
    }

    try {
      const payload = await client.get(path, params);
      const rows = extractRows(payload);
      return json(
        {
          base_url: client.baseUrl,
          path,
          envelope: describeEnvelope(payload),
          shape: describePayload(rows),
          hint:
            rows.length === 0
              ? "Nenhuma linha reconhecida. Veja `envelope` para descobrir onde a lista está aninhada e acrescente a chave em LIST_ENVELOPES de toth-mappers.ts."
              : "Campo com constantAcrossRows=false e fillRate=1 é candidato a identificador imutável.",
        },
        cors,
      );
    } catch (err) {
      if (err instanceof TothAuthError || err instanceof TothRequestError) {
        return json({ error: err.message, path }, cors);
      }
      const msg = err instanceof Error ? err.message : "Erro ao sondar";
      return json({ error: msg, path }, cors);
    }
  }),
);
