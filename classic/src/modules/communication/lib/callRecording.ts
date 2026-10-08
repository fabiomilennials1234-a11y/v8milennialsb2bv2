/**
 * A gravação da ligação, do lado de quem ouve (Gravação S3, #1359).
 *
 * ── Quatro casos, não dois ──
 * `recording_url` vazio significava uma coisa só: "não existe". Depois da S2
 * significa quatro, e a diferença é a razão de esta camada existir:
 *
 *   ausência   — não houve gravação. Ninguém atendeu, foi registro manual, ou a
 *                gravação está desligada na VPS. Nada a mostrar, e mostrar algo
 *                seria inventar.
 *   processando— o CRM sabe que o arquivo existe e está buscando. O gestor
 *                precisa saber que é para ESPERAR: sem isto ele acha que a
 *                gravação se perdeu (história 19 do PRD #1356).
 *   pronta     — está no bucket. Dá play.
 *   falhou     — não vai haver, e há um porquê. Falha que aparece como ausência
 *                é a história 20 do PRD ao contrário.
 *
 * ── Por que a decisão de QUEM OUVE não mora aqui ──
 * Ela mora na policy de `storage.objects` (`fn_voip_can_hear_recording`), e só
 * lá. Este módulo NUNCA prediz se o usuário pode ouvir — nem comparando
 * `user_id` com o usuário logado, nem consultando papel. Uma segunda cópia da
 * regra é como as duas divergem, e a divergência aqui vaza conversa com cliente.
 *
 * O que este módulo faz é PEDIR e EXPLICAR a recusa depois que o banco recusou.
 * Explicar não é decidir: a frase só aparece quando a resposta já veio negativa.
 */
import { supabase } from "@/integrations/supabase/client";

/** Bucket privado da S2. Molde: `agent-documents`. */
export const CALL_RECORDINGS_BUCKET = "call-recordings";

/**
 * Validade da URL assinada, em segundos.
 *
 * A URL é um portador: quem a tiver, ouve, até expirar. Curta demais quebra a
 * escuta (o link morre no meio de uma ligação longa); longa demais transforma um
 * link vazado em acesso durável a uma conversa com cliente.
 *
 * 30 min cobre com folga qualquer ligação real — a média medida em produção é de
 * 122 s, e o gravador da VPS corta em ~4,5 h — e mantém curta a janela de um
 * link que escape.
 */
export const RECORDING_URL_TTL_SECONDS = 30 * 60;

export type CallRecordingState =
  | { kind: "none" }
  | { kind: "processing" }
  | { kind: "ready"; path: string }
  | { kind: "failed"; reason: string | null };

/** O mínimo que `callRecordingState` precisa ler — o resto da linha não importa. */
export interface CallRecordingFields {
  recording_status?: string | null;
  recording_url?: string | null;
  recording_failure_reason?: string | null;
}

/**
 * Traduz as colunas de `call_logs` no estado que a tela desenha.
 *
 * Dois casos-limite, e os dois caem em `processing` de propósito:
 *
 * 1. `ready` SEM caminho. O banco escreve estado e endereço na mesma transação
 *    (`fn_voip_recording_stored`), então isto não deveria acontecer. Se
 *    acontecer, "pronta" é uma promessa que não dá para cumprir e "falhou" é uma
 *    acusação falsa — `processing` é a única leitura honesta: ainda não dá para
 *    ouvir, e talvez dê.
 *
 * 2. Estado que o banco inventar. O CHECK cobre três valores hoje; um quarto no
 *    futuro não pode virar ausência (a gravação sumiria da tela) nem falha (o
 *    gestor desistiria de algo que talvez chegue).
 */
export function callRecordingState(call: CallRecordingFields): CallRecordingState {
  const status = call.recording_status ?? null;
  if (status === null) return { kind: "none" };

  if (status === "failed") {
    const raw = (call.recording_failure_reason ?? "").trim();
    return { kind: "failed", reason: raw === "" ? null : raw };
  }

  if (status === "ready") {
    const path = (call.recording_url ?? "").trim();
    if (path !== "") return { kind: "ready", path };
    return { kind: "processing" };
  }

  return { kind: "processing" };
}

/**
 * A causa da falha, dita a um vendedor.
 *
 * O produtor emite diagnóstico técnico (`vps_timeout`, `storage_upload_failed`),
 * e o vocabulário não é fechado: a VPS pode inventar um motivo novo amanhã, e
 * `fn_voip_recording_failed` aceita qualquer texto de até 120 chars. Um mapa
 * exaustivo seria mentira; um `slug` cru na tela seria despejo de log.
 *
 * Então o mapa cobre as FAMÍLIAS que o CRM sabe produzir e degrada com uma frase
 * verdadeira. O slug original continua disponível para o suporte — a peça o põe
 * no `title`, não no corpo.
 */
export function recordingFailureLabel(reason: string | null): string {
  const r = (reason ?? "").trim().toLowerCase();

  if (r === "" || r === "unknown") return "A gravação falhou.";
  if (r === "too_large") return "A gravação passou do tamanho aceito.";
  if (r === "not_ogg" || r === "truncated_body" || r === "empty_body") {
    return "O arquivo da gravação chegou corrompido.";
  }
  if (r === "storage_upload_failed" || r.startsWith("db_")) {
    return "A gravação chegou, mas não foi possível guardá-la.";
  }
  if (r === "token_unavailable" || r === "vps_timeout" || r === "vps_unreachable" || r.startsWith("vps_http_")) {
    return "A gravação não chegou da telefonia.";
  }

  return "A gravação falhou.";
}

/**
 * Relógio de transporte — `0:07`, `12:05`, `1:04:30`.
 *
 * Não reusa `formatCallDuration` de propósito: aquele formata um FATO ("3min
 * 40s", que se lê numa frase), este acompanha um ponteiro que anda. Um número
 * que muda dez vezes por segundo precisa de largura estável e leitura de
 * relógio.
 */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export type RecordingUrlResult =
  | { ok: true; url: string }
  | { ok: false; kind: "denied" }
  | { ok: false; kind: "unavailable" };

/**
 * Recusa do lado do banco × problema de rede.
 *
 * A API de storage não expõe os dois de forma limpa: uma linha que a RLS filtra
 * é indistinguível, para o cliente, de uma linha que não existe — o storage
 * responde 400/403/404 nos dois casos. E é assim que tem que ser: dizer "existe,
 * mas você não pode" já é contar algo sobre a conversa alheia.
 *
 * Por isso a classificação é por FAMÍLIA de código, não por mensagem: 4xx é
 * "esta pessoa não vai ouvir isto" (recusa ou objeto que não está mais lá), e o
 * resto — 5xx, timeout, offline — é "agora não deu", que se tenta de novo.
 */
function classifyStorageError(error: unknown): { ok: false; kind: "denied" | "unavailable" } {
  const status = Number(
    (error as { status?: unknown; statusCode?: unknown })?.status ??
      (error as { statusCode?: unknown })?.statusCode ??
      0,
  );
  if (Number.isFinite(status) && status >= 400 && status < 500) {
    return { ok: false, kind: "denied" };
  }
  return { ok: false, kind: "unavailable" };
}

/**
 * Pede ao storage a URL de uma gravação.
 *
 * Chamada SOB DEMANDA, quando alguém aperta play — nunca ao montar a thread. Uma
 * conversa longa tem dezenas de ligações, e assinar todas na abertura seria
 * cunhar dezenas de portadores para áudio que ninguém pediu.
 */
export async function resolveCallRecordingUrl(path: string): Promise<RecordingUrlResult> {
  const clean = path.trim();
  if (clean === "") return { ok: false, kind: "unavailable" };

  try {
    const { data, error } = await supabase.storage
      .from(CALL_RECORDINGS_BUCKET)
      .createSignedUrl(clean, RECORDING_URL_TTL_SECONDS);

    if (error) return classifyStorageError(error);
    if (!data?.signedUrl) return { ok: false, kind: "unavailable" };

    return { ok: true, url: data.signedUrl };
  } catch (err) {
    return classifyStorageError(err);
  }
}
