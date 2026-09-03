/**
 * Faixas do filtro "Parado há" — quantos dias o negócio está na etapa atual.
 *
 * É a pergunta operacional que "Criados no período" não responde: um lead que
 * entrou em maio pode ter se mexido ontem. Por isso os dois filtros existem
 * separados e combinam (ver `.specs/mockups/funis-redesign/LEIA-ME.md`).
 *
 * As faixas vivem aqui, e não na página, porque o predicado roda **no servidor**
 * (`get_pipeline_page` / `get_pipeline_stage_counts`). Filtrar no cliente faria
 * a contagem da coluna divergir dos cards — exatamente o bug que levou o board
 * a resolver todo filtro server-side. O limite é enviado em dias; a conversão
 * pra timestamp acontece no SQL, com o relógio do banco.
 */

export interface StalledBucket {
  id: string;
  label: string;
  /** Dias completos na etapa, inclusivo. `null` em `maxDays` = sem teto. */
  minDays: number;
  maxDays: number | null;
}

export const STALLED_BUCKETS: StalledBucket[] = [
  { id: "0-2", label: "Até 2 dias", minDays: 0, maxDays: 2 },
  { id: "3-7", label: "3 a 7 dias", minDays: 3, maxDays: 7 },
  { id: "8-14", label: "8 a 14 dias", minDays: 8, maxDays: 14 },
  { id: "15-30", label: "15 a 30 dias", minDays: 15, maxDays: 30 },
  { id: "30+", label: "Mais de 30 dias", minDays: 31, maxDays: null },
];

export const STALLED_ALL = "all";

export function getStalledBucket(id: string): StalledBucket | null {
  if (!id || id === STALLED_ALL) return null;
  return STALLED_BUCKETS.find((b) => b.id === id) ?? null;
}

export function stalledBucketLabel(id: string): string {
  return getStalledBucket(id)?.label ?? "Qualquer tempo";
}

/**
 * Versão client-side do predicado, pro board de funil customizado — o único que
 * não é paginado no servidor (as entries chegam inteiras e todo filtro dele já
 * roda no cliente, inclusive o de qualificação).
 *
 * Espelha o SQL da migration `20270729000010`:
 *   SQL   ts <= now() - minDays        ⟺  dias completos >= minDays
 *   SQL   ts >  now() - (maxDays + 1)  ⟺  dias completos <= maxDays
 * Manter as duas leituras idênticas importa porque a mesma faixa, com o mesmo
 * rótulo, precisa devolver o mesmo recorte nos dois tipos de funil.
 *
 * `ts` nulo conta como "acabou de entrar" (0 dias), consistente com o
 * COALESCE(stage_changed_at, entered_at, created_at) do lado do banco.
 */
export function matchesStalledBucket(
  ts: string | null | undefined,
  bucket: StalledBucket | null,
  now: Date = new Date(),
): boolean {
  if (!bucket) return true;
  const entered = ts ? new Date(ts) : now;
  if (Number.isNaN(entered.getTime())) return true;
  const days = Math.floor((now.getTime() - entered.getTime()) / 86_400_000);
  if (days < bucket.minDays) return false;
  return bucket.maxDays === null || days <= bucket.maxDays;
}
