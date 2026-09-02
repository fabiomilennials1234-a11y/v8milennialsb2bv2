/**
 * Resolução do parâmetro da rota única `/funil/:slug` (SCRUM-632).
 *
 * A rota aceita as DUAS moedas do padrão 626: uuid (canônico) e slug (alias —
 * único por org, medido em prod 2026-09-02). Pura e sem React de propósito:
 * o teste unitário cobre a resolução sem montar página.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FunilResolvivel {
  id: string;
  slug: string;
  is_active: boolean;
}

export function resolveFunil<T extends FunilResolvivel>(
  pipelines: T[],
  param: string | undefined,
): T | undefined {
  if (!param) return undefined;
  // Funil desativado não resolve — mesma regra do board custom antigo
  // (`useCustomPipeline` filtrava `is_active=true`).
  const ativos = pipelines.filter((p) => p.is_active !== false);
  if (UUID_RE.test(param)) return ativos.find((p) => p.id === param);
  return ativos.find((p) => p.slug === param);
}
