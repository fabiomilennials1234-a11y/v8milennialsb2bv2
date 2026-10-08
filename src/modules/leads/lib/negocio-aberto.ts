import type { PipelineStatus } from "../hooks/useLeadAllPipelines";

/** A linha tem um negócio que ainda não fechou. */
export function temNegocioAberto(p: PipelineStatus): boolean {
  const entryId = p.type === "custom" ? p.entryId : p.pipeId;
  return entryId !== null && p.closedAt == null;
}

/**
 * Os funis onde dá pra abrir negócio: os que não têm negócio ABERTO do lead.
 * Uma linha por funil.
 *
 * `useLeadAllPipelines` emite uma linha por negócio, e só emite a linha vazia
 * quando o funil nunca teve negócio. Ler "linha vazia" como "dá pra abrir"
 * escondia o funil do lead que já comprou ali: o negócio ganho fecha, mas a
 * linha dele continua lá — e a recompra ficava sem porta.
 */
export function funisSemNegocioAberto<T extends PipelineStatus>(pipelines: T[]): T[] {
  const funilDe = (p: PipelineStatus) =>
    p.type === "custom" ? p.pipelineId : (p.pipelineDbId ?? `sys:${p.pipeType}`);
  const comAberto = new Set(pipelines.filter(temNegocioAberto).map(funilDe));
  const vistos = new Set<string>();
  const out: T[] = [];
  for (const p of pipelines) {
    const funil = funilDe(p);
    if (comAberto.has(funil) || vistos.has(funil)) continue;
    vistos.add(funil);
    out.push(p);
  }
  return out;
}
