/**
 * notificame-send-social — responder pelo Direct.
 *
 * ─── O CONTRATO, CONFIRMADO POR DUAS FONTES DO FORNECEDOR ───────────────────
 *
 *   POST /v2/channels/instagram/messages
 *   X-Api-Token: <token da conta>
 *   { "from": <id do canal>, "to": <IGSID>, "contents": [{ "type":"text", "text":"…" }] }
 *
 *   Bate byte a byte entre a doc (`app.notificame.com.br/docs/api.md`) e o node
 *   oficial (`n8n-nodes-notificame-hub`, transport/instagram). Nada aqui é
 *   engenharia reversa — foi a primeira peça desta integração escrita a partir
 *   de contrato verificado, e não de suposição.
 *
 * ─── O QUE ESTA FUNÇÃO NÃO FAZ ──────────────────────────────────────────────
 *
 *   Não monta envelope, não fala com o fornecedor e não grava a linha de saída:
 *   tudo isso já existe em `NotificameProvider`, que também persiste em
 *   `channel_messages` com `upsert` por `(external_id, channel, organization_id)`.
 *   Reimplementar aqui criaria uma SEGUNDA verdade sobre o formato do envelope,
 *   para divergir na primeira mudança do fornecedor.
 *
 *   E NÃO BLOQUEIA POR JANELA. A doc do fornecedor declara "até 24 horas após a
 *   última resposta do destinatário", mas quem decide se vale tentar é o
 *   operador — a tela mostra o tempo restante e a recusa, se vier, sobe legível.
 *   Bloquear por conta de um cálculo nosso deixaria o vendedor refém de um
 *   relógio que pode estar errado.
 *
 * ─── GATES ──────────────────────────────────────────────────────────────────
 *
 *   1. `requireAuth(requireOrganization)` — a org vem da membresia validada;
 *   2. flag `notificame` (fail-closed);
 *   3. `whatsapp.manage_instances` — a mesma chave do resto da fatia;
 *   4. o CANAL é desta org e é SOCIAL — `_shared/notificame-social-send.ts`.
 *
 *   ⚠️ O gate 4 é ESCRITA, não leitura: um canal alheio aceito aqui manda
 *   mensagem, com a marca do cliente, pela conta de outro tenant. É o mesmo
 *   vetor do gate de templates com consequência pior.
 *
 * `verify_jwt = false` no config.toml ⇒ alcançável de fora, todo gate é interno.
 */
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import { canUserAccessFeature } from "../_shared/permission_engine.ts";
import { logRuntime } from "../_shared/logger.ts";
import { getTraceContext } from "../_shared/request-trace.ts";
import { readNotificameFlags } from "../_shared/notificame.ts";
import { NotificameProvider } from "../_shared/whatsapp-providers/notificame-provider.ts";
import {
  readSocialSendPayload,
  resolveSocialSendChannel,
  type SocialChannelRow,
} from "../_shared/notificame-social-send.ts";

const FUNCTION_NAME = "notificame-send-social";
const MANAGE_INSTANCES_FEATURE = "whatsapp.manage_instances";

/** Teto de texto. O fornecedor não documenta limite; 4000 é folga sobre o do Direct. */
const TEXT_MAX = 4000;

function readString(body: Record<string, unknown>, ...chaves: string[]): string {
  for (const chave of chaves) {
    const valor = body[chave];
    if (typeof valor === "string" && valor.trim()) return valor.trim();
  }
  return "";
}

Deno.serve(withErrorBoundary(FUNCTION_NAME, async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin") ?? undefined));
  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "method_not_allowed", code: "method_not_allowed" }),
      { status: 405, headers },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_body", code: "invalid_body" }), {
      status: 400,
      headers,
    });
  }

  let auth;
  try {
    auth = await requireAuth(req, { body, requireOrganization: true });
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
    throw e;
  }

  const orgId = auth.organizationId;
  if (!orgId) {
    return new Response(
      JSON.stringify({ error: "organization_id_required", code: "organization_id_required" }),
      { status: 400, headers },
    );
  }

  const messagingChannelId = readString(body, "messaging_channel_id", "messagingChannelId");
  const to = readString(body, "to", "external_user_id", "externalUserId");

  if (!messagingChannelId || !to) {
    return new Response(
      JSON.stringify({
        error: "messaging_channel_id e to são obrigatórios",
        code: "missing_params",
      }),
      { status: 400, headers },
    );
  }

  // Texto ou mídia — e a URL do anexo é conferida aqui mesmo com o front já
  // validando: ela chega do cliente, e quem vai BUSCAR o arquivo é o fornecedor.
  const conteudo = readSocialSendPayload(body);
  if (!conteudo.ok) {
    return new Response(
      JSON.stringify({ error: conteudo.error, code: conteudo.code }),
      { status: 400, headers },
    );
  }
  if (conteudo.kind === "text" && conteudo.text.length > TEXT_MAX) {
    return new Response(
      JSON.stringify({ error: `A mensagem passa de ${TEXT_MAX} caracteres`, code: "text_too_long" }),
      { status: 400, headers },
    );
  }

  const trace = getTraceContext(req);
  const admin = createAdminClient(FUNCTION_NAME);

  const flags = await readNotificameFlags(admin, orgId);
  if (!flags.enabled) {
    return new Response(
      JSON.stringify({ error: "Recurso não habilitado", code: "feature_disabled" }),
      { status: 403, headers },
    );
  }

  if (!(await canUserAccessFeature(admin, auth.userId, orgId, MANAGE_INSTANCES_FEATURE))) {
    return new Response(
      JSON.stringify({
        error: "Você não tem permissão para responder por este canal",
        code: "permission_denied",
      }),
      { status: 403, headers },
    );
  }

  // Sem `.eq("organization_id", …)`: quem confere a org é o gate puro, e é ele
  // que os testes exercitam. Filtrar aqui tornaria a guarda inalcançável.
  const { data: channelRow } = await admin
    .from("messaging_channels")
    .select("organization_id, provider, channel_type, status, external_channel_id, subaccount_id")
    .eq("id", messagingChannelId)
    .maybeSingle();

  const alvo = resolveSocialSendChannel(channelRow as SocialChannelRow | null, orgId);
  if (!alvo.ok) {
    if (alvo.code === "channel_not_found") {
      await logRuntime({
        organizationId: orgId,
        module: "channel",
        action: "notificame.social_send_channel_denied",
        status: "error",
        errorMessage: `canal ${messagingChannelId} não pertence à org ${orgId} (ou não existe)`,
        entityType: "whatsapp_instance",
        triggeredBy: auth.userId,
        payloadSnapshot: { messaging_channel_id: messagingChannelId },
        ...trace,
      });
    }
    return new Response(
      JSON.stringify({ error: alvo.error, code: alvo.code }),
      { status: alvo.status, headers },
    );
  }

  const provider = new NotificameProvider({
    organizationId: orgId,
    channelId: alvo.channelId,
    channelKind: alvo.channelKind,
    supabaseAdmin: admin,
    messagingChannelId,
    expectedSubaccountId:
      (channelRow as { subaccount_id?: string | null } | null)?.subaccount_id ?? null,
  });

  try {
    // `number` é o nome histórico do campo (nasceu no WhatsApp); para canal
    // social ele carrega o IGSID, e `normalizeNotificameRecipient` não o
    // deforma — só WhatsApp passa pelo filtro de dígitos.
    //
    // O envio de mídia manda a URL, nunca os bytes: o fornecedor BUSCA o
    // arquivo, e o provider recusa base64 explicitamente.
    const resultado = conteudo.kind === "media"
      ? await provider.sendMedia({
        number: to,
        type: conteudo.media.type === "document" ? "document" : conteudo.media.type,
        file: conteudo.media.file,
        ...(conteudo.media.caption ? { caption: conteudo.media.caption } : {}),
        ...(conteudo.media.filename ? { filename: conteudo.media.filename } : {}),
      })
      : await provider.sendText({ number: to, text: conteudo.text });

    await logRuntime({
      organizationId: orgId,
      module: "channel",
      action: "notificame.social_message_sent",
      status: "success",
      entityType: "whatsapp_instance",
      triggeredBy: auth.userId,
      payloadSnapshot: {
        messaging_channel_id: messagingChannelId,
        channel_kind: alvo.channelKind,
        conteudo: conteudo.kind === "media" ? conteudo.media.type : "text",
        external_id: resultado.message_id,
      },
      ...trace,
    });

    return new Response(JSON.stringify({ message: resultado }), { status: 201, headers });
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : String(e);
    // O CÓDIGO e o MOTIVO do fornecedor, que a mensagem não carrega. Sem eles o
    // log dizia "recusou o envio" e mais nada — foi o que deixou um envelope de
    // mídia errado sobreviver a uma fatia inteira. `vendor` é server-only: entra
    // no log, nunca na resposta HTTP.
    const falha = e as { code?: string; vendor?: unknown };

    await logRuntime({
      organizationId: orgId,
      module: "channel",
      action: "notificame.social_send_failed",
      status: "error",
      errorMessage: detalhe,
      entityType: "whatsapp_instance",
      triggeredBy: auth.userId,
      payloadSnapshot: {
        messaging_channel_id: messagingChannelId,
        channel_kind: alvo.channelKind,
        // Qual conteúdo falhou: sem isto, texto e mídia são indistinguíveis no log.
        conteudo: conteudo.kind === "media" ? conteudo.media.type : "text",
        ...(typeof falha.code === "string" ? { error_code: falha.code } : {}),
        ...(falha.vendor ? { vendor: falha.vendor } : {}),
      },
      ...trace,
    });

    // A recusa do fornecedor sobe LEGÍVEL, com o texto dele junto. Quando a
    // causa é a janela de 24h, é essa frase que diz ao operador por que não foi
    // — e um "erro ao enviar" genérico o faria tentar de novo para sempre.
    return new Response(
      JSON.stringify({ error: "Não foi possível enviar", code: "send_failed", detail: detalhe }),
      { status: 502, headers },
    );
  }
}));
