/**
 * Restante estimado pelo ritmo até aqui (`(agora − início) / feitos` por item).
 * `null` enquanto não há ritmo (nenhum item feito) ou o total é inválido.
 */
export function estimarRestanteMs(inicioMs: number, feitos: number, total: number): number | null {
  if (total <= 0 || feitos <= 0) return null;
  if (feitos >= total) return 0;
  const porItem = (Date.now() - inicioMs) / feitos;
  return Math.max(0, Math.round(porItem * (total - feitos)));
}
