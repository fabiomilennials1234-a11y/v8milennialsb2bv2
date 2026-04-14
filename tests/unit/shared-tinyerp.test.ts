/**
 * Tests for _shared/tinyerp-utils.ts — encryption, API helpers, error parsing, logging
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
  clearDenoEnv();
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ retorno: { status_processamento: "1", status: "OK" } }),
    text: () => Promise.resolve("ok"),
  });
});

import {
  TINY_API_BASE,
  ENCRYPTION_KEY_ID,
  encryptToken,
  decryptToken,
  getTinyErrorMessage,
  isTinyNoRecordsError,
  callTinyApi,
  logTinyOp,
  getOrgTinyToken,
  type TinyApiResponse,
} from "../../supabase/functions/_shared/tinyerp-utils";

// ── Constants ──
describe("tinyerp-utils constants", () => {
  it("exports correct TINY_API_BASE", () => {
    expect(TINY_API_BASE).toBe("https://api.tiny.com.br/api2");
  });

  it("exports ENCRYPTION_KEY_ID as v1", () => {
    expect(ENCRYPTION_KEY_ID).toBe("v1");
  });
});

// ── encryptToken / decryptToken ──
describe("tinyerp encryptToken / decryptToken", () => {
  it("throws when TINYERP_ENCRYPTION_KEY not set (encrypt)", async () => {
    await expect(encryptToken("my-token")).rejects.toThrow("TINYERP_ENCRYPTION_KEY");
  });

  it("throws when TINYERP_ENCRYPTION_KEY not set (decrypt)", async () => {
    await expect(decryptToken("enc", "nonce")).rejects.toThrow("TINYERP_ENCRYPTION_KEY");
  });
});

// ── getTinyErrorMessage ──
describe("getTinyErrorMessage", () => {
  it("extracts error from array format", () => {
    const response: TinyApiResponse = {
      retorno: {
        status_processamento: "3",
        status: "Erro",
        erros: [{ erro: "Token inválido" }, { erro: "Segundo erro" }],
      },
    };
    expect(getTinyErrorMessage(response)).toBe("Token inválido");
  });

  it("extracts error from object format", () => {
    const response: TinyApiResponse = {
      retorno: {
        status_processamento: "3",
        status: "Erro",
        erros: { erro: "Registro não encontrado" } as any,
      },
    };
    expect(getTinyErrorMessage(response)).toBe("Registro não encontrado");
  });

  it("falls back to status when erros is empty array", () => {
    const response: TinyApiResponse = {
      retorno: {
        status_processamento: "3",
        status: "Erro geral",
        erros: [],
      },
    };
    expect(getTinyErrorMessage(response)).toBe("Erro geral");
  });

  it("falls back to status when no erros field", () => {
    const response: TinyApiResponse = {
      retorno: {
        status_processamento: "1",
        status: "OK",
      },
    };
    expect(getTinyErrorMessage(response)).toBe("OK");
  });

  it("handles empty object erros", () => {
    const response: TinyApiResponse = {
      retorno: {
        status_processamento: "3",
        status: "Erro",
        erros: {} as any,
      },
    };
    // Empty object without "erro" key → falls back to ""
    expect(getTinyErrorMessage(response)).toBe("");
  });

  it("handles array with empty first element", () => {
    const response: TinyApiResponse = {
      retorno: {
        status_processamento: "3",
        status: "Erro",
        erros: [{ erro: "" }],
      },
    };
    expect(getTinyErrorMessage(response)).toBe("");
  });
});

// ── isTinyNoRecordsError ──
describe("isTinyNoRecordsError", () => {
  it("returns true for 'nenhum registro' error", () => {
    const response: TinyApiResponse = {
      retorno: {
        status_processamento: "3",
        status: "Erro",
        erros: [{ erro: "Nenhum registro encontrado" }],
      },
    };
    expect(isTinyNoRecordsError(response)).toBe(true);
  });

  it("returns true for 'não há registros' error", () => {
    const response: TinyApiResponse = {
      retorno: {
        status_processamento: "3",
        status: "Erro",
        erros: [{ erro: "Não há registros para listar" }],
      },
    };
    expect(isTinyNoRecordsError(response)).toBe(true);
  });

  it("returns false for other errors with status 3", () => {
    const response: TinyApiResponse = {
      retorno: {
        status_processamento: "3",
        status: "Erro",
        erros: [{ erro: "Token inválido" }],
      },
    };
    expect(isTinyNoRecordsError(response)).toBe(false);
  });

  it("returns false when status_processamento is not 3", () => {
    const response: TinyApiResponse = {
      retorno: {
        status_processamento: "1",
        status: "OK",
        erros: [{ erro: "Nenhum registro encontrado" }],
      },
    };
    expect(isTinyNoRecordsError(response)).toBe(false);
  });

  it("returns false for success response", () => {
    const response: TinyApiResponse = {
      retorno: { status_processamento: "1", status: "OK" },
    };
    expect(isTinyNoRecordsError(response)).toBe(false);
  });
});

// ── callTinyApi ──
describe("callTinyApi", () => {
  it("calls correct URL with token and formato", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ retorno: { status_processamento: "1", status: "OK" } }),
    });

    const result = await callTinyApi("my-token", "produtos.pesquisa.php", { pesquisa: "camiseta" });

    expect(result.retorno.status_processamento).toBe("1");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.tiny.com.br/api2/produtos.pesquisa.php",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      })
    );

    // Verify body contains token and formato
    const callBody = mockFetch.mock.calls[0][1].body;
    expect(callBody).toContain("token=my-token");
    expect(callBody).toContain("formato=json");
    expect(callBody).toContain("pesquisa=camiseta");
  });

  it("serializes object params as JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ retorno: { status_processamento: "1", status: "OK" } }),
    });

    await callTinyApi("my-token", "pedido.incluir.php", {
      pedido: { nome: "Test" },
    });

    const callBody = mockFetch.mock.calls[0][1].body;
    expect(callBody).toContain("pedido=%7B%22nome%22%3A%22Test%22%7D");
  });

  it("skips null/undefined params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ retorno: { status_processamento: "1", status: "OK" } }),
    });

    await callTinyApi("my-token", "produtos.pesquisa.php", {
      pesquisa: "test",
      filtro: null,
      outra: undefined,
    } as any);

    const callBody = mockFetch.mock.calls[0][1].body;
    expect(callBody).toContain("pesquisa=test");
    expect(callBody).not.toContain("filtro");
    expect(callBody).not.toContain("outra");
  });

  it("throws on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(callTinyApi("my-token", "action.php")).rejects.toThrow("TinyERP API HTTP 500");
  });
});

// ── logTinyOp ──
describe("logTinyOp", () => {
  it("inserts log with all fields", async () => {
    const { sb, getInserted } = createMockSupabase();
    await logTinyOp(sb, {
      organization_id: "org-1",
      operation: "sync_products",
      status: "success",
      items_processed: 10,
      items_created: 5,
      items_updated: 3,
      items_failed: 2,
      tiny_reference_id: "tiny-123",
      initiated_by: "system",
    });

    const inserted = getInserted("tinyerp_sync_logs");
    expect(inserted.length).toBe(1);
    expect(inserted[0].organization_id).toBe("org-1");
    expect(inserted[0].operation).toBe("sync_products");
    expect(inserted[0].items_processed).toBe(10);
    expect(inserted[0].items_created).toBe(5);
    expect(inserted[0].initiated_by).toBe("system");
  });

  it("sets defaults for optional fields", async () => {
    const { sb, getInserted } = createMockSupabase();
    await logTinyOp(sb, {
      organization_id: "org-1",
      operation: "push_order",
      status: "failed",
      error_message: "Connection timeout",
    });

    const inserted = getInserted("tinyerp_sync_logs");
    expect(inserted[0].items_processed).toBe(0);
    expect(inserted[0].items_created).toBe(0);
    expect(inserted[0].items_updated).toBe(0);
    expect(inserted[0].items_failed).toBe(0);
    expect(inserted[0].initiated_by).toBe("user");
    expect(inserted[0].error_message).toBe("Connection timeout");
    expect(inserted[0].tiny_reference_id).toBeNull();
  });
});

// ── getOrgTinyToken ──
describe("getOrgTinyToken", () => {
  it("returns null when no connection found", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("tinyerp_connections", []);
    const result = await getOrgTinyToken(sb, "org-1");
    expect(result).toBeNull();
  });

  it("returns null when decryption fails", async () => {
    // TINYERP_ENCRYPTION_KEY is not set → decryptToken will throw
    const { sb, mockTable } = createMockSupabase();
    mockTable("tinyerp_connections", [
      {
        id: "conn-1",
        organization_id: "org-1",
        encrypted_api_token: "bad-enc",
        encryption_nonce: "bad-nonce",
        status: "connected",
      },
    ]);
    const result = await getOrgTinyToken(sb, "org-1");
    expect(result).toBeNull();
  });
});
