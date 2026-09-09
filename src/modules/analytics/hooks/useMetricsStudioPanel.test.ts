import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createWrapper } from "../../../../tests/helpers/hook-test-utils";
import type { StudioWindow } from "../lib/metrics-studio-window";

const writes = vi.fn();
const reads = vi.fn();
const context = { organizationId: "org-a" as string | null, teamMemberId: "tm-a", isReady: true };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => {
    let body: unknown;
    const filters: Record<string, string> = {};
    const builder = {
      select: () => builder,
      eq: (column: string, value: string) => { filters[column] = value; return builder; },
      update: (value: unknown) => { body = value; return builder; },
      single: () => body ? writes({ body, filters }) : reads(),
    };
    return builder;
  } },
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => context,
  isVirtualTeamMember: (id: string) => id?.startsWith("master-virtual-"),
}));
import { useMetricsStudioPanel } from "./useMetricsStudioPanel";
const windowA: StudioWindow = { id: "w-a", metricId: "leads_criados", corte: "total", x: 8, y: 8, w: 280, h: 132, chart: "number", z: 1 };
async function flush() { await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); }

describe("persistência das abas — destino, filas e falhas", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    writes.mockReset().mockResolvedValue({ data: { id: "panel" }, error: null });
    reads.mockReset().mockResolvedValue({ data: { layout: [] }, error: null });
    Object.assign(context, { organizationId: "org-a", teamMemberId: "tm-a", isReady: true });
  });
  afterEach(() => vi.useRealTimers());

  it("não descarrega ao trocar org e depois escreve no destino original", async () => {
    const { result, rerender } = renderHook(() => useMetricsStudioPanel("panel-a"), { wrapper: createWrapper() });
    act(() => result.current.save([windowA]));
    context.organizationId = "org-b";
    context.teamMemberId = "tm-b";
    rerender();
    expect(writes).not.toHaveBeenCalled();
    await flush();
    expect(writes).toHaveBeenCalledWith({ body: expect.objectContaining({ team_member_id: "tm-a" }), filters: { id: "panel-a", organization_id: "org-a" } });
  });

  it("editar B antes do debounce não descarta a edição de A", async () => {
    const { result, rerender } = renderHook(({ id }) => useMetricsStudioPanel(id), { initialProps: { id: "a" }, wrapper: createWrapper() });
    act(() => result.current.save([windowA]));
    rerender({ id: "b" });
    act(() => result.current.save([{ ...windowA, id: "w-b" }]));
    await flush();
    expect(writes.mock.calls.map(([request]) => request.filters.id)).toEqual(["a", "b"]);
    expect(writes.mock.calls[0][0].body.layout[0].id).toBe("w-a");
    expect(writes.mock.calls[1][0].body.layout[0].id).toBe("w-b");
  });

  it("exibe falha e permite repetir sem mexer novamente no layout", async () => {
    writes.mockResolvedValueOnce({ error: { message: "Sem conexão" } });
    const { result } = renderHook(() => useMetricsStudioPanel("a"), { wrapper: createWrapper() });
    act(() => result.current.save([windowA]));
    await flush();
    expect(result.current.saveError).toBe("Sem conexão");
    expect(result.current.isSaving).toBe(false);
    act(() => result.current.retrySave());
    await flush();
    expect(writes).toHaveBeenCalledTimes(2);
    expect(result.current.saveError).toBeNull();
  });

  it("master virtual é gravado como editor nulo", async () => {
    context.teamMemberId = "master-virtual-abc";
    const { result } = renderHook(() => useMetricsStudioPanel("a"), { wrapper: createWrapper() });
    act(() => result.current.save([windowA]));
    await flush();
    expect(writes.mock.calls[0][0].body.team_member_id).toBeNull();
  });

  it("sem org ou aba resolvida não grava", async () => {
    context.organizationId = null;
    const { result } = renderHook(() => useMetricsStudioPanel(null), { wrapper: createWrapper() });
    act(() => result.current.save([windowA]));
    await flush();
    expect(writes).not.toHaveBeenCalled();
  });

  it("uma releitura atrasada não apaga a edição salva do cache ao voltar à aba", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    const { result, rerender } = renderHook(({ id }) => useMetricsStudioPanel(id), { initialProps: { id: "a" }, wrapper });
    await flush();
    let finishRead!: (value: unknown) => void;
    reads.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    act(() => result.current.refetch());
    act(() => result.current.save([windowA]));
    await flush();
    await act(async () => { finishRead({ data: { layout: [] }, error: null }); });
    rerender({ id: "b" });
    await flush();
    rerender({ id: "a" });
    expect(result.current.layout).toEqual([windowA]);
  });

  it("reler durante o debounce preserva o rascunho sem consultar o layout antigo", async () => {
    const { result } = renderHook(() => useMetricsStudioPanel("a"), { wrapper: createWrapper() });
    await flush();
    act(() => result.current.save([windowA]));
    await act(async () => { result.current.refetch(); });
    expect(reads).toHaveBeenCalledTimes(1);
    expect(result.current.layout).toEqual([windowA]);
    await flush();
  });

  it("reler durante uma escrita em andamento preserva o rascunho", async () => {
    let finishWrite!: (value: unknown) => void;
    writes.mockImplementationOnce(() => new Promise((resolve) => { finishWrite = resolve; }));
    const { result } = renderHook(() => useMetricsStudioPanel("a"), { wrapper: createWrapper() });
    await flush();
    act(() => result.current.save([windowA]));
    await flush();
    await act(async () => { result.current.refetch(); });
    expect(reads).toHaveBeenCalledTimes(1);
    expect(result.current.layout).toEqual([windowA]);
    await act(async () => { finishWrite({ data: { id: "a" }, error: null }); });
  });
});
