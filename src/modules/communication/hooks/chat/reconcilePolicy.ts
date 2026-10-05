/**
 * Política de reconciliação do chat — QUANTO esperar entre dois refetches de
 * segurança. Função pura, sem React, sem relógio próprio.
 *
 * ─── POR QUE ISTO EXISTE (incidente OOM 2026-10-05) ─────────────────────────
 *
 * O chat fazia polling de 10 s quando o realtime estava doente e 20 s quando
 * saudável. Isso é o desenho ao contrário: quando o banco aperta, o realtime
 * cai, e TODA aba aberta passa a consultar mais rápido — exatamente quando o
 * banco tem menos folga. Aqui o polling só desacelera sob carga:
 *
 *   saudável (canal "joined"):  thread 120 s · lista 300 s
 *   em fallback, por tempo desde a entrada:
 *     thread  <60 s → 30 s · <180 s → 60 s · depois 120 s (teto)
 *     lista   <60 s → 60 s · <180 s → 120 s · depois 300 s (teto)
 *
 * Degrau por TEMPO e não por número de falhas: o circuit breaker abre na 5ª
 * falha e estaciona em cooldown — contar falhas pararia de subir justo ali.
 *
 * ─── O JITTER ───────────────────────────────────────────────────────────────
 *
 * Só ADITIVO, 0..+25%. Os pisos acima valem literalmente: jitter nunca puxa
 * para baixo. E DETERMINÍSTICO: o TanStack v5 recalcula `refetchInterval` a
 * cada render e REINICIA o timer quando o valor muda — `Math.random()` por
 * render faria o poll nunca disparar. A semente é `misturarSemente(semente da
 * aba, query.state.dataUpdatedAt)`: estável entre dois fetches, nova a cada
 * fetch, diferente entre abas (dessincroniza a frota).
 */

export type PerfilDeReconciliacao = "thread" | "lista";

/** Nada, em estado nenhum, consulta mais rápido que isto. */
export const PISO_ABSOLUTO_MS = 10_000;

/** Teto do jitter, como fração do intervalo base. Só soma. */
export const JITTER_MAX_FRACAO = 0.25;

/** Intervalo com o canal saudável. É também o piso do caminho saudável. */
export const PISO_SAUDAVEL_MS: Readonly<Record<PerfilDeReconciliacao, number>> = {
  thread: 120_000,
  lista: 300_000,
};

/** Primeiro degrau do fallback (o mais rápido que o fallback chega). */
export const PISO_FALLBACK_MS: Readonly<Record<PerfilDeReconciliacao, number>> = {
  thread: 30_000,
  lista: 60_000,
};

/** Último degrau do fallback. */
export const TETO_FALLBACK_MS: Readonly<Record<PerfilDeReconciliacao, number>> = {
  thread: 120_000,
  lista: 300_000,
};

const DEGRAU_INTERMEDIARIO_MS: Readonly<Record<PerfilDeReconciliacao, number>> = {
  thread: 60_000,
  lista: 120_000,
};

/** Fronteiras dos degraus, em tempo decorrido desde a entrada no fallback. */
const FIM_DO_PRIMEIRO_DEGRAU_MS = 60_000;
const FIM_DO_SEGUNDO_DEGRAU_MS = 180_000;

export interface EntradaDeReconciliacao {
  perfil: PerfilDeReconciliacao;
  /** Canal "joined". Todo o resto — inclusive "errored" — é não saudável. */
  saudavel: boolean;
  /**
   * Instante em que o fallback começou, ou `null` se não está em fallback
   * (saudável, ou ainda na carência de 10 s).
   */
  emFallbackDesdeMs: number | null;
  agoraMs: number;
  /** uint32. Ver `misturarSemente`. */
  semente: number;
}

function baseDoFallback(perfil: PerfilDeReconciliacao, decorridoMs: number): number {
  if (decorridoMs < FIM_DO_PRIMEIRO_DEGRAU_MS) return PISO_FALLBACK_MS[perfil];
  if (decorridoMs < FIM_DO_SEGUNDO_DEGRAU_MS) return DEGRAU_INTERMEDIARIO_MS[perfil];
  return TETO_FALLBACK_MS[perfil];
}

/** Fração em [0, 1) derivada da semente. */
function fracaoDaSemente(semente: number): number {
  return (fmix32(semente >>> 0) >>> 0) / 2 ** 32;
}

export function intervaloDeReconciliacao(entrada: EntradaDeReconciliacao): number {
  const { perfil, saudavel, emFallbackDesdeMs, agoraMs, semente } = entrada;

  const base =
    saudavel || emFallbackDesdeMs === null
      ? PISO_SAUDAVEL_MS[perfil]
      : // Relógio que voltou (desde > agora) conta como recém-entrado.
        baseDoFallback(perfil, Math.max(0, agoraMs - emFallbackDesdeMs));

  const comJitter = Math.floor(base * (1 + JITTER_MAX_FRACAO * fracaoDaSemente(semente)));
  return Math.max(PISO_ABSOLUTO_MS, comJitter);
}

/** Finalizador do MurmurHash3: espalha bits de um uint32. */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Combina a semente fixa da aba com `dataUpdatedAt` num uint32.
 * `dataUpdatedAt` passa de 2^32 (ms desde 1970), então entram as duas metades.
 */
export function misturarSemente(sementeDaAba: number, dataUpdatedAt: number): number {
  const baixo = dataUpdatedAt >>> 0;
  const alto = Math.floor(dataUpdatedAt / 2 ** 32) >>> 0;
  let h = fmix32((sementeDaAba >>> 0) ^ 0x9e3779b9);
  h = fmix32(h ^ baixo);
  h = fmix32(h ^ alto);
  return h;
}
