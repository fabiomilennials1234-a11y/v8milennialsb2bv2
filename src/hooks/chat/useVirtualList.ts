/**
 * useVirtualList — abstração fina sobre @tanstack/react-virtual.
 * Expõe virtualizer, virtualItems e totalSize.
 *
 * C18: foundation para virtualização de MessageList e ConversationList.
 */
import { useVirtualizer } from "@tanstack/react-virtual";

export interface UseVirtualListOptions<T> {
  items: T[];
  getScrollElement: () => HTMLElement | null;
  estimateSize: (index: number) => number;
  overscan?: number;
}

export function useVirtualList<T>({
  items,
  getScrollElement,
  estimateSize,
  overscan = 8,
}: UseVirtualListOptions<T>) {
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement,
    estimateSize,
    overscan,
  });

  return {
    virtualizer,
    virtualItems: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
  };
}
