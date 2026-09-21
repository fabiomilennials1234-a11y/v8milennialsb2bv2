import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth, AuthError } from "./user-auth.ts";
import { createAdminClient } from "./supabase-admin.ts";
import { getCorsHeaders } from "./cors.ts";
import { withSecurityHeaders } from "./security-headers.ts";
import { QUESTION_IMAGE_BUCKET, QUESTION_IMAGE_MAX_BYTES, inspectQuestionImage, isQuestionImagePath, isQuestionImageAsset, type QuestionImageAsset } from "../../../src/contracts/workflows/question-image.ts";

async function boundedBody(req: Request): Promise<Blob> {
  const maximum = QUESTION_IMAGE_MAX_BYTES + 64 * 1024;
  if (Number(req.headers.get("content-length")) > maximum) throw new Error("payload_too_large");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("missing_body");
  let size = 0;
  const chunks: ArrayBuffer[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new Error("payload_too_large"); }
      chunks.push(value.slice().buffer);
    }
  } finally { reader.releaseLock(); }
  return new Blob(chunks, { type: req.headers.get("content-type") ?? "" });
}

export async function handleWorkflowQuestionImage(req: Request): Promise<Response> {
  const headers = { ...withSecurityHeaders(getCorsHeaders(req.headers.get("origin"))), "content-type": "application/json", "cache-control": "no-store" };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!req.headers.get("authorization")?.startsWith("Bearer ")) return json({ error: "Autenticação necessária." }, 401);
  try {
    const body = new Response(await boundedBody(req), { headers: { "content-type": req.headers.get("content-type") ?? "" } });
    const isPreview = req.headers.get("content-type")?.startsWith("application/json");
    const previewRequest = isPreview ? await body.json() : null;
    const form = isPreview ? null : await body.formData();
    if (previewRequest?.action === "chat_preview") {
      if (typeof previewRequest.messageId !== "string" || !/^[a-f0-9-]{36}$/i.test(previewRequest.messageId)) return json({ error: "Mensagem inválida." }, 400);
      const reader = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: req.headers.get("authorization")! } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      // Same message/lead/inbox RLS as the chat. No workflow edit privilege or
      // rollout flag is required to read an already-sent message.
      const message = await reader.from("whatsapp_messages").select("organization_id,instance_id,lead_id,direction,raw_payload").eq("id", previewRequest.messageId).maybeSingle();
      if (message.error || !message.data?.organization_id || message.data.direction !== "outgoing" || !message.data.lead_id) return json({ error: "Mensagem indisponível para seu acesso." }, 403);
      const organizationId = message.data.organization_id;
      await requireAuth(req, { organizationId, requireOrganization: true });
      const questionId = message.data.raw_payload?.workflowQuestionId;
      if (typeof questionId !== "string" || !/^[a-f0-9-]{36}$/i.test(questionId)) return json({ error: "Imagem indisponível." }, 404);
      const admin = createAdminClient("workflow-question-image");
      const question = await admin.from("workflow_button_questions").select("content")
        .eq("id", questionId).eq("organization_id", organizationId).eq("instance_id", message.data.instance_id).eq("lead_id", message.data.lead_id).maybeSingle();
      const asset = question.data?.content?.image;
      if (question.error || !isQuestionImageAsset(asset, organizationId)) return json({ error: "Imagem indisponível." }, 404);
      const preview = await admin.storage.from(QUESTION_IMAGE_BUCKET).createSignedUrl(asset.path, 300);
      if (preview.error || !preview.data?.signedUrl) return json({ error: "Imagem indisponível." }, 404);
      return json({ previewUrl: preview.data.signedUrl });
    }
    const workflowId = isPreview ? previewRequest?.workflowId : form?.get("workflowId");
    if (typeof workflowId !== "string" || !/^[a-f0-9-]{36}$/i.test(workflowId)) return json({ error: "Salve o rascunho antes de adicionar uma imagem." }, 400);
    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("authorization")! } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const workflow = await caller.from("workflows").select("id, organization_id").eq("id", workflowId).maybeSingle();
    if (workflow.error || !workflow.data?.organization_id) return json({ error: "Automação indisponível para seu acesso." }, 403);
    const organizationId = workflow.data.organization_id;
    await requireAuth(req, { organizationId, requireOrganization: true });
    const permission = await caller.rpc("can_administer_guided_workflow", { p_organization_id: organizationId });
    if (permission.error || permission.data !== true) return json({ error: "Sem permissão para editar automações." }, 403);
    const org = await caller.from("organizations").select("feature_flags").eq("id", organizationId).maybeSingle();
    if (org.error || org.data?.feature_flags?.workflow_question_buttons !== true) return json({ error: "Pergunta com botões ainda não está liberada nesta organização." }, 403);
    const storage = createAdminClient("workflow-question-image").storage.from(QUESTION_IMAGE_BUCKET);
    if (isPreview) {
      if (previewRequest?.action !== "preview" || !isQuestionImagePath(previewRequest?.path, organizationId)) return json({ error: "Imagem indisponível para esta organização." }, 403);
      const preview = await storage.createSignedUrl(previewRequest.path, 300);
      if (preview.error || !preview.data?.signedUrl) return json({ error: "Não foi possível preparar a prévia." }, 404);
      return json({ previewUrl: preview.data.signedUrl });
    }
    const file = form?.get("file");
    if (!(file instanceof File)) return json({ error: "Selecione uma imagem." }, 400);
    if (file.size > QUESTION_IMAGE_MAX_BYTES) return json({ error: "A imagem deve ter até 5 MiB." }, 413);
    const mimeType = inspectQuestionImage(new Uint8Array(await file.arrayBuffer()));
    if (!mimeType || mimeType !== file.type) return json({ error: "Arquivo inválido. Escolha uma imagem PNG, JPEG ou WebP." }, 400);
    const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
    const image: QuestionImageAsset = { bucket: QUESTION_IMAGE_BUCKET, path: `${organizationId}/${crypto.randomUUID()}.${extension}`, mimeType, sizeBytes: file.size };
    const uploaded = await storage.upload(image.path, file, { contentType: image.mimeType, upsert: false });
    if (uploaded.error) return json({ error: "Não foi possível salvar a imagem. Tente novamente." }, 502);
    const preview = await storage.createSignedUrl(image.path, 300);
    if (preview.error || !preview.data?.signedUrl) return json({ error: "Não foi possível preparar a prévia. Tente novamente." }, 502);
    return json({ image, previewUrl: preview.data.signedUrl });
  } catch (error) {
    if (error instanceof Error && error.message === "payload_too_large") return json({ error: "A imagem deve ter até 5 MiB." }, 413);
    return json({ error: error instanceof AuthError ? "Acesso não autorizado." : "Não foi possível processar a imagem." }, error instanceof AuthError ? error.status : 400);
  }
}
