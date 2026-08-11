/**
 * Runtime logger for Supabase Edge Functions
 *
 * Inserts structured log records into the runtime_logs table.
 * Never throws — silently fails to avoid breaking the main flow.
 *
 * Security: all payloads pass through redactSecrets() before persisting.
 * Over-redaction (e.g. user_token_count matched by "token") is intentional —
 * security > debug verbosity.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logError } from "./error-boundary.ts";

/**
 * Key patterns to redact (case-insensitive substring match on key name).
 * Over-redaction is acceptable — a false positive loses debug info,
 * a false negative leaks a credential.
 */
const SENSITIVE_KEY_PATTERNS = [
  "uazapi_token",
  "admin_token",
  "admintoken",
  "token",
  "apikey",
  "api_key",
  "api-key",
  "authorization",
  "webhook_secret",
  "x-uazapi-webhook-secret",
  "bearer",
  "password",
  "secret",
];

const REDACTED = "***REDACTED***";
const BEARER_RE = /^(Bearer|Basic)\s+\S+/i;

/**
 * Chaves cujo valor é um telefone. Um telefone em `runtime_logs` é PII de um
 * *lead do nosso cliente* — não do nosso cliente. Redigir por completo
 * inviabilizaria correlacionar um log a uma conversa; deixar em claro é
 * inaceitável. Mascaramos o miolo, preservando prefixo e sufixo.
 *
 * Credencial vence telefone: uma chave que case as duas listas é redigida
 * inteira (`isSensitiveKey` é avaliado primeiro).
 */
const PHONE_KEY_PATTERNS = ["phone", "telefone", "remote_jid", "msisdn"];

/** Menos que isto e o mascaramento revelaria o número inteiro. */
const MIN_MASKABLE_DIGITS = 10;

function isPhoneKey(key: string): boolean {
  const lower = key.toLowerCase();
  return PHONE_KEY_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Mascara toda sequência longa de dígitos, mantendo os 4 primeiros e os 4
 * últimos. Aplicado sobre a string inteira, preserva o sufixo de um JID
 * (`@s.whatsapp.net`, `@g.us`) sem precisar conhecê-lo.
 */
function maskPhone(value: string): string {
  let masked = false;
  const out = value.replace(/\d{6,}/g, (digits) => {
    if (digits.length < MIN_MASKABLE_DIGITS) return digits;
    masked = true;
    return digits.slice(0, 4) + "*".repeat(digits.length - 8) + digits.slice(-4);
  });
  return masked ? out : REDACTED;
}

/**
 * Returns true if the given key name should have its value redacted.
 * Match is case-insensitive substring: if the key contains any sensitive
 * pattern, it is redacted.
 */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Redacts a string value: if it starts with "Bearer " or "Basic ",
 * preserves the prefix and replaces the credential portion.
 */
function redactString(value: string): string {
  if (BEARER_RE.test(value)) {
    const spaceIdx = value.indexOf(" ");
    return value.slice(0, spaceIdx + 1) + REDACTED;
  }
  return value;
}

/**
 * Pure function. Deep-clones input and replaces sensitive values with
 * "***REDACTED***". Handles objects, arrays, primitives, null, undefined.
 * Circular references are detected via a WeakSet and replaced with the
 * string "[Circular]" to prevent stack overflow.
 *
 * Over-redaction note: any key whose name CONTAINS a sensitive pattern
 * (e.g. "user_token_count") will be redacted. This is intentional.
 *
 * @param input - Any JSON-like value
 * @param _seen - Internal WeakSet for circular reference tracking
 */
export function redactSecrets(input: unknown, _seen?: WeakSet<object>): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === "string") return redactString(input);
  if (typeof input !== "object") return input;

  // Circular reference guard
  const seen = _seen ?? new WeakSet<object>();
  if (seen.has(input as object)) return "[Circular]";
  seen.add(input as object);

  if (Array.isArray(input)) {
    const result = (input as unknown[]).map((item) => redactSecrets(item, seen));
    seen.delete(input as object);
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      // Preserve Bearer/Basic prefix even when key is sensitive
      if (typeof value === "string" && BEARER_RE.test(value)) {
        const spaceIdx = value.indexOf(" ");
        result[key] = value.slice(0, spaceIdx + 1) + REDACTED;
      } else {
        result[key] = REDACTED;
      }
    } else if (isPhoneKey(key)) {
      result[key] = typeof value === "string" ? maskPhone(value) : REDACTED;
    } else {
      result[key] = redactSecrets(value, seen);
    }
  }

  seen.delete(input as object);
  return result;
}

/**
 * Vocabulário de `runtime_logs.module`.
 *
 * Garantido aqui, em compile time — a tabela deliberadamente NÃO tem CHECK.
 * Um CHECK falharia em runtime, no INSERT, e `logRuntime` engole a falha por
 * design (telemetria não pode derrubar edge function): o constraint destruiria
 * silenciosamente a linha que deveria proteger. Já destruiu — ver a migration
 * 20270115. Ao adicionar um módulo, adicione o literal aqui.
 */
/**
 * Vocabulário de `runtime_logs.actor_type` (ADR-0021 §7).
 *
 * Garantido aqui em compile time — a coluna deliberadamente NÃO tem CHECK
 * (mesma razão de `module`: `logRuntime` engole a falha do insert, então um
 * constraint de runtime destruiria em silêncio a linha que deveria proteger).
 *
 * `gestor` é o único produzido hoje (o único ator cujo `triggered_by` sozinho
 * não revela que a escrita é cross-org). Os demais existem para forward-safety.
 */
export type RuntimeActorType = "gestor" | "master" | "member" | "system";

export type RuntimeLogModule =
  | "agent"
  | "analytics"
  | "auth"
  // SCRUM-289: o checkout e a área de billing do admin passam a registrar aqui.
  // `runtime_logs.module` não tem CHECK no banco (só `status` tem), então o
  // vocabulário fechado é ESTE — e é o único lugar que impede o próximo módulo
  // de nascer como "billling" e sumir das buscas.
  | "billing"
  | "calendar"
  | "campaign"
  | "carteira"
  | "channel"
  | "copilot"
  | "followup"
  | "general"
  | "governor"
  | "job_monitor"
  | "lead"
  | "media"
  | "meeting"
  | "outbound"
  | "permission"
  | "pipe_dispatch"
  | "pipe_distribution"
  | "scheduled_user_messages"
  | "support"
  | "sz_chat"
  | "tts"
  | "voip"
  | "webhook"
  | "whatsapp"
  | "workflow";

interface LogRuntimeParams {
  organizationId?: string;
  module: RuntimeLogModule;
  action: string;
  status: "success" | "error" | "skipped";
  payloadSnapshot?: Record<string, unknown>;
  errorMessage?: string;
  entityType?: string;
  entityId?: string;
  triggeredBy?: string;
  // Onda 2 / T2.B.2: telemetria de performance + custo LLM
  durationMs?: number;
  tokens?: { prompt?: number; completion?: number; model?: string };
  // RC.1: chain-of-thought capturado do agente (extraído de <thinking>...</thinking>)
  reasoning?: string;
  // ADR-0017: correlação com a sessão de navegação do usuário. Use
  // `getTraceContext(req)` de `_shared/request-trace.ts` para preenchê-los.
  sessionId?: string | null;
  requestId?: string | null;
  // ADR-0021 §7: quando o ator é um Gestor de Portfólio (scoped master atuando
  // numa org vinculada), marca a linha com o tipo de ator e o `gestores.id`
  // REAL. `triggeredBy` continua sendo o auth.users.id real do gestor. Só é
  // gravado quando `actorType` está setado — log normal mantém a MESMA forma de
  // insert (zero regressão antes da migration 20270211000003 ser aplicada).
  // Use `gestorRuntimeActor()` de `_shared/gestor-auth.ts` para preenchê-los.
  actorType?: RuntimeActorType;
  gestorId?: string;
}

/**
 * Último recurso quando o canal de registro é o que falhou.
 *
 * `runtime_logs` está fora — logo, o relato NÃO pode passar por `runtime_logs`.
 * `logError` escreve uma linha estruturada em `console.error`, coletada nos logs
 * da própria edge function: o único canal que sobra quando o banco cai. Nunca
 * lança — telemetria não derruba o chamador.
 */
async function reportLogFailure(
  cause: unknown,
  params: LogRuntimeParams,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    console.warn("[logRuntime] Failed to write log (non-fatal):", cause);
    // Surface persistent insert failures to runtime logs instead of swallowing them.
    // A CHECK/enum drift can silently drop an entire module's logs (incident
    // 2026-06-24: 'whatsapp' missing from runtime_logs_module_check dropped 100%
    // of WhatsApp telemetry for days, hiding the inbound outage). logError
    // never throws, so this stays strictly non-fatal on the hot path.
    await logError(cause, {
      functionName: "logRuntime",
      organizationId: params.organizationId,
      extra: {
        log_module: params.module,
        log_action: params.action,
        log_status: params.status,
        ...extra,
      },
    });
  } catch {
    // never let observability reporting break the caller
  }
}

/**
 * Inserts a runtime_logs record using the service role key.
 * Never throws — if the insert fails, it reports the failure to the function's
 * own console log (the only channel left when the database is the thing that
 * broke) and returns.
 * All payloadSnapshot data is passed through redactSecrets() before persisting.
 */
export async function logRuntime(params: LogRuntimeParams): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return;

    // Mesma configuração de `_shared/supabase-admin.ts`. Um cliente `service_role`
    // não tem sessão de usuário para renovar nem persistir, mas o auth-js arma um
    // `setInterval` de 30 s por cliente (`_startAutoRefresh`) que ninguém desarma.
    // Como `logRuntime` cria um cliente POR CHAMADA dentro de isolates de vida
    // longa, cada requisição registrada deixava um temporizador para trás — em
    // todas as 78+ edge functions.
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const sanitizedPayload = params.payloadSnapshot
      ? (redactSecrets(params.payloadSnapshot) as Record<string, unknown>)
      : undefined;

    const row: Record<string, unknown> = {
      organization_id: params.organizationId || null,
      module: params.module,
      action: params.action,
      status: params.status,
      payload_snapshot: sanitizedPayload || null,
      error_message: params.errorMessage || null,
      entity_type: params.entityType || null,
      entity_id: params.entityId || null,
      triggered_by: params.triggeredBy || null,
      duration_ms: params.durationMs ?? null,
      prompt_tokens: params.tokens?.prompt ?? null,
      completion_tokens: params.tokens?.completion ?? null,
      llm_model: params.tokens?.model ?? null,
      reasoning: params.reasoning ?? null,
      session_id: params.sessionId ?? null,
      request_id: params.requestId ?? null,
    };

    // ADR-0021 §7: só toca as colunas de atribuição do gestor quando há ator
    // gestor. Mantém o insert idêntico para todo o resto — o dia em que a
    // migration 20270211000003 ainda não rodou, log normal não referencia
    // colunas inexistentes e não cai no drop silencioso.
    if (params.actorType) {
      row.actor_type = params.actorType;
      if (params.gestorId) row.gestor_id = params.gestorId;
    }

    // `supabase-js` RESOLVE com `{ error }` em vez de lançar: descartar este
    // retorno fazia a falha de escrita não produzir sinal nenhum — `logRuntime`
    // ficava muda exatamente durante a indisponibilidade do banco, que é quando
    // a linha mais importa. O `catch` abaixo nunca veria isto.
    const { error: insertError } = await supabase.from("runtime_logs").insert(row);
    if (insertError) {
      await reportLogFailure(
        new Error(`runtime_logs insert failed: ${insertError.message}`),
        params,
        {
          db_code: insertError.code,
          db_details: insertError.details,
          db_hint: insertError.hint,
        },
      );
    }
  } catch (err) {
    await reportLogFailure(err, params);
  }
}
