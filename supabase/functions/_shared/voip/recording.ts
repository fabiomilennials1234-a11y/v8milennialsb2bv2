/**
 * A gravação viaja da VPS para o armazenamento do CRM.
 *
 * O CRM VEM BUSCAR — a VPS nunca empurra (ADR-0026, decisão 5). A VPS anuncia
 * `recording-ready` no envelope assinado que já existe; a partir daí quem age é
 * este módulo, com um token que o próprio CRM cunha e a VPS verifica. A
 * assimetria é o desenho inteiro: uma VPS comprometida não escreve no Supabase,
 * porque não tem, e não pode ganhar, credencial para isso.
 *
 * O CAMINHO, EM QUATRO PASSOS, E A ORDEM É A DECISÃO
 * -------------------------------------------------
 *   1. GET na VPS (token `recording.read`)
 *   2. upload no bucket `call-recordings`
 *   3. `fn_voip_recording_stored` — só AGORA a gravação vira `ready`
 *   4. DELETE na VPS (token `recording.delete`), best-effort
 *
 * O passo 4 vem por último e não pode falhar o conjunto. Apagar antes de
 * registrar o endereço destruiria a única cópia existente se o passo 3 falhasse
 * — e não há de onde buscá-la de novo, porque a VPS não guarda histórico.
 *
 * QUALQUER PASSO QUE FALHA MARCA `failed`, NÃO AUSÊNCIA
 * ----------------------------------------------------
 * `recording_status` NULO significa "não houve gravação". Uma busca que falha
 * NÃO pode deixar o registro assim: o gestor ficaria esperando por um arquivo
 * que nunca vem, sem saber que não vem. Todo caminho de erro aqui termina em
 * `fn_voip_recording_failed` com a causa.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { signAdminToken } from "./tokens.ts";
import { logRuntime } from "../logger.ts";

/** O bucket privado da gravação. Ver 20270803000000_voip_recording_ingest.sql. */
export const RECORDING_BUCKET = "call-recordings";

/**
 * Teto do que se aceita baixar. O gravador da VPS corta em 64 MiB
 * (`defaultMaxFileBytes`), e o bucket em 70 MiB. Este número fica no meio de
 * propósito: um corpo maior que o que a VPS consegue produzir é sinal de que
 * quem respondeu não foi a VPS, e não de gravação legítima.
 */
export const MAX_RECORDING_BYTES = 68 * 1024 * 1024;

/** A VPS lê do próprio disco e responde. Não é caminho lento; 30 s é folga. */
const FETCH_TIMEOUT_MS = 30_000;

/** Só o que a limpeza precisa. Não vale a pena esperar por ela. */
const DELETE_TIMEOUT_MS = 10_000;

export interface RecordingFetchArgs {
  /** `voip_calls.id` — o que nomeia o objeto e o que a RPC de estado recebe. */
  callId: string;
  /** `voip_calls.tc_call_id` — o id da chamada NA VPS, que compõe a rota. */
  tcCallId: string;
  /** `voip_sessions.tc_session_id`. */
  sessionId: string;
  /** Organização dona, resolvida pela RPC a partir da sessão — nunca do corpo. */
  organizationId: string;
}

/**
 * O contrato mínimo do cliente Supabase que este módulo usa.
 *
 * Escrito à mão, e não `SupabaseClient` inteiro, porque é ele que o teste
 * implementa. Um dublê tem que ser obrigado a oferecer exatamente o que o
 * código de produção chama — nem mais, nem menos.
 */
export interface RecordingStore {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: ArrayBuffer | Uint8Array | Blob,
        opts?: { contentType?: string; upsert?: boolean },
      ): Promise<{ error: { message?: string } | null }>;
    };
  };
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
}

export type RecordingOutcome =
  | { ok: true; path: string; bytes: number }
  | { ok: false; reason: string };

/** Só para teste: injeta um `fetch` no lugar do global. */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

function vpsBaseUrl(): string {
  const url = Deno.env.get("TORQUECALLS_VPS_URL");
  if (!url) throw new Error("voip/recording: TORQUECALLS_VPS_URL ausente");
  return url.replace(/\/+$/, "");
}

/**
 * O caminho do objeto. É DERIVADO, nunca recebido.
 *
 * A organização no primeiro segmento é o que a policy de `storage.objects` lê
 * para decidir quem ouve, e `fn_voip_recording_stored` recompõe esta mesma
 * string e RECUSA se não bater — duas barreiras para a mesma coisa, porque um
 * objeto debaixo da pasta da organização errada é leitura concedida a quem não
 * deve, e é irreversível depois de assinado.
 */
export function recordingObjectPath(organizationId: string, callId: string): string {
  return `${organizationId}/${callId}.opus`;
}

/**
 * Busca a gravação na VPS e a guarda no bucket.
 *
 * Devolve o desfecho; NÃO marca falha no banco — quem chama decide, porque o
 * chamador é quem sabe se ainda há transação aberta. `fetchAndStoreRecording`
 * é a operação; `runRecordingIngest` é o fluxo com registro de estado.
 */
export async function fetchAndStoreRecording(
  db: RecordingStore,
  args: RecordingFetchArgs,
  deps: { fetch?: FetchLike } = {},
): Promise<RecordingOutcome> {
  const doFetch = deps.fetch ?? ((u: string, i?: RequestInit) => fetch(u, i));

  let token: string;
  try {
    const signed = await signAdminToken({
      act: "recording.read",
      org: args.organizationId,
      sid: args.sessionId,
      // `sub` é trilha, não autorização: quem pede é o próprio CRM, reagindo a
      // um evento assinado. Não há usuário humano neste caminho, e inventar um
      // faria a trilha mentir.
      sub: "torquecalls-webhook",
    });
    token = signed.token;
  } catch (e) {
    // A mensagem NOMEIA variáveis de ambiente. Ela não entra no motivo que vai
    // para o banco, que é lido por gente que não é o plantonista.
    console.error("[voip/recording] não foi possível cunhar o token:", e);
    return { ok: false, reason: "token_unavailable" };
  }

  const url = `${vpsBaseUrl()}/api/sessions/${encodeURIComponent(args.sessionId)}` +
    `/calls/${encodeURIComponent(args.tcCallId)}/recording`;

  let bytes: Uint8Array;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // 404 é o que a VPS responde tanto para "não existe" quanto para "não é
      // seu" (regra 1 do authz.go dela: nunca 403). Os dois viram a mesma
      // falha aqui, e é a leitura honesta: não há arquivo alcançável.
      return { ok: false, reason: `vps_http_${res.status}` };
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0) {
      return { ok: false, reason: "empty_body" };
    }
    if (buf.byteLength > MAX_RECORDING_BYTES) {
      return { ok: false, reason: "too_large" };
    }

    // O corpo tem que ser o Ogg que a VPS produz. Sem esta conferência, uma
    // página de erro de proxy (que responde 200 com HTML) seria guardada no
    // bucket como se fosse a conversa — e o gestor descobriria isso ao dar
    // play, semanas depois.
    if (!(buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53)) {
      return { ok: false, reason: "not_ogg" };
    }

    // O Content-Length é palavra de quem responde, mas divergir dele é sinal de
    // corpo truncado no meio do envio — e um opus cortado é pior que nenhum,
    // porque parece íntegro.
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > 0 && declared !== buf.byteLength) {
      return { ok: false, reason: "truncated_body" };
    }

    bytes = buf;
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return { ok: false, reason: aborted ? "vps_timeout" : "vps_unreachable" };
  }

  const path = recordingObjectPath(args.organizationId, args.callId);

  // `upsert: true` é deliberado. A entrega do evento é best-effort e pode
  // repetir; o caminho é determinístico, então a segunda subida escreve o MESMO
  // objeto no MESMO lugar em vez de recusar por conflito. Não há como duplicar:
  // o caminho carrega a chamada, e uma chamada é uma gravação.
  const { error: upErr } = await db.storage.from(RECORDING_BUCKET).upload(path, bytes, {
    contentType: "audio/ogg",
    upsert: true,
  });
  if (upErr) {
    console.error("[voip/recording] upload falhou:", upErr.message ?? upErr);
    return { ok: false, reason: "storage_upload_failed" };
  }

  const { data, error } = await db.rpc("fn_voip_recording_stored", {
    p_call_id: args.callId,
    p_path: path,
    p_bytes: bytes.byteLength,
  });
  if (error) {
    console.error("[voip/recording] fn_voip_recording_stored falhou:", error.message ?? error);
    return { ok: false, reason: "db_write_failed" };
  }
  if (data !== "stored") {
    // `path_mismatch` e `call_not_found` significam que o objeto foi parar num
    // lugar que ninguém vai ler. Não se declara `ready` sobre isso.
    return { ok: false, reason: `db_${String(data)}` };
  }

  return { ok: true, path, bytes: bytes.byteLength };
}

/**
 * Apaga a cópia da VPS. Best-effort, POR ÚLTIMO, e nunca decide o desfecho.
 *
 * Sem esta limpeza o disco da VPS acumula para sempre uma cópia do que já está
 * no CRM, e o expurgo de 90 dias (S4) apagaria só uma das duas — "90 dias"
 * seria verdade no CRM e mentira na VPS.
 */
export async function dropRecordingFromVps(
  args: RecordingFetchArgs,
  deps: { fetch?: FetchLike } = {},
): Promise<boolean> {
  const doFetch = deps.fetch ?? ((u: string, i?: RequestInit) => fetch(u, i));
  try {
    const { token } = await signAdminToken({
      act: "recording.delete",
      org: args.organizationId,
      sid: args.sessionId,
      sub: "torquecalls-webhook",
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELETE_TIMEOUT_MS);
    try {
      const res = await doFetch(
        `${vpsBaseUrl()}/api/sessions/${encodeURIComponent(args.sessionId)}` +
          `/calls/${encodeURIComponent(args.tcCallId)}/recording`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, signal: controller.signal },
      );
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.warn("[voip/recording] limpeza da VPS falhou (a gravação já está guardada):", e);
    return false;
  }
}

/**
 * O fluxo inteiro, com o registro de estado nas duas pontas.
 *
 * É isto que o endpoint dispara. Nunca lança: uma falha aqui não pode virar 500
 * numa entrega que já foi consumida — o evento foi aplicado, a chamada existe, e
 * o que falhou foi só a cópia do áudio.
 */
export async function runRecordingIngest(
  db: RecordingStore,
  args: RecordingFetchArgs,
  deps: { fetch?: FetchLike } = {},
): Promise<RecordingOutcome> {
  let outcome: RecordingOutcome;
  try {
    outcome = await fetchAndStoreRecording(db, args, deps);
  } catch (e) {
    console.error("[voip/recording] busca explodiu:", e);
    outcome = { ok: false, reason: "unexpected_error" };
  }

  if (!outcome.ok) {
    // FALHA SE DECLARA. Sem esta escrita o registro ficaria em `processing`
    // para sempre — e "processando há três dias" é a ausência disfarçada que
    // esta fatia existe para acabar.
    const { error } = await db.rpc("fn_voip_recording_failed", {
      p_call_id: args.callId,
      p_reason: outcome.reason,
    });
    if (error) {
      console.error("[voip/recording] não foi possível registrar a falha:", error.message ?? error);
    }
    await logRuntime({
      organizationId: args.organizationId,
      module: "voip",
      action: "gravacao_busca_falhou",
      status: "error",
      entityType: "voip_call",
      entityId: args.callId,
      payloadSnapshot: {
        tc_session_id: args.sessionId,
        tc_call_id: args.tcCallId,
        motivo: outcome.reason,
      },
    });
    return outcome;
  }

  // Só depois de `ready` estar gravado. Ver o comentário do topo: apagar antes
  // destruiria a única cópia se a escrita falhasse.
  await dropRecordingFromVps(args, deps);
  return outcome;
}

/**
 * Adapta o cliente real ao contrato mínimo acima.
 *
 * O cast existe porque `RecordingStore` é ESTREITO de propósito: ele declara
 * exatamente as duas operações que este módulo usa, e é isso que obriga o dublê
 * do teste a oferecer o mesmo — nem mais, nem menos. Casar o `SupabaseClient`
 * inteiro contra ele estoura o limite de profundidade do TS (TS2589), o mesmo
 * erro que já mordeu `resolveCaller` em `caller.ts`.
 */
export function asRecordingStore(client: SupabaseClient): RecordingStore {
  return client as unknown as RecordingStore;
}
