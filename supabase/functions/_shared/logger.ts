/**
 * Runtime logger for Supabase Edge Functions
 *
 * Inserts structured log records into the runtime_logs table — in batches
 * (one POST per flush), with per-`module:action` sampling of high-volume
 * success rows; sampled-out rows go to console.info (function_logs) redacted.
 * Never throws — failures surface on the function's own console.
 *
 * Security: all payloads pass through redactSecrets() before persisting.
 *
 * ⚠️ O QUE ESTA LISTA NÃO RESOLVE: mensagem de exceção construída com o dado
 * dentro. `new Error(\`cliente inválido: cpf \${doc}\`)` vira `err.message` e
 * atravessa inteiro — a redação é por NOME DE CHAVE, e uma frase não tem chave.
 * A regra é não interpolar PII em texto de erro; para identificar a linha, use
 * o id do registro (`charge_id`, `organization_id`), que não é PII.
 * Over-redaction (e.g. user_token_count matched by "token") is intentional —
 * security > debug verbosity.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
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

/**
 * Chaves cujo valor é DOCUMENTO FISCAL do comprador (CPF/CNPJ).
 *
 * Entram no mapa agora porque até o billing existir não havia comprador no
 * produto — o autor original já tinha pensado em PII de lead (telefone), e
 * documento simplesmente não estava no mundo dele.
 *
 * Tratamento igual ao do telefone — mascarar, não apagar — pela mesma razão:
 * apagar por completo inviabiliza correlacionar um log a um atendimento. Mas o
 * corte é MAIS AGRESSIVO: só os dois últimos dígitos sobrevivem.
 *
 * Por que dois: num CPF os dois últimos são dígitos VERIFICADORES, derivados
 * dos nove primeiros — não acrescentam identidade a quem já tem o resto, e
 * sozinhos não reconstroem nada. Para correlacionar de verdade, use
 * `charge_id`/`organization_id`, que estão no mesmo registro e não são PII.
 */
const TAX_ID_KEY_PATTERNS = [
  "cpf", "cnpj", "tax_id", "taxid", "cpfcnpj", "documento", "doc_number",
];

/**
 * Chaves cujo valor é E-MAIL. Redigido INTEIRO, e a assimetria em relação ao
 * telefone é deliberada: e-mail identifica a pessoa sozinho e costuma ser a
 * própria credencial de acesso ao sistema, enquanto um telefone mascarado ainda
 * serve para casar com uma conversa. Correlação de e-mail se faz por `user_id`.
 */
const EMAIL_KEY_PATTERNS = ["email", "e_mail", "mail_to", "buyer_mail"];

/**
 * Chaves cujo valor é o NOME DO COMPRADOR. Redigido inteiro, como e-mail.
 *
 * ⚠️ O NOME DA CHAVE ENGANA, e enganou a mim primeiro: `legal_name` soa a razão
 * social — dado público na Receita — mas a coluna guarda o `CustomerInput.name`
 * que o gateway exige, e a tabela admite os DOIS ramos (`tax_id_kind` cpf ou
 * cnpj). No ramo **cpf**, que é o comprador pessoa física, isso é o **nome
 * civil de uma pessoa**: não está público em cadastro nenhum e não é derivável
 * de nada que já tenhamos.
 *
 * Ou seja, o argumento "é público, não precisa redigir" vale para metade da
 * tabela e falha na outra metade — e é a metade que falha que decide.
 *
 * Mesmo que fosse só CNPJ, dois motivos já bastariam:
 *
 * 1. A CASA JÁ DECIDIU O DESEMPATE, antes desta discussão — o cabeçalho deste
 *    arquivo diz que sobre-redação é política aceita: "a false positive loses
 *    debug info, a false negative leaks a credential".
 *
 * 2. "PÚBLICO EM OUTRO LUGAR" NÃO É "INOFENSIVO NO NOSSO LOG". O nome é
 *    consultável por qualquer um; o que vaza aqui é a CORRELAÇÃO — a empresa
 *    ligada a estado interno nosso e a dado de pagamento. O dado público é o
 *    nome; o dado nosso é que ELA pagou, quanto, e o que quebrou no meio.
 *
 * O recorte é estreito de propósito e não tem o efeito colateral de `email`:
 * `legal_name` e `razao_social` não casam nenhuma outra chave do repositório.
 * `name` e `company` de LEAD seguem em claro — são o vocabulário do CRM, e
 * redigi-los apagaria o diagnóstico de metade dos fluxos.
 */
const LEGAL_NAME_KEY_PATTERNS = ["legal_name", "razao_social", "razaosocial"];

/** Menos que isto e o mascaramento revelaria o número inteiro. */
const MIN_MASKABLE_DIGITS = 10;

function isTaxIdKey(key: string): boolean {
  const lower = key.toLowerCase();
  return TAX_ID_KEY_PATTERNS.some((p) => lower.includes(p));
}

function isEmailKey(key: string): boolean {
  const lower = key.toLowerCase();
  return EMAIL_KEY_PATTERNS.some((p) => lower.includes(p));
}

function isLegalNameKey(key: string): boolean {
  const lower = key.toLowerCase();
  return LEGAL_NAME_KEY_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Deixa só os dois últimos dígitos. Valor curto demais para mascarar vira
 * REDACTED inteiro — mascarar 3 dígitos revelaria o número.
 */
function maskTaxId(value: string): string {
  const digitos = value.replace(/\D/g, "");
  if (digitos.length < 5) return REDACTED;
  return "*".repeat(digitos.length - 2) + digitos.slice(-2);
}

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
    } else if (isTaxIdKey(key)) {
      result[key] = typeof value === "string" ? maskTaxId(value) : REDACTED;
    } else if (isEmailKey(key)) {
      result[key] = REDACTED;
    } else if (isLegalNameKey(key)) {
      result[key] = REDACTED;
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
  // SCRUM-289: checkout e a área de billing do admin registram aqui.
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
  // O INV-5 (migration 20270811120000) JÁ escreve `module='seguranca'` e o
  // banco aceita — o vocabulário estava furado do lado que de fato o guarda.
  | "seguranca"
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

// ═══════════════════════════════════════════════════════════════════════════
// Lote, amostragem e rebaixamento (incidente OOM de 2026-10-05)
// ═══════════════════════════════════════════════════════════════════════════
//
// Antes: um POST /rest/v1/runtime_logs por chamada — 19.231/h no pico, 92k
// linhas/dia, 83k delas sucesso do whatsapp-webhook que nenhum leitor consulta.
// Agora: `logRuntime` redige, amostra e ENFILEIRA; um flush por isolate manda a
// fila num único insert. `await logRuntime()` significa "enfileirado";
// `await flushRuntimeLogs()` significa "persistido".

/** Teto da fila: chegou aqui, sai na hora, sem esperar a janela. */
const BATCH_MAX_ROWS = 100;
/** Janela de agregação dentro do Edge Runtime. Fora dele, próximo tick. */
const FLUSH_WINDOW_MS = 250;

/**
 * Taxa de amostragem por `module:action`, aplicada SÓ a `success`/`skipped`.
 * Erro é sempre 100%. Linha da trilha do gestor (`actorType`) é sempre 100%.
 * Ausente da tabela = taxa 1. A linha que entra leva `payload_snapshot._sample_rate`
 * — multiplique a contagem por 1/_sample_rate para estimar o volume real.
 * A que fica de fora vai para o console (function_logs, 7 dias) com `rt:1`.
 */
export const SUCCESS_SAMPLE_RATE: Readonly<Record<string, number>> = Object.freeze({
  "webhook:uazapi_process": 0.01,
  "webhook:uazapi_resolved_by_token_fallback": 0.01,
  "webhook:uazapi_group_message_skipped": 0.01,
  "webhook:uazapi_agent_message_dispatched": 0.05,
  "webhook:uazapi_receipt_unmatched": 0.1,
  "workflow:process_batch": 0.1,
  "whatsapp:run": 0.1,
});

type RuntimeLogRow = Record<string, unknown>;

/** Contexto mínimo para relatar a falha — da linha já redigida, nunca do params cru. */
interface FailureContext {
  organizationId?: string;
  module: string;
  action: string;
  status: string;
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
  ctx: FailureContext,
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
      organizationId: ctx.organizationId,
      extra: {
        log_module: ctx.module,
        log_action: ctx.action,
        log_status: ctx.status,
        ...extra,
      },
    });
  } catch {
    // never let observability reporting break the caller
  }
}

// ── Cliente: um por isolate ────────────────────────────────────────────────

type AdminClient = SupabaseClient;
let cachedClient: { url: string; key: string; client: AdminClient } | undefined;

function getClient(): AdminClient | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  if (cachedClient && cachedClient.url === url && cachedClient.key === key) {
    return cachedClient.client;
  }
  // Mesma configuração de `_shared/supabase-admin.ts`. Um cliente `service_role`
  // não tem sessão de usuário para renovar nem persistir, mas o auth-js arma um
  // `setInterval` de 30 s por cliente (`_startAutoRefresh`) que ninguém desarma.
  //
  // `global.fetch` resolve `globalThis.fetch` A CADA chamada: o supabase-js
  // captura o `fetch` no `createClient`, e um cliente de vida longa congelaria
  // o fetch do primeiro uso (dublês de teste, instrumentação posterior).
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => globalThis.fetch(input, init) },
  });
  cachedClient = { url, key, client };
  return client;
}

// ── Fila ───────────────────────────────────────────────────────────────────

interface EdgeRuntimeLike {
  waitUntil(promise: Promise<unknown>): void;
}

function edgeRuntime(): EdgeRuntimeLike | null {
  const er = (globalThis as { EdgeRuntime?: Partial<EdgeRuntimeLike> }).EdgeRuntime;
  return er && typeof er.waitUntil === "function" ? (er as EdgeRuntimeLike) : null;
}

let queue: RuntimeLogRow[] = [];
let windowTimer: ReturnType<typeof setTimeout> | undefined;
/** Resolve a promessa entregue ao `waitUntil` quando a janela foi armada. */
let releaseWindow: (() => void) | undefined;
const inFlight = new Set<Promise<void>>();

function registerWaitUntil(p: Promise<unknown>): void {
  try {
    edgeRuntime()?.waitUntil(p);
  } catch {
    // runtime recusou (isolate já encerrando) — o beforeunload ainda tenta
  }
}

/**
 * Arma a janela de agregação. No Edge Runtime a promessa da janela vai para o
 * `waitUntil` NA HORA de armar — sem isso o isolate pode ser reciclado depois
 * da resposta e antes dos 250 ms, levando a fila junto.
 */
function armWindow(): void {
  if (windowTimer !== undefined) return;
  const er = edgeRuntime();
  const pending = new Promise<void>((resolve) => {
    releaseWindow = resolve;
  });
  windowTimer = setTimeout(() => {
    windowTimer = undefined;
    startFlush();
  }, er ? FLUSH_WINDOW_MS : 0);
  if (er) registerWaitUntil(pending);
}

/** Tira a fila inteira e manda num insert. Nunca rejeita. */
function startFlush(): Promise<void> {
  if (windowTimer !== undefined) {
    clearTimeout(windowTimer);
    windowTimer = undefined;
  }
  const release = releaseWindow;
  releaseWindow = undefined;

  if (queue.length === 0) {
    release?.();
    return Promise.resolve();
  }
  const batch = queue;
  queue = [];

  const p: Promise<void> = sendBatch(batch).finally(() => {
    inFlight.delete(p);
    release?.();
  });
  inFlight.add(p);
  registerWaitUntil(p);
  return p;
}

/**
 * Esvazia a fila e espera tudo que está em voo. Use em teste, em script e em
 * qualquer ponto em que "persistido" importe. Nunca rejeita.
 */
export async function flushRuntimeLogs(): Promise<void> {
  do {
    startFlush();
    await Promise.all([...inFlight]);
  } while (queue.length > 0 || inFlight.size > 0);
}

// Isolate encerrando: última chance de esvaziar a fila. Não dá para aguardar
// aqui — o `waitUntil` registrado no enfileiramento é a garantia principal;
// este listener cobre o caso em que o runtime não o honrou.
try {
  const target = globalThis as unknown as {
    addEventListener?: (type: string, fn: () => void) => void;
  };
  target.addEventListener?.("beforeunload", () => {
    startFlush();
  });
} catch {
  // ambiente sem EventTarget global: o flush por janela continua valendo
}

/** Classe 22 (dado) e 23 (restrição): culpa de UMA linha, não do lote. */
function isRowLevelError(code: string | undefined): boolean {
  return typeof code === "string" && (code.startsWith("22") || code.startsWith("23"));
}

interface InsertError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

async function insertRows(client: AdminClient, rows: RuntimeLogRow[]): Promise<InsertError | null> {
  // `supabase-js` RESOLVE com `{ error }` em vez de lançar: descartar este
  // retorno fazia a falha de escrita não produzir sinal nenhum.
  const { error } = await client.from("runtime_logs").insert(rows);
  return error ?? null;
}

/**
 * Um insert para o lote inteiro. Se o banco recusar por erro de DADO (22xxx/
 * 23xxx), uma linha envenenada não pode levar as outras 99 junto: o lote é
 * refeito linha a linha (só neste caso — falha de rede/permissão não se
 * multiplica em N POSTs). Seja como for, a falha gera UM relato e devolve ao
 * console as linhas perdidas, já redigidas.
 */
async function sendBatch(batch: RuntimeLogRow[]): Promise<void> {
  try {
    const client = getClient();
    if (!client) {
      reportBatchFailure(new Error("runtime_logs: credenciais ausentes no flush"), batch);
      return;
    }

    const error = await insertRows(client, batch);
    if (!error) return;

    if (batch.length > 1 && isRowLevelError(error.code)) {
      const lost: RuntimeLogRow[] = [];
      let lastError: InsertError = error;
      for (const row of batch) {
        try {
          const single = await insertRows(client, [row]);
          if (single) {
            lost.push(row);
            lastError = single;
          }
        } catch {
          lost.push(row);
        }
      }
      if (lost.length > 0) {
        reportBatchFailure(new Error(`runtime_logs insert failed: ${consoleText(lastError.message)}`), lost, {
          db_code: lastError.code,
          db_details: safeDbDetails(lastError.details),
          db_hint: lastError.hint,
        });
      }
      return;
    }

    reportBatchFailure(new Error(`runtime_logs insert failed: ${consoleText(error.message)}`), batch, {
      db_code: error.code,
      db_details: safeDbDetails(error.details),
      db_hint: error.hint,
    });
  } catch (err) {
    reportBatchFailure(err, batch);
  }
}

/** Teto de `error_message` quando a linha vai ao console. */
const CONSOLE_ERROR_MESSAGE_MAX = 500;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…[+${value.length - max}]` : value;
}

/**
 * Sequência de dígitos com até 2 separadores entre eles: "5511987654321",
 * "(11) 98765-4321", "123.456.789-09", "12.345.678/0001-95". Não começa nem
 * termina colada em letra, dígito ou hífen: segmento de uuid/hex
 * ("…-0123456789ab", "12345678-1234-…") não é telefone.
 */
const DIGIT_RUN_RE = /(?<![\w-])\d(?:[\s().\/-]{0,2}\d)+(?![\w-])/g;
/** Data/hora ISO ("2026-10-05", "2026-10-05 15") não é PII — passa intacta. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2})?$/;

/** Dígito verificador de CPF (11) / CNPJ (14) válido → é documento, não telefone. */
function isTaxIdDigits(d: string): boolean {
  if (/^(\d)\1+$/.test(d)) return false;
  const dv = (base: string, pesos: number[]) => {
    const s = pesos.reduce((acc, p, i) => acc + Number(base[i]) * p, 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  if (d.length === 11) {
    const p1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
    const p2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    return dv(d, p1) === Number(d[9]) && dv(d, p2) === Number(d[10]);
  }
  if (d.length === 14) {
    const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    return dv(d, p1) === Number(d[12]) && dv(d, p2) === Number(d[13]);
  }
  return false;
}
// JID do WhatsApp (`<dígitos>@s.whatsapp.net`, `@g.us`, `@lid`) NÃO é e-mail:
// os dígitos vão para a máscara de telefone e o sufixo fica para diagnóstico.
const EMAIL_RE =
  /[A-Z0-9._%+-]+@(?!(?:s\.whatsapp\.net|g\.us|lid|broadcast|newsletter)\b)[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
/** Texto livre: abaixo disto não é telefone nem documento (ano, contagem, status HTTP). */
const MIN_FREE_TEXT_DIGITS = 8;

/**
 * Máscara de PII em TEXTO LIVRE (mensagem de erro, `details` do banco) — onde
 * não há nome de chave para `redactSecrets` decidir. E-mail sai inteiro como
 * REDACTED. Sequência com ≥8 dígitos é mascarada:
 *   - CONTÍGUA com ≥10 dígitos (telefone E.164, JID): política de `maskPhone`,
 *     4 primeiros + 4 últimos — casa com a conversa, igual ao payload;
 *   - CPF/CNPJ colado (DV válido), com SEPARADOR (CPF/CNPJ/telefone
 *     formatado) ou 8–9 dígitos: só os 2 últimos, como `maskTaxId` — 4+4
 *     revelaria 8 dos 11 dígitos de um CPF.
 * Data ISO e segmento de uuid/hex ficam intactos. Separadores e sufixo de JID
 * (`@s.whatsapp.net`, `@g.us`) sobrevivem. Só para o CONSOLE: o banco recebe
 * o texto original.
 */
function maskFreeText(value: string): string {
  return value
    .replace(EMAIL_RE, REDACTED)
    .replace(DIGIT_RUN_RE, (run) => {
      if (ISO_DATE_RE.test(run)) return run;
      const digits = run.replace(/\D/g, "");
      const total = digits.length;
      if (total < MIN_FREE_TEXT_DIGITS) return run;
      const phoneLike = total >= MIN_MASKABLE_DIGITS && /^\d+$/.test(run) && !isTaxIdDigits(digits);
      const keepHead = phoneLike ? 4 : 0;
      const keepTail = phoneLike ? 4 : 2;
      let seen = 0;
      return run.replace(/\d/g, (d) => {
        seen += 1;
        return seen <= keepHead || seen > total - keepTail ? d : "*";
      });
    });
}

/** Redação completa de texto livre para o console: credencial + PII + teto. */
function consoleText(value: string): string {
  return truncate(maskFreeText(String(redactSecrets(value))), CONSOLE_ERROR_MESSAGE_MAX);
}

/**
 * Projeção da linha para o CONSOLE (function_logs). Só `payload_snapshot` passa
 * por `redactSecrets` no enfileiramento; `reasoning` (chain-of-thought do
 * Copilot, com trecho da conversa do lead) e `error_message` (texto livre)
 * vão crus ao banco, que é master-only. O console não é: aqui `reasoning` sai
 * como `reasoning_len` e `error_message` sai redigido e truncado.
 */
function toConsoleSafe(row: RuntimeLogRow): RuntimeLogRow {
  const { reasoning, error_message, ...rest } = row;
  const out: RuntimeLogRow = { ...rest };
  if (typeof reasoning === "string") out.reasoning_len = reasoning.length;
  if (typeof error_message === "string") {
    out.error_message = consoleText(error_message);
  } else if (error_message !== undefined) {
    out.error_message = error_message;
  }
  return out;
}

/**
 * `details` do PostgREST em violação de NOT NULL/CHECK é "Failing row contains
 * (...)" — a linha INTEIRA, `reasoning` incluído. Nunca vai ao console assim.
 */
function safeDbDetails(details: string | null | undefined): string | null | undefined {
  if (typeof details !== "string") return details;
  if (/^failing row contains/i.test(details)) return "[omitido: Failing row contains — linha inteira]";
  return consoleText(details);
}

function reportBatchFailure(
  cause: unknown,
  rows: RuntimeLogRow[],
  extra?: Record<string, unknown>,
): void {
  try {
    const first = rows[0] ?? {};
    // Lote misto: a falha é do canal, não de uma org — não atribuir à 1ª linha.
    const orgs = new Set(rows.map((r) => r.organization_id ?? null));
    const organizationId = orgs.size === 1 ? ((first.organization_id as string | null) ?? undefined) : undefined;
    // Único lugar onde as linhas perdidas sobrevivem — na projeção segura.
    console.warn(
      `[logRuntime] lote de ${rows.length} linha(s) perdido:`,
      JSON.stringify(rows.map(toConsoleSafe)),
    );
    void reportLogFailure(
      cause,
      {
        organizationId,
        module: String(first.module ?? ""),
        action: String(first.action ?? ""),
        status: String(first.status ?? ""),
      },
      { ...extra, batch_size: rows.length },
    );
  } catch {
    // never let observability reporting break the caller
  }
}

function sampleRateFor(params: LogRuntimeParams): number {
  if (params.status === "error" || params.actorType) return 1;
  const rate = SUCCESS_SAMPLE_RATE[`${params.module}:${params.action}`];
  return typeof rate === "number" && rate > 0 && rate < 1 ? rate : 1;
}

/**
 * Registra uma linha em `runtime_logs` (service role), em lote.
 *
 * Assinatura e contrato preservados para os 449 chamadores: nunca lança, a
 * promessa resolve. O que mudou é o que a resolução significa — "enfileirado".
 * Erro e trilha do gestor disparam o flush na hora; o resto espera até 100
 * linhas ou 250 ms. Todo payload passa por `redactSecrets()` ANTES de entrar na
 * fila, e é essa mesma linha redigida que vai ao banco, ao console (amostrada
 * fora) ou ao relato de falha.
 */
// deno-lint-ignore require-await
export async function logRuntime(params: LogRuntimeParams): Promise<void> {
  try {
    if (!Deno.env.get("SUPABASE_URL") || !Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return;

    const sanitizedPayload = params.payloadSnapshot
      ? (redactSecrets(params.payloadSnapshot) as Record<string, unknown>)
      : undefined;

    const row: RuntimeLogRow = {
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

    // ADR-0021 §7: só toca as colunas de atribuição do gestor quando há ator.
    if (params.actorType) {
      row.actor_type = params.actorType;
      if (params.gestorId) row.gestor_id = params.gestorId;
    }

    const rate = sampleRateFor(params);
    if (rate < 1) {
      row.payload_snapshot = { ...(sanitizedPayload ?? {}), _sample_rate: rate };
      if (Math.random() >= rate) {
        // Rebaixamento: function_logs (7 dias, `query_logs`). A MESMA linha
        // redigida, na projeção de console — nunca o `params` cru.
        console.info(JSON.stringify({ rt: 1, ...toConsoleSafe(row) }));
        return;
      }
    }

    queue.push(row);
    if (params.status === "error" || params.actorType || queue.length >= BATCH_MAX_ROWS) {
      startFlush();
    } else {
      armWindow();
    }
  } catch (err) {
    void reportLogFailure(err, {
      organizationId: params?.organizationId,
      module: String(params?.module ?? ""),
      action: String(params?.action ?? ""),
      status: String(params?.status ?? ""),
    });
  }
}

