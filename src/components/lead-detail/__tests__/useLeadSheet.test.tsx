import { renderHook, act } from "@testing-library/react";
import { LeadPanelProvider, useLeadSheet } from "../hooks/useLeadSheet";
import type { ReactNode } from "react";

const wrapper = ({ children }: { children: ReactNode }) => (
  <LeadPanelProvider>{children}</LeadPanelProvider>
);

describe("useLeadSheet", () => {
  it("starts closed with no leadId", () => {
    const { result } = renderHook(() => useLeadSheet(), { wrapper });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.leadId).toBeNull();
    expect(result.current.variant).toBe("leads");
  });

  it("opens panel with leadId and variant", () => {
    const { result } = renderHook(() => useLeadSheet(), { wrapper });
    act(() => {
      result.current.openLead("lead-123", "whatsapp", { id: "pipe-1" });
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.leadId).toBe("lead-123");
    expect(result.current.variant).toBe("whatsapp");
    expect(result.current.pipeData).toEqual({ id: "pipe-1" });
  });

  it("switches lead without closing", () => {
    const { result } = renderHook(() => useLeadSheet(), { wrapper });
    act(() => result.current.openLead("lead-1", "whatsapp"));
    act(() => result.current.openLead("lead-2", "confirmacao"));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.leadId).toBe("lead-2");
    expect(result.current.variant).toBe("confirmacao");
  });

  it("closes and resets state", () => {
    const { result } = renderHook(() => useLeadSheet(), { wrapper });
    act(() => result.current.openLead("lead-1", "whatsapp"));
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.leadId).toBeNull();
  });
});
