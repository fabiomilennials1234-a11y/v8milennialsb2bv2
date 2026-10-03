/**
 * recentCommands — gerenciamento de comandos recentes user-scoped.
 *
 * C26 (B3): localStorage key `cmd-palette-recent-${userId}` para isolamento
 * entre usuários no mesmo device. Top 5, LRU.
 *
 * Security (B3): cleanup no signOut via AuthContext (lista de prefixos).
 */

const MAX_RECENTS = 5;

function getKey(userId: string): string {
  return `cmd-palette-recent-${userId}`;
}

/** Retorna os IDs dos últimos N comandos usados (ordem MRU). */
export function getRecent(userId: string): string[] {
  try {
    const raw = localStorage.getItem(getKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

/** Adiciona um comando ao topo da lista de recentes (dedup, LRU top-5). */
export function pushRecent(userId: string, commandId: string): void {
  try {
    const current = getRecent(userId);
    // Remove duplicata se existir
    const deduped = current.filter((id) => id !== commandId);
    // Prepend + truncar a 5
    const updated = [commandId, ...deduped].slice(0, MAX_RECENTS);
    localStorage.setItem(getKey(userId), JSON.stringify(updated));
  } catch {
    // localStorage indisponível — silencioso
  }
}

/** Limpa os recentes de um usuário específico. */
export function clearRecent(userId: string): void {
  try {
    localStorage.removeItem(getKey(userId));
  } catch {
    // silencioso
  }
}
