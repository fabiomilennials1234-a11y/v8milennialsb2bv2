import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useClassificacaoCafeJurere } from "./useClassificacaoCafeJurere";
import { CAFE_JURERE_CLASSIFICACAO_FLAG, CAFE_JURERE_ORGANIZATION_ID } from "../lib/cafe-jurere-classificacao";

const mocks = vi.hoisted(() => ({ organization: vi.fn(), flag: vi.fn() }));
vi.mock("@/modules/identity", () => ({ useOrganization: mocks.organization }));
vi.mock("@/modules/platform", () => ({ useFeatureFlag: mocks.flag }));

describe("flag da página de Leads", () => {
  beforeEach(() => {
    mocks.organization.mockReturnValue({ organizationId: CAFE_JURERE_ORGANIZATION_ID });
    mocks.flag.mockReturnValue({ enabled: true, isLoading: false });
  });
  it("liga só na Café Jurerê e desliga ao trocar de organização", () => {
    const { result, rerender } = renderHook(() => useClassificacaoCafeJurere());
    expect(result.current).toBe(true);
    expect(mocks.flag).toHaveBeenCalledWith(CAFE_JURERE_CLASSIFICACAO_FLAG);
    mocks.organization.mockReturnValue({ organizationId: "outra-org" });
    rerender();
    expect(result.current).toBe(false);
  });
  it("não ativa durante carregamento nem com a flag desligada", () => {
    mocks.flag.mockReturnValue({ enabled: true, isLoading: true });
    const { result, rerender } = renderHook(() => useClassificacaoCafeJurere());
    expect(result.current).toBe(false);
    mocks.flag.mockReturnValue({ enabled: false, isLoading: false });
    rerender();
    expect(result.current).toBe(false);
  });
});
