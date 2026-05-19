import { renderHook, act } from "@testing-library/react";
import { LeadPanelProvider, useLeadSheet } from "../hooks/useLeadSheet";
import type { ReactNode } from "react";

const wrapper = ({ children }: { children: ReactNode }) => (
  <LeadPanelProvider>{children}</LeadPanelProvider>
);

describe("useLeadSheet", () => {
  it("starts closed with no leadId and null defaultExpandedPipeEntryId", () => {
    const { result } = renderHook(() => useLeadSheet(), { wrapper });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.leadId).toBeNull();
    expect(result.current.defaultExpandedPipeEntryId).toBeNull();
  });

  it("opens panel with leadId only", () => {
    const { result } = renderHook(() => useLeadSheet(), { wrapper });
    act(() => {
      result.current.openLead("lead-123");
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.leadId).toBe("lead-123");
    expect(result.current.defaultExpandedPipeEntryId).toBeNull();
  });

  it("opens panel with leadId + defaultExpandedPipeEntryId", () => {
    const { result } = renderHook(() => useLeadSheet(), { wrapper });
    act(() => {
      result.current.openLead("lead-123", "pipe-entry-1");
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.leadId).toBe("lead-123");
    expect(result.current.defaultExpandedPipeEntryId).toBe("pipe-entry-1");
  });

  it("switches lead without closing and clears entry id when omitted", () => {
    const { result } = renderHook(() => useLeadSheet(), { wrapper });
    act(() => result.current.openLead("lead-1", "entry-a"));
    expect(result.current.defaultExpandedPipeEntryId).toBe("entry-a");
    act(() => result.current.openLead("lead-2"));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.leadId).toBe("lead-2");
    expect(result.current.defaultExpandedPipeEntryId).toBeNull();
  });

  it("closes and resets state", () => {
    const { result } = renderHook(() => useLeadSheet(), { wrapper });
    act(() => result.current.openLead("lead-1", "entry-a"));
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.leadId).toBeNull();
    expect(result.current.defaultExpandedPipeEntryId).toBeNull();
  });
});
