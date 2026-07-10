import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  CLIENT_ERROR_CAPACITY,
  clearClientErrors,
  installClientErrorCapture,
  readClientErrors,
  recordClientError,
  recordRequestFailure,
} from "./client-error-buffer";

beforeEach(() => clearClientErrors());

describe("recordClientError", () => {
  it("guarda mensagem, tipo e stack", () => {
    recordClientError(new TypeError("boom"), "unhandled");
    const [e] = readClientErrors();
    expect(e.message).toBe("boom");
    expect(e.name).toBe("TypeError");
    expect(e.source).toBe("unhandled");
    expect(e.stack).toBeTruthy();
  });

  it("aceita um valor que não é Error", () => {
    recordClientError("string solta", "rejection");
    expect(readClientErrors()[0].message).toBe("string solta");
  });

  it("não quebra com erro sem stack", () => {
    const err = new Error("sem stack");
    delete err.stack;
    expect(() => recordClientError(err, "unhandled")).not.toThrow();
    expect(readClientErrors()[0].stack).toBeUndefined();
  });

  // O buffer existe para ser anexado a um Chamado. Um vazamento aqui é um
  // vazamento de memória em toda aba aberta o dia inteiro.
  it("descarta os mais antigos ao passar da capacidade", () => {
    for (let i = 0; i < CLIENT_ERROR_CAPACITY + 5; i++) {
      recordClientError(new Error(`erro ${i}`), "unhandled");
    }
    const errors = readClientErrors();
    expect(errors).toHaveLength(CLIENT_ERROR_CAPACITY);
    expect(errors[0].message).toBe("erro 5");
    expect(errors.at(-1)!.message).toBe(`erro ${CLIENT_ERROR_CAPACITY + 4}`);
  });

  it("devolve uma cópia — quem lê não altera o buffer", () => {
    recordClientError(new Error("x"), "unhandled");
    readClientErrors().pop();
    expect(readClientErrors()).toHaveLength(1);
  });

  it("trunca uma mensagem gigante", () => {
    recordClientError(new Error("a".repeat(5000)), "unhandled");
    expect(readClientErrors()[0].message.length).toBeLessThanOrEqual(500);
  });
});

describe("recordRequestFailure", () => {
  it("guarda método, status e caminho", () => {
    recordRequestFailure("POST", "https://x.supabase.co/rest/v1/leads?select=id", 401);
    const [e] = readClientErrors();
    expect(e.source).toBe("request");
    expect(e.message).toContain("401");
    expect(e.message).toContain("POST");
    expect(e.message).toContain("/rest/v1/leads");
  });

  // Um `?` de PostgREST carrega filtros: `?name=eq.Fulano`. Isso é PII de um
  // lead do nosso cliente, e o Support Context vai parar num Chamado.
  it("descarta a query string da URL", () => {
    recordRequestFailure("GET", "https://x.supabase.co/rest/v1/leads?name=eq.Fulano", 400);
    expect(readClientErrors()[0].message).not.toContain("Fulano");
    expect(readClientErrors()[0].message).not.toContain("?");
  });

  it("aceita uma URL que não parseia", () => {
    expect(() => recordRequestFailure("GET", "nao-e-url", 500)).not.toThrow();
    expect(readClientErrors()[0].message).toContain("500");
  });
});

describe("installClientErrorCapture", () => {
  it("captura window.onerror e unhandledrejection, e desinstala", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");

    const uninstall = installClientErrorCapture();
    expect(add).toHaveBeenCalledWith("error", expect.any(Function));
    expect(add).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));

    window.dispatchEvent(new ErrorEvent("error", { error: new Error("do window") }));
    expect(readClientErrors().some((e) => e.message === "do window")).toBe(true);

    uninstall();
    expect(remove).toHaveBeenCalledWith("error", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));

    add.mockRestore();
    remove.mockRestore();
  });

  it("instalar duas vezes não duplica o registro do erro", () => {
    const u1 = installClientErrorCapture();
    const u2 = installClientErrorCapture();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("uma vez") }));
    expect(readClientErrors().filter((e) => e.message === "uma vez")).toHaveLength(1);
    u1();
    u2();
  });
});
