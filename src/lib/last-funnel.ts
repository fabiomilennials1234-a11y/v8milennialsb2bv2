/**
 * Último funil aberto.
 *
 * O item "Funil" do menu abria sempre o funil PADRÃO da org. Quem trabalhava no
 * funil B, ia ao chat responder o cliente e voltava, caía no A. Aqui mora a
 * memória do último funil e a regra de para onde o item aponta.
 *
 * Escopo: org + usuário. Num computador compartilhado ou com usuário em duas
 * orgs, o funil de um não vaza para o outro. Sem expiração: a validade é
 * conferida contra os funis que o usuário ainda enxerga (`funilEntryPath`), então
 * um funil apagado, inativo ou fora do acesso cai no padrão sozinho.
 *
 * Sem imports de módulo: a página de funil grava, o menu lê.
 */

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Evento no mesmo documento: o `storage` nativo só dispara em OUTRAS abas. */
export const LAST_FUNNEL_EVENT = "v8:last-funil-changed";

const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** `localStorage` ou `null`: só ler a propriedade já lança com storage bloqueado. */
export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function lastFunnelKey(organizationId: string | null | undefined, userId: string | null | undefined): string | null {
  if (!organizationId || !userId) return null;
  return `v8:ui:last-funil:${organizationId}:${userId}`;
}

export function readLastFunnel(storage: KeyValueStorage, key: string | null): string | null {
  if (!key) return null;
  try {
    const value = storage.getItem(key);
    return value && SLUG.test(value) ? value : null;
  } catch {
    // Storage bloqueado (modo privado): sem memória, comportamento de antes.
    return null;
  }
}

export function writeLastFunnel(storage: KeyValueStorage, key: string | null, slug: string): void {
  if (!key || !SLUG.test(slug)) return;
  try {
    if (storage.getItem(key) === slug) return;
    storage.setItem(key, slug);
  } catch {
    // Sem storage a memória só não sobrevive à navegação.
  }
}

/**
 * Para onde o item "Funil" aponta: o último funil se ele ainda existe para este
 * usuário; senão o padrão da org; senão o hub.
 */
export function funilEntryPath(args: {
  lastSlug: string | null;
  /** Slugs dos funis visíveis na lateral. Vazio = ainda carregando. */
  availableSlugs: readonly string[];
  defaultPipelineId: string | null | undefined;
}): string {
  const { lastSlug, availableSlugs, defaultPipelineId } = args;
  if (lastSlug && availableSlugs.includes(lastSlug)) return `/funil/${lastSlug}`;
  return defaultPipelineId ? `/funil/${defaultPipelineId}` : "/funis";
}
