/**
 * notificame-templates — A PORTA DE ENTRADA dos templates HSM.
 *
 * ─── POR QUE ESTA FUNÇÃO EXISTE ─────────────────────────────────────────────
 *
 *   `_shared/notificame-templates.ts` tem 622 linhas, 22 testes, e sabe listar,
 *   criar, apagar e montar o envio de template. E era ALCANÇÁVEL POR NINGUÉM:
 *   `grep -rln notificame-templates supabase/functions src` só encontrava o
 *   próprio módulo e o provider de envio. Nenhuma edge function o expunha,
 *   nenhum hook do front o chamava.
 *
 *   É a patologia mais cara deste repo — o difícil construído, a última milha
 *   não. Esta função é a última milha da leitura.
 *
 * ─── DUAS AÇÕES: `list` E `create`. `delete` FICA DE FORA ───────────────────
 *
 *   `list` é leitura. `create` SUBMETE À META para aprovação — não escreve no
 *   nosso banco, escreve na conta do cliente, e o resultado demora horas.
 *
 *   `deleteTemplate` existe no módulo e NÃO é exposto aqui, por dois motivos:
 *   (a) a rota que usamos (`DELETE /v2/channels/whatsapp/templates/…`) é a única
 *   da fatia sem segunda fonte — o node do fornecedor não implementa apagar, e
 *   não há com o que confrontar; (b) apagar um template que uma campanha usa
 *   quebra a campanha em silêncio, e essa conversa precisa da tela que mostre
 *   quem depende dele. Endpoint destrutivo sem essa tela é armadilha.
 *
 * ─── POR QUE `create` EXIGE ADMIN E `list` NÃO ──────────────────────────────
 *
 *   Ler a lista é informação operacional. Submeter um template é um ato na
 *   conta do cliente na Meta, que entra na fila de revisão dela e cuja recusa
 *   conta contra a reputação daquele número. Não é a mesma gravidade, e o gate
 *   acompanha: `create` soma `auth.isAdmin` à feature permission.
 *
 * ─── GATES ──────────────────────────────────────────────────────────────────
 *
 *   1. `requireAuth(requireOrganization)` — a org vem da membresia VALIDADA,
 *      nunca do corpo. Mesma forma de `notificame-channel-start`;
 *   2. flag `notificame` da org (fail-closed);
 *   3. feature permission `whatsapp.manage_instances` — a MESMA chave da tela de
 *      canais, que é de onde esta lista é aberta;
 *   4. o CANAL é desta org — em `_shared/notificame-template-access.ts`.
 *
 *   ⚠️ NÃO exige `auth.isAdmin`, e a diferença para `notificame-channel-start` é
 *   deliberada: lá o retorno CARREGA A CREDENCIAL da subconta (o token que
 *   abre o popup), aqui o retorno é a lista de templates aprovados do canal —
 *   informação operacional, não segredo. Copiar o gate de admin para cá seria
 *   cargo cult; o que se copia é a forma, não a severidade.
 *
 * ─── DE QUAL TABELA SAI O CANAL ─────────────────────────────────────────────
 *
 *   `whatsapp_instances`, e não `messaging_channels`. Template é conceito de
 *   WhatsApp, e canal de WhatsApp do NotificaMe nasce em `whatsapp_instances`
 *   com `provider='notificame'` e o id do fornecedor em
 *   `provider_config.channel_id` — é assim que `notificame-channel-finish`
 *   grava e é assim que `whatsapp-client` lê. `messaging_channels` guarda os
 *   canais SOCIAIS. Medido em prod: uma linha lá (Instagram) contra 139 aqui.
 *
 *   A primeira versão desta função leu `messaging_channels`. Passava nos testes
 *   e jamais teria encontrado um canal real.
 *
 * ─── A BUSCA NÃO FILTRA POR ORG, E ISSO É INTENCIONAL ───────────────────────
 *
 *   Seria natural escrever `.eq("organization_id", orgId)` no SELECT. Não está
 *   lá porque isso tornaria INALCANÇÁVEL a guarda de tenancy do gate puro: a
 *   linha de outra org nunca chegaria nele, o teste "recusa instância de OUTRA
 *   org" passaria por outro caminho, e o dia em que alguém mexesse no SELECT a
 *   guarda silenciosamente deixaria de existir sem nenhum teste ficar vermelho.
 *
 *   Um gate que nada exercita é um gate que ninguém sabe se funciona — foi
 *   medido neste repo por prova de mutação, no mesmo dia em que esta função
 *   nasceu. Quem decide é `resolveTemplateChannel`, num lugar só, testado.
 *
 * `verify_jwt = false` no config.toml ⇒ esta função é publicamente alcançável e
 * TODO gate é interno. Ver o comentário da entrada no config.toml.
 */
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import { canUserAccessFeature } from "../_shared/permission_engine.ts";
import { logRuntime } from "../_shared/logger.ts";
import { getTraceContext } from "../_shared/request-trace.ts";
import { orgConfigFrom, readNotificameBaseUrl, readNotificameFlags } from "../_shared/notificame.ts";
import { loadNotificameSubaccount } from "../_shared/notificame-credentials.ts";
import {
  createTemplate,
  listTemplates,
  type CreateTemplateInput,
} from "../_shared/notificame-templates.ts";
import {
  resolveTemplateChannel,
  type TemplateInstanceRow,
} from "../_shared/notificame-template-access.ts";
import {
  validateTemplateDraft,
  type TemplateDraft,
} from "../_shared/notificame-template-validate.ts";

const FUNCTION_NAME = "notificame-templates";
const MANAGE_INSTANCES_FEATURE = "whatsapp.manage_instances";

/** O uuid da NOSSA linha em `whatsapp_instances` — nunca o id do fornecedor. */
function readInstanceId(body: Record<string, unknown>): string {
  const raw = body.instance_id ?? body.instanceId;
  return typeof raw === "string" ? raw.trim() : "";
}

/** Ação ausente é `list` — a leitura é o caminho inócuo, e default tem que ser o inócuo. */
function readAction(body: Record<string, unknown>): "list" | "create" | "unknown" {
  const raw = typeof body.action === "string" ? body.action.trim().toLowerCase() : "list";
  if (raw === "" || raw === "list") return "list";
  if (raw === "create") return "create";
  return "unknown";
}

/** Lê o rascunho SEM confiar em nada: o validador decide o que presta. */
function readDraft(body: Record<string, unknown>): TemplateDraft {
  const raw = (body.template ?? {}) as Record<string, unknown>;
  const components = Array.isArray(raw.components) ? raw.components : [];
  return {
    name: typeof raw.name === "string" ? raw.name.trim() : "",
    language: typeof raw.language === "string" ? raw.language.trim() : "",
    category: (typeof raw.category === "string"
      ? raw.category.trim().toUpperCase()
      : "") as TemplateDraft["category"],
    components: components.map((c) => {
      const comp = (c ?? {}) as Record<string, unknown>;
      return {
        type: typeof comp.type === "string" ? comp.type.trim().toUpperCase() : "",
        format: typeof comp.format === "string" ? comp.format.trim().toUpperCase() : undefined,
        text: typeof comp.text === "string" ? comp.text : undefined,
        buttons: Array.isArray(comp.buttons) ? comp.buttons : undefined,
        // O exemplo das variáveis. Sem esta linha o campo morria AQUI:
        // `buildCreateTemplateBody` sabe emiti-lo e nunca recebia, então todo
        // template com `{{n}}` era recusado pela Meta horas depois.
        example: comp.example,
      };
    }),
  };
}

Deno.serve(withErrorBoundary(FUNCTION_NAME, async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin") ?? undefined));
  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
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

  const instanceId = readInstanceId(body);
  if (!instanceId) {
    return new Response(
      JSON.stringify({ error: "instance_id é obrigatório", code: "instance_id_required" }),
      { status: 400, headers },
    );
  }

  const action = readAction(body);
  if (action === "unknown") {
    return new Response(
      JSON.stringify({ error: "Ação desconhecida", code: "unknown_action" }),
      { status: 400, headers },
    );
  }

  const trace = getTraceContext(req);
  const admin = createAdminClient(FUNCTION_NAME);

  const flags = await readNotificameFlags(admin, orgId);
  if (!flags.enabled) {
    return new Response(
      JSON.stringify({
        error: "Recurso não habilitado para esta organização",
        code: "feature_disabled",
      }),
      { status: 403, headers },
    );
  }

  if (!(await canUserAccessFeature(admin, auth.userId, orgId, MANAGE_INSTANCES_FEATURE))) {
    await logRuntime({
      organizationId: orgId,
      module: "channel",
      action: "notificame.templates_permission_denied",
      status: "error",
      errorMessage: "usuário sem whatsapp.manage_instances tentou listar templates",
      entityType: "whatsapp_instance",
      triggeredBy: auth.userId,
      payloadSnapshot: { instance_id: instanceId },
      ...trace,
    });
    return new Response(
      JSON.stringify({
        error: "Você não tem permissão para ver os templates desta organização",
        code: "permission_denied",
      }),
      { status: 403, headers },
    );
  }

  // Submeter é ato na conta do cliente na Meta, entra na fila de revisão dela e
  // a recusa conta contra a reputação do número. Ler não é nada disso — por isso
  // o admin é exigido só aqui, e não no gate de cima.
  if (action === "create" && !auth.isAdmin) {
    await logRuntime({
      organizationId: orgId,
      module: "permission",
      action: "notificame.template_create_admin_denied",
      status: "error",
      errorMessage:
        `User ${auth.userId} (role: ${auth.role}) tentou criar template — exige admin ou master`,
      entityType: "whatsapp_instance",
      triggeredBy: auth.userId,
      payloadSnapshot: { instance_id: instanceId },
      ...trace,
    });
    return new Response(
      JSON.stringify({
        error: "Apenas administradores podem criar templates",
        code: "permission_denied",
      }),
      { status: 403, headers },
    );
  }

  // Sem `.eq("organization_id", …)` — ver o cabeçalho. Quem confere a org é o
  // gate puro, e é ele que os testes exercitam.
  const { data: instanceRow } = await admin
    .from("whatsapp_instances")
    .select("id, organization_id, provider, provider_config")
    .eq("id", instanceId)
    .maybeSingle();

  const resolution = resolveTemplateChannel(instanceRow as TemplateInstanceRow | null, orgId);
  if (!resolution.ok) {
    // Tentativa de ler canal de outra org é evento de SEGURANÇA, não ruído de
    // validação — o 404 devolvido ao cliente é indistinguível de "não existe",
    // então a trilha é o único lugar onde a diferença aparece.
    if (resolution.code === "channel_not_found") {
      await logRuntime({
        organizationId: orgId,
        module: "channel",
        action: "notificame.templates_channel_denied",
        status: "error",
        errorMessage: `instância ${instanceId} não pertence à org ${orgId} (ou não existe)`,
        entityType: "whatsapp_instance",
        triggeredBy: auth.userId,
        payloadSnapshot: { instance_id: instanceId },
        ...trace,
      });
    }
    return new Response(
      JSON.stringify({ error: resolution.error, code: resolution.code }),
      { status: resolution.status, headers },
    );
  }

  const subaccount = await loadNotificameSubaccount(admin, orgId);
  if (!subaccount) {
    return new Response(
      JSON.stringify({
        error: "Esta organização ainda não tem uma subconta pronta no NotificaMe",
        code: "subaccount_not_ready",
      }),
      { status: 409, headers },
    );
  }

  const cfg = orgConfigFrom(readNotificameBaseUrl(Deno.env), subaccount.companyUuid);

  // ── Submeter ───────────────────────────────────────────────────────────────
  if (action === "create") {
    // Valida ANTES da rede. A recusa da Meta é assíncrona e genérica: o template
    // entra PENDING e volta REJECTED horas depois, sem dizer qual regra quebrou.
    // Todo problema que dá para ver daqui tem que ser visto daqui.
    const draft = readDraft(body);
    const problems = validateTemplateDraft(draft);
    if (problems.length > 0) {
      return new Response(
        JSON.stringify({
          error: "O template tem problemas que a Meta recusaria",
          code: "template_invalid",
          problems,
        }),
        { status: 422, headers },
      );
    }

    try {
      const created = await createTemplate(cfg, resolution.channelId, draft as CreateTemplateInput);

      // Trilha do ato externo: a submissão sai do nosso alcance depois daqui, e
      // sem esta linha "quem submeteu este template, e quando?" fica sem resposta.
      await logRuntime({
        organizationId: orgId,
        module: "channel",
        action: "notificame.template_created",
        status: "success",
        entityType: "whatsapp_instance",
        triggeredBy: auth.userId,
        payloadSnapshot: {
          instance_id: instanceId,
          template_name: draft.name,
          category: draft.category,
          language: draft.language,
          vendor_status: created.status,
        },
        ...trace,
      });

      // `PENDING` é o SUCESSO NORMAL — a Meta ainda vai revisar. A tela precisa
      // dizer isso, senão o usuário lê "criado" e tenta enviar em seguida.
      return new Response(JSON.stringify({ template: created }), { status: 201, headers });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      await logRuntime({
        organizationId: orgId,
        module: "channel",
        action: "notificame.template_create_failed",
        status: "error",
        errorMessage: detail,
        entityType: "whatsapp_instance",
        triggeredBy: auth.userId,
        payloadSnapshot: { instance_id: instanceId, template_name: draft.name },
        ...trace,
      });
      return new Response(
        JSON.stringify({ error: "Não foi possível criar o template", code: "upstream_failed" }),
        { status: 502, headers },
      );
    }
  }

  // ── Listar ─────────────────────────────────────────────────────────────────
  try {
    const templates = await listTemplates(cfg, resolution.channelId);
    return new Response(
      JSON.stringify({ templates, count: templates.length }),
      { status: 200, headers },
    );
  } catch (e) {
    // O fornecedor devolve Hub404 em HTTP 200 e AUTHENTICATION_ERROR em HTTP 404
    // — `listTemplates` já julga PELO CORPO e levanta. Aqui a falha vira 502
    // porque a origem é o upstream, não o pedido do cliente: 200 com lista vazia
    // seria a mentira mais fácil de contar, e a tela mostraria "nenhum template"
    // para uma conta cheia deles.
    const detail = e instanceof Error ? e.message : String(e);
    await logRuntime({
      organizationId: orgId,
      module: "channel",
      action: "notificame.templates_upstream_failed",
      status: "error",
      errorMessage: detail,
      entityType: "whatsapp_instance",
      triggeredBy: auth.userId,
      payloadSnapshot: { instance_id: instanceId },
      ...trace,
    });
    return new Response(
      JSON.stringify({ error: "Não foi possível ler os templates", code: "upstream_failed" }),
      { status: 502, headers },
    );
  }
}));
