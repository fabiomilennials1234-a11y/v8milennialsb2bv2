import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useFeatureFlag = vi.fn();
vi.mock("@/modules/platform/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (...args: unknown[]) => useFeatureFlag(...args),
}));

import { useNomeDoLeadPrimeiro } from "./useNomeDoLeadPrimeiro";

describe("useNomeDoLeadPrimeiro — fail-closed", () => {
  beforeEach(() => useFeatureFlag.mockReset());

  it("lê a chave chat_nome_do_lead", () => {
    useFeatureFlag.mockReturnValue({ enabled: true, isLoading: false });
    renderHook(() => useNomeDoLeadPrimeiro());
    expect(useFeatureFlag).toHaveBeenCalledWith("chat_nome_do_lead");
  });

  it("só `true` liga", () => {
    useFeatureFlag.mockReturnValue({ enabled: true, isLoading: false });
    expect(renderHook(() => useNomeDoLeadPrimeiro()).result.current).toBe(true);
  });

  it.each([
    ["carregando", { enabled: false, isLoading: true }],
    ["flag ausente", { enabled: false, isLoading: false }],
    ["resultado sem enabled (erro/indefinido)", {}],
    ["string 'true'", { enabled: "true", isLoading: false }],
    ["truthy 1", { enabled: 1, isLoading: false }],
  ])("%s -> false", (_nome, retorno) => {
    useFeatureFlag.mockReturnValue(retorno);
    expect(renderHook(() => useNomeDoLeadPrimeiro()).result.current).toBe(false);
  });
});
