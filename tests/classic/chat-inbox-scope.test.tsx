import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { DEFAULT_INBOX_FILTER, type InboxFilterState } from "@/modules/communication/lib/inboxFilter";
import { useInboxFilterState } from "@/modules/communication/hooks/chat/useInboxFilterState";

vi.mock("@/shared/hooks/usePersistedState", () => ({
  usePersistedState: () => {
    const [value, setValue] = useState<InboxFilterState>({ ...DEFAULT_INBOX_FILTER, vendor: "another-vendor", unread: true });
    return [value, setValue, () => setValue(DEFAULT_INBOX_FILTER)];
  },
}));
it("ignores saved or newly patched seller selections for restricted members, preserving other filters", () => {
  const { result, rerender } = renderHook(({ allowed }) => useInboxFilterState(allowed), { initialProps: { allowed: false } });
  expect(result.current.filter).toMatchObject({ vendor: "all", unread: true });
  act(() => result.current.patch({ vendor: "another-vendor", waiting: true }));
  expect(result.current.filter).toMatchObject({ vendor: "all", unread: true, waiting: true });
  rerender({ allowed: true });
  expect(result.current.filter.vendor).toBe("another-vendor");
  rerender({ allowed: false });
  act(() => result.current.clearFilter());
  expect(result.current.filter.vendor).toBe("all");
});
