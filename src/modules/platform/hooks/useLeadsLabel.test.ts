import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { leadsLabel, useLeadsLabel } from "./useLeadsLabel";

const useFeatureFlag = vi.fn();
vi.mock("@/modules/platform/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (key: string) => useFeatureFlag(key),
}));

describe("leadsLabel", () => {
  it("sem flag mantém Leads", () => {
    expect(leadsLabel(false)).toBe("Leads");
  });
  it("com flag vira Ficha do Parceiro", () => {
    expect(leadsLabel(true)).toBe("Ficha do Parceiro");
  });
});

describe("useLeadsLabel", () => {
  beforeEach(() => useFeatureFlag.mockReset());

  it("lê a flag ficha_do_parceiro", () => {
    useFeatureFlag.mockReturnValue({ enabled: true, isLoading: false });
    const { result } = renderHook(() => useLeadsLabel());
    expect(result.current).toBe("Ficha do Parceiro");
    expect(useFeatureFlag).toHaveBeenCalledWith("ficha_do_parceiro");
  });

  it("fail-closed enquanto carrega", () => {
    useFeatureFlag.mockReturnValue({ enabled: false, isLoading: true });
    const { result } = renderHook(() => useLeadsLabel());
    expect(result.current).toBe("Leads");
  });
});
