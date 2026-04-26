/**
 * Trilha 3.B Fase B1 / T3B.2 — Context Loader (módulo copilot)
 *
 * Cache LRU in-memory de capabilities por agent_id.
 * Uso: agent-engine.loadCapabilities consulta cache antes de query DB.
 *
 * TTL: 5min (suficiente pra burst de mensagens do mesmo lead, baixo o
 * suficiente pra refletir mudanças de configuração rapidamente).
 *
 * Invalidação manual via bustCapabilitiesCache(agentId) quando UI atualiza
 * agente (futuro — agent CRUD hooks chamam edge function pra bustar).
 *
 * Em ambiente Deno edge function, módulo é singleton por isolate. Cache
 * compartilhado entre invocações até cold start.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutos
const MAX_ENTRIES = 200; // ~30 orgs × ~3 agents médio + headroom

const capabilitiesCache = new Map<string, CacheEntry<unknown>>();

/**
 * Tenta retornar capabilities do cache. Retorna null se ausente ou expirado.
 */
export function getCachedCapabilities<T>(agentId: string): T | null {
  const entry = capabilitiesCache.get(agentId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    capabilitiesCache.delete(agentId);
    return null;
  }
  return entry.value as T;
}

/**
 * Armazena capabilities no cache com TTL.
 * Eviction LRU simples: se atingir MAX_ENTRIES, descarta mais antiga.
 */
export function setCachedCapabilities<T>(agentId: string, value: T): void {
  if (capabilitiesCache.size >= MAX_ENTRIES) {
    // Eviction: deleta primeira entrada (Map preserva ordem de inserção)
    const oldest = capabilitiesCache.keys().next().value;
    if (oldest) capabilitiesCache.delete(oldest);
  }
  capabilitiesCache.set(agentId, {
    value,
    expiresAt: Date.now() + TTL_MS,
  });
}

/**
 * Invalida explicitamente entrada do cache. Chamado quando agente é atualizado
 * via UI (frontend hook → POST bust endpoint, futuro).
 */
export function bustCapabilitiesCache(agentId: string): void {
  capabilitiesCache.delete(agentId);
}

/**
 * Limpa cache inteiro. Útil em testes.
 */
export function clearCapabilitiesCache(): void {
  capabilitiesCache.clear();
}

/**
 * Stats pra observability.
 */
export function getCacheStats(): { size: number; maxEntries: number; ttlMs: number } {
  return { size: capabilitiesCache.size, maxEntries: MAX_ENTRIES, ttlMs: TTL_MS };
}
