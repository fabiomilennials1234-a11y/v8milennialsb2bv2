/**
 * useInboxFilterState — estado do filtro do inbox, persistido por usuário.
 *
 * usePersistedState já escopa a chave por organização + team_member, então o
 * recorte volta como o vendedor deixou, e não vaza entre orgs/usuários. Busca e
 * tab NÃO passam por aqui (efêmeros — decisão do grill). TTL longo (30 dias): o
 * filtro é preferência de trabalho, não estado de sessão.
 */
import { useCallback } from "react";
import { usePersistedState } from "@/shared/hooks/usePersistedState";
import { DEFAULT_INBOX_FILTER, type InboxFilterState } from "@/modules/communication/lib/inboxFilter";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Chaves cujo valor é `string[]` (dimensões multi-select). */
type MultiKey = "funnels" | "stages" | "tags" | "tiers";

export function useInboxFilterState() {
  const [filter, setFilter, clearFilter] = usePersistedState<InboxFilterState>(
    "inbox-filter",
    DEFAULT_INBOX_FILTER,
    { ttlMs: THIRTY_DAYS_MS },
  );

  const patch = useCallback(
    (partial: Partial<InboxFilterState>) => setFilter((prev) => ({ ...prev, ...partial })),
    [setFilter],
  );

  /** Alterna um valor dentro de uma dimensão multi-select (OR). */
  const toggleMulti = useCallback(
    (key: MultiKey, value: string) =>
      setFilter((prev) => {
        const set = new Set(prev[key]);
        if (set.has(value)) set.delete(value);
        else set.add(value);
        return { ...prev, [key]: [...set] };
      }),
    [setFilter],
  );

  return { filter, setFilter, clearFilter, patch, toggleMulti };
}
