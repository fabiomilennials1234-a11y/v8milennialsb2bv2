/**
 * Regras puras da bandeja de mensagens programadas (B1).
 *
 * Tudo recebe `now` explícito: a bandeja recalcula a cada 30 s e os testes
 * fixam o relógio sem `vi.useFakeTimers` global.
 */
import { format } from "date-fns";

/**
 * Forma mínima de uma linha de `scheduled_user_messages` que a bandeja lê.
 * Local (e não importada do hook) para o hook poder importar daqui a janela de
 * falha sem ciclo lib ↔ hooks.
 */
export interface LinhaProgramada {
  id: string;
  created_by: string;
  created_at: string;
  scheduled_at: string;
  status: "scheduled" | "sending" | "sent" | "failed" | "cancelled";
  message_content: string | null;
  media_type: string | null;
  media_filename: string | null;
  error_message: string | null;
}
type ScheduledMessage = LinhaProgramada;

export const URGENTE_MINUTOS = 15;
export const FALHA_JANELA_MS = 7 * 86_400_000;
const MIN = 60_000;

type When = Date | string | number;
const ms = (d: When) => (d instanceof Date ? d.getTime() : typeof d === "number" ? d : new Date(d).getTime());

/** Minutos inteiros até `at` (arredondado, nunca negativo). */
export function minutosAte(at: When, now: number): number {
  return Math.max(0, Math.round((ms(at) - now) / MIN));
}

/** "agora" · "em 36 min" · "em 2h 6min" · "em 2 dias". */
export function tempoRestante(at: When, now: number): string {
  const m = minutosAte(at, now);
  if (m < 1) return "agora";
  if (m < 60) return `em ${m} min`;
  const h = Math.floor(m / 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `em ${d} ${d > 1 ? "dias" : "dia"}`;
  }
  const r = m % 60;
  return `em ${h}h${r ? ` ${r}min` : ""}`;
}

export function ehUrgente(at: When, now: number): boolean {
  return minutosAte(at, now) < URGENTE_MINUTOS;
}

/**
 * Fração do tempo que AINDA falta, de `created_at` → `scheduled_at`, em [0, 1].
 * 1 = recém-programada (anel cheio); 0 = na hora (anel vazio).
 */
export function progressoDoAnel(createdAt: When, scheduledAt: When, now: number): number {
  const span = Math.max(ms(scheduledAt) - ms(createdAt), 1);
  const resta = Math.max(0, ms(scheduledAt) - now);
  return Math.min(1, resta / span);
}

function mesmoDia(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const DIA_CURTO = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });

/** "Hoje" · "Amanhã" · "Ontem" · "seg., 16/11". */
export function rotuloDoDia(at: When, now: number): string {
  const d = new Date(ms(at));
  const hoje = new Date(now);
  if (mesmoDia(d, hoje)) return "Hoje";
  const amanha = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1);
  if (mesmoDia(d, amanha)) return "Amanhã";
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  if (mesmoDia(d, ontem)) return "Ontem";
  return DIA_CURTO.format(d);
}

export function hora(at: When): string {
  return format(new Date(ms(at)), "HH:mm");
}

export interface GrupoDoDia<T> {
  rotulo: string;
  itens: T[];
}

/** Agrupa (na ordem recebida) por dia de `scheduled_at`. */
export function agruparPorDia<T extends Pick<ScheduledMessage, "scheduled_at">>(itens: T[], now: number): GrupoDoDia<T>[] {
  const grupos: GrupoDoDia<T>[] = [];
  for (const item of itens) {
    const rotulo = rotuloDoDia(item.scheduled_at, now);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.rotulo === rotulo) ultimo.itens.push(item);
    else grupos.push({ rotulo, itens: [item] });
  }
  return grupos;
}

/**
 * `error_message` do worker → frase de gente. Não afirma número de tentativas:
 * o worker pode ter desistido por motivos que não passam pelo contador.
 */
export function motivoDaFalha(errorMessage: string | null | undefined): string {
  const e = errorMessage ?? "";
  if (/desconectad|disconnected|not connected/i.test(e)) return "WhatsApp desconectado no horário do envio";
  if (/not on whatsapp|n[uú]mero inv[aá]lido|invalid (phone )?number|not exists?|não existe/i.test(e)) return "Número sem WhatsApp";
  if (/nenhuma inst[aâ]ncia/i.test(e)) return "Nenhum WhatsApp conectado para enviar";
  return "O envio falhou";
}

/** `sending` há mais que isto (desde `scheduled_at`) = worker caiu no meio. */
export const ENVIO_TRAVADO_MS = 5 * 60_000;

export function envioTravado(m: Pick<LinhaProgramada, "status" | "scheduled_at">, now: number): boolean {
  return m.status === "sending" && now - ms(m.scheduled_at) > ENVIO_TRAVADO_MS;
}

export interface FilaDaBandeja<T extends LinhaProgramada = LinhaProgramada> {
  /** Falhas recentes, a mais recente primeiro — dominam o topo, fora do contador. */
  falhas: T[];
  /** `scheduled` + `sending` saudável, por horário. É o que conta no selo. */
  pendentes: T[];
  /** `sending` há mais de 5 min — mostrado à parte, fora do selo. */
  travadas: T[];
}

/**
 * Separa a fila. Dedup por id (a bandeja junta a consulta por lead e a por
 * conversa) e corta falha mais velha que 7 dias também no cliente — o cache
 * pode segurar uma linha que passou da janela desde a última busca.
 */
export function separarFila<T extends LinhaProgramada>(mensagens: T[], now: number): FilaDaBandeja<T> {
  const unicas = [...new Map(mensagens.map((m) => [m.id, m])).values()];
  const falhas = unicas
    .filter((m) => m.status === "failed" && now - ms(m.scheduled_at) <= FALHA_JANELA_MS)
    .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));
  const ativas = unicas
    .filter((m) => m.status === "scheduled" || m.status === "sending")
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const travadas = ativas.filter((m) => envioTravado(m, now));
  const pendentes = ativas.filter((m) => !envioTravado(m, now));
  return { falhas, pendentes, travadas };
}

export function programadas(n: number): string {
  return `${n} ${n > 1 ? "programadas" : "programada"}`;
}

/**
 * A policy de UPDATE de `scheduled_user_messages` só deixa o AUTOR escrever
 * (`created_by` ∈ team_members do usuário); o master tem policy própria.
 * Mostrar botão a quem o banco vai recusar é prometer o que não acontece.
 */
export function podeEscrever(
  msg: Pick<ScheduledMessage, "created_by">,
  memberId: string | null | undefined,
  isMaster: boolean,
): boolean {
  if (isMaster) return true;
  return !!memberId && msg.created_by === memberId;
}

export type TipoDeMidia = "image" | "video" | "audio" | "document";

export const ROTULO_DE_MIDIA: Record<TipoDeMidia, string> = {
  image: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  document: "Documento",
};

export function tipoDeMidia(mediaType: string | null | undefined): TipoDeMidia | null {
  if (!mediaType) return null;
  return mediaType in ROTULO_DE_MIDIA ? (mediaType as TipoDeMidia) : "document";
}

/** Texto de prévia: conteúdo; sem conteúdo, o nome do arquivo. */
export function previa(msg: Pick<ScheduledMessage, "message_content" | "media_filename">): string {
  return msg.message_content?.trim() || msg.media_filename || "";
}
