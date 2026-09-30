import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { clearClientErrors, readClientErrors } from "@/core/observability/client-error-buffer";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return { ...actual, toast: Object.assign(vi.fn(), { ...actual.toast, error: toastError }) };
});

import { notifyError } from "./notify";
import { resetErrorReporterForTests, setErrorReporter, type ErrorReport } from "./report";
import { registerSupportLauncher, type SupportPrefill } from "./support-launcher";

function pg(code: string, message: string) {
  return { code, message, details: null, hint: null };
}

function functionsHttpError(status: number, body: unknown) {
  const error = new Error("Edge Function returned a non-2xx status code") as Error & { context: Response };
  error.name = "FunctionsHttpError";
  error.context = new Response(JSON.stringify(body), { status });
  return error;
}

type ToastOptions = {
  id: string;
  description: unknown;
  duration: number;
  action?: { label: string; onClick: () => void };
};

function lastToast(): { title: string; options: ToastOptions } {
  const call = toastError.mock.calls.at(-1);
  if (!call) throw new Error("nenhum toast");
  return { title: call[0] as string, options: call[1] as ToastOptions };
}

const FALLBACK = "Não foi possível mover o card.";

describe("notifyError", () => {
  let reports: ErrorReport[];

  beforeEach(() => {
    toastError.mockClear();
    clearClientErrors();
    reports = [];
    setErrorReporter((report) => reports.push(report));
  });

  afterEach(() => {
    resetErrorReporterForTests();
  });

  it("mostra a mensagem humana, nunca a técnica", () => {
    notifyError(pg("42703", "column \"sold_at\" does not exist"), { fallback: FALLBACK });
    const { title, options } = lastToast();
    expect(title).toBe(FALLBACK);
    expect(JSON.stringify(options)).not.toMatch(/sold_at|does not exist/);
  });

  it("leva o código copiável na descrição e dura o bastante para ler", () => {
    notifyError(new Error("boom"), { fallback: FALLBACK });
    const { options } = lastToast();
    expect(isValidElement(options.description)).toBe(true);
    const reference = (options.description as { props: { reference: string } }).props.reference;
    expect(reference).toMatch(/^[0-9A-F]{8}$/);
    expect(options.duration).toBeGreaterThanOrEqual(8000);
  });

  it("repetições do mesmo erro reusam o mesmo toast", () => {
    notifyError(pg("23505", "duplicate key"), { fallback: FALLBACK });
    notifyError(pg("23505", "duplicate key"), { fallback: FALLBACK });
    const [first, second] = toastError.mock.calls.map((call) => (call[1] as ToastOptions).id);
    expect(first).toBe(second);
  });

  it("relata ao reporter com o contexto e a origem", () => {
    notifyError(pg("42703", "column does not exist"), { fallback: FALLBACK, context: { feature: "kanban" } });
    expect(reports).toHaveLength(1);
    expect(reports[0].error.code).toBe("unknown");
    expect(reports[0].context).toEqual({ source: "handled", feature: "kanban" });
  });

  it("o mesmo objeto de erro é relatado uma vez, mesmo passando por dois tratadores", () => {
    const cause = pg("42703", "column does not exist");
    notifyError(cause, { fallback: FALLBACK });
    notifyError(cause, { fallback: FALLBACK });
    expect(reports).toHaveLength(1);
    expect(toastError).toHaveBeenCalledTimes(2);
  });

  it("anota no anel do Chamado a causa técnica com a mesma referência do toast", () => {
    notifyError(pg("42703", "column \"sold_at\" does not exist"), { fallback: FALLBACK });
    const reference = (lastToast().options.description as { props: { reference: string } }).props.reference;
    const [entry] = readClientErrors();
    expect(entry.source).toBe("handled");
    expect(entry.message).toContain(`[${reference}]`);
    expect(entry.message).toContain("sold_at");
  });

  it("o anel do Chamado não leva o valor da linha nem o telefone do lead", () => {
    notifyError(
      {
        code: "23505",
        message: "duplicate key value violates unique constraint \"leads_phone_key\"",
        details: "Key (phone)=(5511999990000) already exists.",
        hint: null,
      },
      { fallback: FALLBACK },
    );
    const [entry] = readClientErrors();
    expect(entry.message).toContain("leads_phone_key");
    expect(entry.message).not.toContain("5511999990000");
    expect(entry.message).not.toContain("Key (phone)");
  });

  it("silent relata e não mostra toast", () => {
    notifyError(new Error("boom"), { fallback: FALLBACK, silent: true });
    expect(reports).toHaveLength(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("um reporter que lança não quebra o toast", () => {
    setErrorReporter(() => {
      throw new Error("vendor fora");
    });
    expect(() => notifyError(new Error("boom"), { fallback: FALLBACK })).not.toThrow();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("lê o corpo da edge function antes de mostrar", async () => {
    notifyError(functionsHttpError(400, { error: "TinyERP não conectado" }), { fallback: FALLBACK });
    await vi.waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(lastToast().title).toBe("TinyERP não conectado");
  });

  describe("ações", () => {
    it("sessão vencida oferece entrar de novo", () => {
      notifyError(pg("PGRST303", "JWT expired"), { fallback: FALLBACK });
      expect(lastToast().options.action?.label).toBe("Entrar novamente");
    });

    it("sem painel de suporte montado, não oferece falar com suporte", () => {
      notifyError(new Error("boom"), { fallback: FALLBACK });
      expect(lastToast().options.action).toBeUndefined();
    });

    it("com o painel montado, abre o Chamado com o código do erro", () => {
      const opened: SupportPrefill[] = [];
      const unregister = registerSupportLauncher((prefill) => opened.push(prefill));
      try {
        notifyError(new Error("boom"), { fallback: FALLBACK });
        const { options } = lastToast();
        const reference = (options.description as { props: { reference: string } }).props.reference;
        expect(options.action?.label).toBe("Falar com suporte");
        options.action?.onClick();
        expect(opened).toHaveLength(1);
        expect(opened[0].title).toBe(`Erro: ${FALLBACK}`);
        expect(opened[0].description).toContain(reference);
      } finally {
        unregister();
      }
    });

    it("recusa esperada não oferece suporte", () => {
      const unregister = registerSupportLauncher(() => undefined);
      try {
        notifyError(pg("42501", "access_denied"), { fallback: FALLBACK });
        expect(lastToast().options.action).toBeUndefined();
      } finally {
        unregister();
      }
    });
  });
});
