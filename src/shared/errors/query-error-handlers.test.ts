import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return { ...actual, toast: Object.assign(vi.fn(), { ...actual.toast, error: toastError }) };
});

import { createQueryErrorHandlers } from "./query-error-handlers";
import { notifyError } from "./notify";
import { addErrorReporter, type ErrorReport } from "./report";

function pg(code: string, message: string) {
  return { code, message, details: null, hint: null };
}

function client() {
  return new QueryClient({
    ...createQueryErrorHandlers(),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe("createQueryErrorHandlers", () => {
  let reports: ErrorReport[];
  let unregister: () => void;

  beforeEach(() => {
    toastError.mockClear();
    reports = [];
    unregister = addErrorReporter((report) => reports.push(report));
  });

  afterEach(() => unregister());

  it("mutation sem tratamento local não some: relata, sem toast", async () => {
    const qc = client();
    const error = pg("42703", "column does not exist");
    await expect(
      qc.getMutationCache().build(qc, { mutationKey: ["move_card"], mutationFn: () => Promise.reject(error) }).execute(undefined),
    ).rejects.toBe(error);
    expect(reports).toHaveLength(1);
    expect(reports[0].context).toEqual({ source: "mutation", mutation: "move_card" });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("o notifyError da tela reusa a referência e não relata de novo", async () => {
    const qc = client();
    const error = pg("42703", "column does not exist");
    await qc
      .getMutationCache()
      .build(qc, { mutationFn: () => Promise.reject(error), onError: (e) => notifyError(e, { fallback: "Não foi possível mover o card." }) })
      .execute(undefined)
      .catch(() => undefined);

    expect(reports).toHaveLength(1);
    expect(toastError).toHaveBeenCalledTimes(1);
    const description = toastError.mock.calls[0][1].description as { props: { reference: string } };
    expect(description.props.reference).toBe(reports[0].error.reference);
  });

  it("meta.errorMessage liga o toast global", async () => {
    const qc = client();
    await qc
      .getMutationCache()
      .build(qc, {
        mutationFn: () => Promise.reject(pg("42703", "column does not exist")),
        meta: { errorMessage: "Não foi possível mover o card." },
      })
      .execute(undefined)
      .catch(() => undefined);
    expect(toastError).toHaveBeenCalledWith("Não foi possível mover o card.", expect.anything());
  });

  it("query com erro relata sem toast; meta.errorToast liga o toast", async () => {
    const qc = client();
    await qc.fetchQuery({ queryKey: ["leads", "org-1"], queryFn: () => Promise.reject(new Error("boom")) }).catch(() => undefined);
    expect(reports.at(-1)?.context).toEqual({ source: "query", query: "leads" });
    expect(toastError).not.toHaveBeenCalled();

    await qc
      .fetchQuery({
        queryKey: ["deals"],
        queryFn: () => Promise.reject(new Error("boom")),
        meta: { errorToast: "Não foi possível carregar os negócios." },
      })
      .catch(() => undefined);
    expect(toastError).toHaveBeenCalledWith("Não foi possível carregar os negócios.", expect.anything());
  });

  it("chave com dado do usuário não vai para o relatório", async () => {
    const qc = client();
    await qc
      .fetchQuery({ queryKey: ["busca por Fulano de Tal 11 99999-0000"], queryFn: () => Promise.reject(new Error("x")) })
      .catch(() => undefined);
    expect(reports.at(-1)?.context.query).toBe("anonymous");
  });
});
