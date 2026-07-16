/**
 * omie-webhook — inbound Omie webhook (near-real-time, S11, ADR-0020).
 *
 * ⚠️ SKELETON / SPIKE-GATED. Só o plumbing spike-independente está aqui:
 * autenticação fail-closed + resolução de tenant pelo hash do segredo per-org +
 * ack rápido. O **parser do payload → upsert canônico** está STUB — depende do S1
 * spike confirmar (a) que a Omie oferece webhook outbound, (b) o transporte
 * (header x-webhook-secret vs path), e (c) o formato do payload. Enquanto não há
 * segredo provisionado (geração fica pro pós-spike), todo request cai em 401.
 * NÃO deployado ainda — deploy quando o handler for real.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** SHA-256 hex do segredo — comparação por hash, segredo cru nunca em repouso. */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(
  withErrorBoundary("omie-webhook", async (req: Request): Promise<Response> => {
    const headers = withSecurityHeaders({
      ...getCorsHeaders(req.headers.get("origin")),
      "Content-Type": "application/json",
    });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

    // Fail-closed: sem segredo → rejeita. Transporte real (header vs path) confirma no spike.
    const incomingSecret = req.headers.get("x-webhook-secret") ?? "";
    if (!incomingSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Resolução de tenant pelo hash do segredo (a Omie não manda org_id no payload).
    const secretHash = await sha256Hex(incomingSecret);
    const { data: secretRow } = await admin
      .from("omie_connection_secrets")
      .select("organization_id")
      .eq("webhook_secret_hash", secretHash)
      .maybeSingle();

    if (!secretRow) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }
    const organizationId = secretRow.organization_id as string;

    // Ack rápido; processamento assíncrono real vem pós-spike.
    // TODO(S1 spike): parsear o payload da Omie e alimentar os upsert canônicos
    // existentes (upsertCanonicalNfe / upsertCanonicalTitulo / ...). Payload
    // não-reconhecido → DLQ (não retry-storm). Por ora só registra e dá ack.
    await logRuntime({
      organizationId,
      module: "general",
      action: "omie_webhook_received",
      status: "success",
      payloadSnapshot: { note: "skeleton — payload handler pendente do S1 spike" },
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }),
);
