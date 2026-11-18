/** Termo de busca seguro para `.or()` do PostgREST: vírgula e parêntese quebram o filtro. */
export function termoDeBusca(termo: string): string {
  return termo.replace(/[,()\\%_*]/g, " ").replace(/\s+/g, " ").trim();
}
