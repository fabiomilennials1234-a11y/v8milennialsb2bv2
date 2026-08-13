/**
 * notificame-channel-start — decide QUEM pode receber a credencial da subconta e
 * QUANDO a subconta passa a existir. Duas perguntas distintas, dois modos.
 *
 * ⚠️ A CREDENCIAL QUE SAI DAQUI NÃO É ROTACIONÁVEL. O `company_uuid` da
 * querystring do popup É o `CompanyId` da subconta, e o `CompanyId` É o token
 * dela — o mesmo token com que a fatia 2 vai ENVIAR pelo número oficial da
 * empresa. Ele é IMUTÁVEL no fornecedor: não há endpoint de rotação, não há
 * revogação, e a subconta é IRREMOVÍVEL. Quem copiou esse token do DevTools uma
 * vez fala com `api.notificame.com.br` em nome da org PARA SEMPRE, por fora do
 * Torque — sem allowed-members, sem limite de disparo, sem trilha nossa. Não
 * existe remediação depois do vazamento; só existe não vazar. É por isso que o
 * gate abaixo é de ADMIN e não de feature permission (ver §2).
 *
 * DOIS MODOS, um parâmetro (`mode`), e o default é o INÓCUO:
 *   • `"status"` (sonda de mount, e o FALLBACK de qualquer valor desconhecido) —
 *     LEITURA PURA. Zero escrita nossa, zero chamada ao fornecedor. Responde se a
 *     plataforma está configurada e, se a org JÁ tem subconta, devolve a
 *     `start_url` pré-montada (é ela que permite o `window.open` síncrono no
 *     clique). Sem subconta ainda: `start_url: null` — e isso NÃO é estado de
 *     erro, é "ainda não provisionada".
 *   • `"connect"` (SÓ no clique explícito) — PROVISIONA a subconta (idempotente),
 *     monta a `start_url` e fotografa os canais que já existiam, devolvendo
 *     `session_id`.
 *
 * POR QUE O DEFAULT É `status`: do outro lado de `mode:"connect"` está
 * `POST /v2/accounts`, que cria no fornecedor um objeto IRREMOVÍVEL e FATURÁVEL.
 * Antes, a sonda de MOUNT provisionava: abrir Configurações → WhatsApp criava uma
 * subconta sem ninguém clicar em nada, e um master passeando pelas orgs criava
 * uma em nome de CADA org cuja tela ele abrisse. Um corpo malformado, um cliente
 * antigo ou um campo com typo agora caem em leitura pura — nunca em criação de
 * conta. Fail-closed aqui é fail-closed no dinheiro.
 *
 * A idempotência de verdade continua no BANCO — `UNIQUE (organization_id)` em
 * `notificame_subaccounts`, com a claim gravada ANTES da chamada ao fornecedor.
 * O modo `status` é a primeira barreira; a UNIQUE é a que vale sob dois browsers.
 *
 * SEGURANÇA — cinco invariantes:
 *   1. A org vem do contexto de auth VALIDADO (`requireAuth` com
 *      `requireOrganization: true`), NUNCA do corpo. O body só PROPÕE a org; o
 *      SELECT em `team_members` dentro do requireAuth CONFIRMA a membresia. Sem
 *      `requireOrganization`, um usuário multi-org cairia no fallback legado
 *      ("primeiro team_member por created_at", com um mero console.warn) e ligaria
 *      o canal na org errada em silêncio.
 *   2. ADMIN OU MASTER (`auth.isAdmin`), e SÓ DEPOIS a feature permission
 *      `whatsapp.manage_instances`. Os dois, não um. A feature permission sozinha
 *      NÃO é gate: no seed ela tem `default_value = true` e `is_admin_only =
 *      false`, então todo membro ativo sem override explícito passa — e passar
 *      aqui significa receber, no próprio browser, um token que não se revoga.
 *      Este endpoint não autoriza uma escrita; ele ENTREGA UMA CREDENCIAL. O
 *      degrau tem que ser o do dono da org, não o do operador do inbox.
 *   3. O `redirect_origin` sai do header `Origin` da requisição, validado contra a
 *      allowlist do `getCorsHeaders` — NUNCA do body. Ecoar uma origem escolhida
 *      pelo cliente dentro de uma URL que nós abrimos é vetor de redirect.
 *   4. O `NOTIFICAME_API_TOKEN` é da CONTA-MÃE: a revenda inteira, TODAS as orgs.
 *      Ele é usado aqui para PROVISIONAR e nunca sai do servidor — não entra em
 *      resposta, log nem mensagem de erro. O que sai na `start_url` é o token DA
 *      SUBCONTA daquela org. Trocar um pelo outro nesta linha é o pior bug
 *      possível desta fatia; é por isso que o tipo `NotificameParentConfig` não
 *      tem `companyUuid`.
 *   5. Com `verify_jwt = false` esta função é publicamente alcançável. Gate só no
 *      frontend não é gate — os dois de §2 são server-side de propósito.
 *
 * DESVIO DELIBERADO do precedente: falha de configuração OU de provisionamento
 * devolve HTTP **200** `{ configured:false, code, reason }`, não 502/503. Não é
 * preguiça: `supabase.functions.invoke` embrulha respostas não-2xx e ESCONDE o
 * corpo — e é justamente esse corpo que faz o card nascer desabilitado com o
 * motivo legível. A severidade vive em `runtime_logs` com `status:'error'`, não no
 * status HTTP. Autorização é a exceção: 403 é 403, e o cliente lê o `code`.
 *
 * ESTADO INERTE: sem `NOTIFICAME_API_TOKEN`, `NOTIFICAME_SUBACCOUNT_DEFAULTS` ou
 * `NOTIFICAME_ENCRYPTION_KEY`, esta função responde `configured:false` com motivo
 * e NADA é criado no fornecedor. É o estado correto de merge.
 */

import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import { canUserAccessFeature } from "../_shared/permission_engine.ts";
import { logRuntime } from "../_shared/logger.ts";
import { getTraceContext } from "../_shared/request-trace.ts";
import {
  readNotificameParentConfig,
  readSubaccountDefaults,
  buildSeamlessStartUrl,
  isNotificameEnabledForOrg,
  listChannels,
  orgConfigFrom,
} from "../_shared/notificame.ts";
import {
  ensureNotificameSubaccount,
  loadNotificameSubaccount,
} from "../_shared/notificame-credentials.ts";
import { openConnectSession } from "../_shared/notificame-sessions.ts";

const FUNCTION_NAME = "notificame-channel-start";

/** A mesma feature key que `useCanManageWhatsApp` aplica na UI. Igualar, não endurecer. */
const MANAGE_INSTANCES_FEATURE = "whatsapp.manage_instances";

/**
 * Só `"connect"` provisiona. Qualquer outra coisa — ausente, typo, cliente
 * antigo, corpo forjado — é leitura pura. O default INÓCUO é o desenho: o modo
 * caro tem que ser pedido por extenso.
 */
function readMode(body: Record<string, unknown>): "status" | "connect" {
  return body.mode === "connect" ? "connect" : "status";
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

  const mode = readMode(body);

  // ── Auth: a org vem da membresia VALIDADA, nunca do body ───────────────────
  let auth;
  try {
    auth = await requireAuth(req, { body, requireOrganization: true });
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
    throw e;
  }

  // Parece morto depois do `requireOrganization` e NÃO é: é a rede contra a
  // string vazia atravessando a validação.
  const orgId = auth.organizationId;
  if (!orgId) {
    return new Response(
      JSON.stringify({ error: "organization_id_required", code: "organization_id_required" }),
      { status: 400, headers },
    );
  }

  // ── Gate de feature, server-side (verify_jwt=false ⇒ alcançável de fora) ────
  const admin = createAdminClient(FUNCTION_NAME);
  if (!(await isNotificameEnabledForOrg(admin, orgId))) {
    return new Response(
      JSON.stringify({
        error: "Recurso não habilitado para esta organização",
        code: "feature_disabled",
      }),
      { status: 403, headers },
    );
  }

  const trace = getTraceContext(req);

  // ── Gate 1: ADMIN OU MASTER ────────────────────────────────────────────────
  // Inline em vez de `requireAdmin(req, …)` por um motivo só: a assinatura de
  // `requireAdmin` não expõe `requireOrganization`, e perdê-lo devolveria o
  // fallback "primeiro team_member por created_at" ao usuário multi-org (§1). O
  // corpo abaixo é o de `requireAdmin`, com a trilha idêntica.
  //
  // `auth.isAdmin` = master ∪ gestor de portfólio (ADR-0021) ∪ role 'admin' da
  // org. O Gestor entra DE PROPÓSITO e não por descuido: é operador do Torque com
  // equivalência de admin para escrita operacional, e conectar o canal do cliente
  // é literalmente o trabalho dele. O carve-out §3 do ADR-0021 (negar o Gestor) é
  // para roster e billing DO CLIENTE — não é este caso.
  if (!auth.isAdmin) {
    await logRuntime({
      organizationId: orgId,
      module: "permission",
      action: "notificame.admin_denied",
      status: "error",
      errorMessage:
        `User ${auth.userId} (role: ${auth.role}) tentou obter a credencial da subconta ` +
        `NotificaMe — exige admin ou master`,
      entityType: "whatsapp_instance",
      triggeredBy: auth.userId,
      payloadSnapshot: { mode },
      ...trace,
    });
    return new Response(
      JSON.stringify({
        error: "Apenas administradores podem conectar o WhatsApp Oficial",
        code: "permission_denied",
      }),
      { status: 403, headers },
    );
  }

  // ── Gate 2: feature permission, a MESMA chave do frontend ──────────────────
  // Depois do admin, e não no lugar dele: esta chave nasce `default_value = true`
  // e `is_admin_only = false` no seed, então sozinha ela liberaria todo membro
  // ativo. Ela continua aqui porque um admin PODE ter a feature revogada por
  // override explícito, e nesse caso o "não" tem que valer.
  //
  // `canUserAccessFeature` e não `assertPermission`: a segunda é por AÇÃO, exige
  // registro na união `PermissionAction`, e seu exemplo-vitrine no repo é um gate
  // tautológico (a ação não está registrada em lugar nenhum e só não quebra
  // porque um role-check anterior já barra). Não copiar aquilo.
  if (!(await canUserAccessFeature(admin, auth.userId, orgId, MANAGE_INSTANCES_FEATURE))) {
    await logRuntime({
      organizationId: orgId,
      module: "channel",
      action: "notificame.permission_denied",
      status: "error",
      errorMessage: "usuário sem whatsapp.manage_instances tentou iniciar conexão",
      entityType: "whatsapp_instance",
      triggeredBy: auth.userId,
      payloadSnapshot: { mode },
      ...trace,
    });
    return new Response(
      JSON.stringify({
        error: "Você não tem permissão para conectar números nesta organização",
        code: "permission_denied",
      }),
      { status: 403, headers },
    );
  }

  // ── Estado INERTE: 200 (e não 503) porque a UI precisa LER o motivo ────────
  // A chave de cifra entra na conta: sem ela não há onde guardar o token de uma
  // subconta, e o `ensure` recusaria mais adiante. Descobrir isso no MOUNT deixa o
  // card honesto desde o primeiro segundo, em vez de só depois de um clique.
  const parent = readNotificameParentConfig(Deno.env);
  const defaults = readSubaccountDefaults(Deno.env);
  const hasEncryptionKey = (Deno.env.get("NOTIFICAME_ENCRYPTION_KEY") ?? "").trim().length > 0;
  if (!parent || !defaults || !hasEncryptionKey) {
    return new Response(
      JSON.stringify({
        configured: false,
        code: "not_configured",
        reason: "WhatsApp Oficial ainda não está configurado nesta plataforma",
      }),
      { status: 200, headers },
    );
  }

  // ── Origem do popup: do header Origin, validado contra a allowlist de CORS ──
  // `getCorsHeaders` FAZ FALLBACK para a primeira origem permitida quando a
  // recebida não está na allowlist. A igualdade abaixo é o que distingue
  // "permitida" de "substituída pelo fallback" — não troque por um teste de
  // presença.
  const origin = req.headers.get("origin") ?? "";
  const allowedOrigin = getCorsHeaders(origin)["Access-Control-Allow-Origin"];
  if (!origin || allowedOrigin !== origin) {
    return new Response(
      JSON.stringify({
        error: "Origem não permitida para iniciar a conexão",
        code: "origin_not_allowed",
      }),
      { status: 400, headers },
    );
  }

  const buildUrl = (companyUuid: string) =>
    // A linha pela qual este rework inteiro existe: `companyUuid` = token DA
    // SUBCONTA daquela org. Jamais `parent.parentToken`.
    buildSeamlessStartUrl({
      baseUrl: parent.baseUrl,
      companyUuid,
      redirectOrigin: origin,
      type: "whatsapp",
    });

  // ═══ MODO `status` — leitura pura, nada nasce no fornecedor ════════════════
  if (mode === "status") {
    const existing = await loadNotificameSubaccount(admin, orgId);
    return new Response(
      JSON.stringify({
        configured: true,
        // `null` quando a org ainda não tem subconta. O cliente NÃO trata isso
        // como indisponibilidade: o botão fica vivo, e o clique é que provisiona.
        start_url: existing ? buildUrl(existing.companyUuid) : null,
        session_id: null,
      }),
      { status: 200, headers },
    );
  }

  // ═══ MODO `connect` — o único caminho que gasta dinheiro no fornecedor ═════
  // Daqui para baixo houve um GESTO EXPLÍCITO do usuário: ele clicou em conectar.

  // ── Nome da org: identificação no painel de revenda. É o ÚNICO dado do ─────
  // cliente que sai para o fornecedor; CNPJ, telefone e endereço são NOSSOS.
  const { data: orgRow } = await admin
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  const orgName = ((orgRow as { name?: string } | null)?.name ?? "").trim() || `Torque ${orgId}`;

  // ── Subconta da org: idempotente, com claim no banco antes do fornecedor ───
  const ensured = await ensureNotificameSubaccount(admin, {
    organizationId: orgId,
    orgName,
    parent,
    defaults,
  });

  if (!ensured.ok) {
    if (ensured.code === "provisioning_in_progress") {
      return new Response(
        JSON.stringify({
          configured: false,
          code: "provisioning_in_progress",
          reason: "Estamos preparando sua conta oficial. Tente de novo em instantes.",
        }),
        { status: 200, headers },
      );
    }

    // 200 no HTTP, 'error' no runtime_logs. A severidade vive na trilha — o
    // status HTTP aqui existe para que o corpo chegue legível ao card.
    await logRuntime({
      organizationId: orgId,
      module: "channel",
      action: "notificame.subaccount_provision_failed",
      status: "error",
      errorMessage: `provisionamento da subconta falhou (${ensured.code})`,
      entityType: "whatsapp_instance",
      triggeredBy: auth.userId,
      payloadSnapshot: { code: ensured.code },
      ...trace,
    });
    // Três desfechos, três mensagens. Colapsar tudo em "tente de novo" seria
    // mentir em dois deles: chave inutilizável é problema NOSSO de plataforma (o
    // usuário pode clicar o dia inteiro), e reconciliação pendente é estado
    // TERMINAL — pode haver uma subconta viva e faturável do outro lado, e o
    // conserto é humano contra `GET /v1/resale/`. Convidar o cliente a insistir
    // ali é o convite que este ciclo de vida inteiro existe para retirar.
    const isPlatformConfig = ensured.code === "encryption_key_missing" ||
      ensured.code === "encryption_key_invalid";
    const needsReconciliation = ensured.code === "subaccount_needs_reconciliation";

    return new Response(
      JSON.stringify({
        configured: false,
        code: isPlatformConfig
          ? "not_configured"
          : needsReconciliation
          ? "subaccount_needs_reconciliation"
          : "subaccount_provision_failed",
        reason: isPlatformConfig
          ? "WhatsApp Oficial ainda não está configurado nesta plataforma"
          : needsReconciliation
          ? "Sua conta oficial precisa de uma verificação da nossa equipe. Fale com o suporte — reabrir esta tela não resolve."
          : "Não foi possível preparar sua conta oficial. Tente de novo em instantes.",
      }),
      { status: 200, headers },
    );
  }

  const subaccount = ensured.subaccount;

  // ── Sessão com BASELINE — a foto dos canais que a subconta JÁ tinha ────────
  // É ela que faz um popup abandonado deixar de travar a org em
  // `ambiguous_channel` para sempre: o canal órfão está na foto e sai da conta.
  // Numa subconta recém-criada a foto é vazia, e isso é o resultado correto.
  let sessionId: string | null = null;
  try {
    const orgCfg = orgConfigFrom(parent.baseUrl, subaccount.companyUuid);
    const existingChannels = await listChannels(orgCfg, fetch);
    sessionId = await openConnectSession(admin, {
      organizationId: orgId,
      userId: auth.userId,
      baselineChannelIds: existingChannels.map((c) => c.id),
    });
  } catch (err) {
    // A foto falhou, mas o popup JÁ está aberto no browser do usuário: derrubar
    // a resposta agora deixaria o fluxo sem contraparte — e, pior, sem a
    // `start_url` que o popup está esperando para navegar. Segue sem sessão: o
    // finish degrada para a regra sem baseline, que sob subconta já é escopada à
    // org. Silêncio não: fica a trilha de warning.
    await logRuntime({
      organizationId: orgId,
      module: "channel",
      action: "notificame.session_baseline_failed",
      // 'skipped' e não 'error': o fluxo continua e a sessão é que foi pulada.
      // `runtime_logs.status` só tem success|error|skipped — não invente valor,
      // o CHECK derruba a linha inteira e a trilha some (incidente 2026-06-24).
      status: "skipped",
      errorMessage: (err as Error)?.message ?? "falha ao fotografar canais",
      entityType: "whatsapp_instance",
      triggeredBy: auth.userId,
      ...trace,
    });
  }

  return new Response(
    JSON.stringify({
      configured: true,
      start_url: buildUrl(subaccount.companyUuid),
      session_id: sessionId,
    }),
    { status: 200, headers },
  );
}));
