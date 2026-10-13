import { useState, useCallback, useMemo } from "react";

export function useBulkSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastToggled, setLastToggled] = useState<string | null>(null);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastToggled(id);
  }, []);

  const toggleRange = useCallback(
    (id: string, orderedIds: string[]) => {
      if (!lastToggled) {
        toggle(id);
        return;
      }
      const startIdx = orderedIds.indexOf(lastToggled);
      const endIdx = orderedIds.indexOf(id);
      if (startIdx === -1 || endIdx === -1) {
        toggle(id);
        return;
      }
      const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) next.add(orderedIds[i]);
        return next;
      });
      setLastToggled(id);
    },
    [lastToggled, toggle],
  );

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(ids);
    });
  }, []);

  /** Soma `ids` à seleção — nunca desmarca (ao contrário de `selectAll`). */
  const addMany = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastToggled(null);
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  return useMemo(
    () => ({
      selectedIds,
      count: selectedIds.size,
      hasSelection: selectedIds.size > 0,
      toggle,
      toggleRange,
      selectAll,
      addMany,
      clearSelection,
      isSelected,
    }),
    [selectedIds, toggle, toggleRange, selectAll, addMany, clearSelection, isSelected],
  );
}
