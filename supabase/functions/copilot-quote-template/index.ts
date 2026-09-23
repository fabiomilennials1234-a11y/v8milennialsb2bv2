import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth, AuthError } from "../_shared/user-auth.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { base64, documentService, sha256 } from "../_shared/quotes/service.ts";
import { DOCX_MIME, QUOTE_BUCKET, QUOTE_MAX_BYTES, renderQuoteData } from "../../../src/contracts/copilot/quote-document.ts";

export async function handleQuoteTemplate(req: Request): Promise<Response> {
  const headers = { ...withSecurityHeaders(getCorsHeaders(req.headers.get("origin"))), "Content-Type": "application/json", "Cache-Control": "no-store" };
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { headers, status });
  if (req.method === "OPTIONS") return new Response(null, { headers, status: 204 });
  if (req.method !== "POST") return json({ error: "Método inválido." }, 405);
  if (!req.headers.get("authorization")?.startsWith("Bearer ")) return json({ error: "Autenticação necessária." }, 401);
  try {
    // Bound actual bytes, not just attacker-controlled Content-Length.
    const stream = req.body?.getReader(); if (!stream) return json({ error: "Arquivo ausente." }, 400);
    let size = 0; const parts: Uint8Array[] = [];
    try {
      while (true) { const part = await stream.read(); if (part.done) break; size += part.value.length;
        if (size > QUOTE_MAX_BYTES * 1.5) { await stream.cancel(); return json({ error: "Limite de 5 MiB." }, 413); } parts.push(part.value); }
    } finally { stream.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    const input = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof input.agent_id !== "string") return json({ error: "Salve o agente antes de importar o modelo." }, 400);
    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("authorization")! } }, auth: { persistSession: false, autoRefreshToken: false } });
    const agent = await caller.from("copilot_agents").select("id,organization_id").eq("id", input.agent_id).maybeSingle();
    if (agent.error || !agent.data) return json({ error: "Agente indisponível." }, 403);
    const org = agent.data.organization_id;
    await requireAuth(req, { organizationId: org, requireOrganization: true });
    const permission = await caller.rpc("can_manage_copilot", { p_org_id: org });
    if (permission.error || permission.data !== true) return json({ error: "Sem permissão para configurar o Copilot." }, 403);
    const admin = createAdminClient("copilot-quote-template");
    if (input.action === "health") return json(await documentService("health"));
    if (input.action === "test") {
      const template = await admin.from("copilot_quote_templates").select("*").eq("id", input.template_id).eq("agent_id", agent.data.id).eq("organization_id", org).single();
      if (template.error || !template.data) return json({ error: "Modelo indisponível." }, 404);
      const file = await admin.storage.from(QUOTE_BUCKET).download(template.data.file_path);
      if (file.error || !file.data) throw new Error("Modelo indisponível.");
      const values = Object.fromEntries(template.data.fields.map((f: string) => [f, `Teste ${f}`]));
      const data = renderQuoteData({ values, items: [{ code: "TESTE", description: "Produto de demonstração", unit: "UN", quantity: "2", unit_price_cents: 1000 }], freight_cents: 0, discount_cents: 0, tax_cents: 0, extra_cents: 0 }, template.data.fields, []);
      const result = await documentService("render", { template: base64(new Uint8Array(await file.data.arrayBuffer())), ...data, convert_to_pdf: input.convert_to_pdf === true });
      return json(result);
    }
    if (input.action !== "upload" || typeof input.name !== "string" || !/\.docx$/i.test(input.name) || input.name.length > 160 || typeof input.file !== "string") return json({ error: "Selecione um modelo .docx." }, 400);
    const file = Uint8Array.from(atob(input.file), c => c.charCodeAt(0));
    if (file.length > QUOTE_MAX_BYTES) return json({ error: "Limite de 5 MiB." }, 413);
    const manifest = await documentService("inspect", { template: input.file });
    if (!Array.isArray(manifest.fields) || !manifest.fields.length) throw new Error("Modelo sem campos.");
    const id = crypto.randomUUID(); const path = `${org}/${agent.data.id}/templates/${id}.docx`;
    const upload = await admin.storage.from(QUOTE_BUCKET).upload(path, file, { contentType: DOCX_MIME, upsert: false });
    if (upload.error) throw new Error("Falha no upload.");
    const record = await admin.from("copilot_quote_templates").insert({ id, organization_id: org, agent_id: agent.data.id, name: input.name, file_path: path, sha256: await sha256(file), fields: manifest.fields });
    if (record.error) { await admin.storage.from(QUOTE_BUCKET).remove([path]); throw new Error("Falha ao registrar modelo."); }
    return json({ id, name: input.name, fields: manifest.fields });
  } catch (error) {
    return json({ error: error instanceof AuthError ? "Acesso não autorizado." : "Não foi possível processar. Confira os marcadores e a disponibilidade do serviço de documentos." }, error instanceof AuthError ? error.status : 422);
  }
}
Deno.serve(withErrorBoundary("copilot-quote-template", handleQuoteTemplate));
