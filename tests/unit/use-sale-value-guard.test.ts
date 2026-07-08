import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSaleValueGuard } from "@/modules/pipelines/hooks/useSaleValueGuard";
import type { WonStageResolvable } from "@/modules/pipelines/lib/sale-value-guard";

const stages: WonStageResolvable[] = [
  { stage_key: "proposta_enviada", stage_role: "open", is_final_positive: false },
  { stage_key: "vendido", stage_role: "won", is_final_positive: true },
];

const WON = "vendido";

describe("useSaleValueGuard", () => {
  it("won move WITHOUT value → blocks, opens modal, resumes on confirm", () => {
    const { result } = renderHook(() => useSaleValueGuard(stages));
    const proceed = vi.fn();

    let ret = true;
    act(() => {
      ret = result.current.guardWonTransition({ targetStageKey: WON, currentValue: null, proceed });
    });

    expect(ret).toBe(false); // deferred
    expect(proceed).not.toHaveBeenCalled();
    expect(result.current.saleValueModalOpen).toBe(true);

    act(() => result.current.confirmSaleValue(4200));

    expect(proceed).toHaveBeenCalledTimes(1);
    expect(proceed).toHaveBeenCalledWith(4200);
    expect(result.current.saleValueModalOpen).toBe(false);
  });

  it("won move WITH value → proceeds immediately, no modal", () => {
    const { result } = renderHook(() => useSaleValueGuard(stages));
    const proceed = vi.fn();

    let ret = false;
    act(() => {
      ret = result.current.guardWonTransition({ targetStageKey: WON, currentValue: 9000, proceed });
    });

    expect(ret).toBe(true);
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(proceed).toHaveBeenCalledWith(); // no override — value already present
    expect(result.current.saleValueModalOpen).toBe(false);
  });

  it("non-won move → never prompts", () => {
    const { result } = renderHook(() => useSaleValueGuard(stages));
    const proceed = vi.fn();

    act(() => {
      result.current.guardWonTransition({ targetStageKey: "proposta_enviada", currentValue: null, proceed });
    });

    expect(proceed).toHaveBeenCalledTimes(1);
    expect(result.current.saleValueModalOpen).toBe(false);
  });

  it("cancel → card does NOT move (proceed never runs)", () => {
    const { result } = renderHook(() => useSaleValueGuard(stages));
    const proceed = vi.fn();

    act(() => {
      result.current.guardWonTransition({ targetStageKey: WON, currentValue: null, proceed });
    });
    expect(result.current.saleValueModalOpen).toBe(true);

    act(() => result.current.cancelSaleValue());

    expect(proceed).not.toHaveBeenCalled();
    expect(result.current.saleValueModalOpen).toBe(false);
  });

  it("value + won stage_key land in the SAME mutation payload", () => {
    // Simulate the page's proceed closure that builds the mutation payload.
    const { result } = renderHook(() => useSaleValueGuard(stages));
    const mutate = vi.fn();

    const buildProceed = (itemId: string, targetStageKey: string) => (saleValueOverride?: number) => {
      const updates: Record<string, unknown> = { id: itemId, status: targetStageKey };
      if (saleValueOverride !== undefined) updates.sale_value = saleValueOverride;
      mutate(updates);
    };

    act(() => {
      result.current.guardWonTransition({
        targetStageKey: WON,
        currentValue: null,
        proceed: buildProceed("entry-1", WON),
      });
    });
    act(() => result.current.confirmSaleValue(7777));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ id: "entry-1", status: WON, sale_value: 7777 });
    // Both facts present in one payload → fn_capture_sale_event will snapshot it.
    const payload = mutate.mock.calls[0][0];
    expect(payload.sale_value).toBe(7777);
    expect(payload.status).toBe(WON);
  });
});
