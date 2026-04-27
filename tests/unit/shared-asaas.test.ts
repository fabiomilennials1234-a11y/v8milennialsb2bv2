/**
 * Tests for _shared/asaas.ts — Asaas payment gateway API wrapper.
 *
 * ASAAS_API_URL + ASAAS_API_KEY are captured at module import time,
 * so tests use vi.resetModules() + dynamic import.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

async function loadModule() {
  vi.resetModules();
  return await import("../../supabase/functions/_shared/asaas");
}

beforeEach(() => {
  clearDenoEnv();
  setDenoEnv("ASAAS_API_KEY", "test-api-key");
  vi.clearAllMocks();
  mockFetch.mockReset();
});

// ─── Customers ────────────────────────────────────────────────────────────

describe("asaas — customers", () => {
  it("createCustomer POSTs to /customers and returns parsed JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: "cus_1",
          name: "Ada",
          email: "ada@x",
          cpfCnpj: "12345678900",
        }),
      text: () => Promise.resolve(""),
    });
    const { createCustomer } = await loadModule();
    const c = await createCustomer({
      name: "Ada",
      email: "ada@x",
      cpfCnpj: "12345678900",
      phone: "11999",
    });
    expect(c.id).toBe("cus_1");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.asaas.com/v3/customers");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.access_token).toBe("test-api-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body).name).toBe("Ada");
  });

  it("findCustomerByEmail returns first match", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: [{ id: "c1", email: "x@x", name: "X", cpfCnpj: "1" }],
          totalCount: 1,
        }),
      text: () => Promise.resolve(""),
    });
    const { findCustomerByEmail } = await loadModule();
    const c = await findCustomerByEmail("x@x");
    expect(c?.id).toBe("c1");
    expect(mockFetch.mock.calls[0][0]).toContain("/customers?email=x%40x");
  });

  it("findCustomerByEmail returns null when no match", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [], totalCount: 0 }),
    });
    const { findCustomerByEmail } = await loadModule();
    expect(await findCustomerByEmail("none@x")).toBeNull();
  });

  it("findCustomerByEmail returns null when data array missing", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ totalCount: 0 }),
    });
    const { findCustomerByEmail } = await loadModule();
    expect(await findCustomerByEmail("none@x")).toBeNull();
  });
});

// ─── Payments ─────────────────────────────────────────────────────────────

describe("asaas — payments", () => {
  it("createPayment creates PIX payment", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: "pay_1",
          customer: "cus_1",
          billingType: "PIX",
          value: 199.9,
          dueDate: "2026-06-01",
          status: "PENDING",
        }),
      text: () => Promise.resolve(""),
    });
    const { createPayment } = await loadModule();
    const p = await createPayment({
      customer: "cus_1",
      billingType: "PIX",
      value: 199.9,
      dueDate: "2026-06-01",
      description: "Plano Pro",
    });
    expect(p.id).toBe("pay_1");
    expect(p.billingType).toBe("PIX");
  });

  it("getPaymentStatus fetches payment by id", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: "pay_9", status: "RECEIVED" }),
    });
    const { getPaymentStatus } = await loadModule();
    const p = await getPaymentStatus("pay_9");
    expect(p.status).toBe("RECEIVED");
    expect(mockFetch.mock.calls[0][0]).toContain("/payments/pay_9");
  });

  it("getPaymentPixQrCode fetches QR code endpoint", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          encodedImage: "data:image/png;base64,xyz",
          payload: "0002012662700...",
          expirationDate: "2026-06-01T10:00:00-03:00",
        }),
    });
    const { getPaymentPixQrCode } = await loadModule();
    const qr = await getPaymentPixQrCode("pay_1");
    expect(qr.payload).toContain("0002");
    expect(mockFetch.mock.calls[0][0]).toContain("/payments/pay_1/pixQrCode");
  });
});

// ─── Subscriptions ────────────────────────────────────────────────────────

describe("asaas — subscriptions", () => {
  it("createSubscription creates MONTHLY subscription", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: "sub_1",
          customer: "cus_1",
          billingType: "CREDIT_CARD",
          value: 99.9,
          cycle: "MONTHLY",
          nextDueDate: "2026-05-01",
          status: "ACTIVE",
        }),
    });
    const { createSubscription } = await loadModule();
    const s = await createSubscription({
      customer: "cus_1",
      billingType: "CREDIT_CARD",
      value: 99.9,
      cycle: "MONTHLY",
      nextDueDate: "2026-05-01",
      description: "Plano Pro",
      creditCardToken: "cc_tok_abc",
    });
    expect(s.cycle).toBe("MONTHLY");
    expect(s.id).toBe("sub_1");
  });
});

// ─── Error handling (asaasFetch non-ok branch) ───────────────────────────

describe("asaas — error handling", () => {
  it("throws with status + body when HTTP error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"errors":[{"description":"invalid"}]}'),
    });
    const { createCustomer } = await loadModule();
    await expect(
      createCustomer({ name: "x", email: "x@x", cpfCnpj: "1" }),
    ).rejects.toThrow(/HTTP 400/);
  });

  it("error message includes method + path", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("not found"),
    });
    const { getPaymentStatus } = await loadModule();
    await expect(getPaymentStatus("pay_missing")).rejects.toThrow(
      /GET \/payments\/pay_missing/,
    );
  });

  it("honors ASAAS_API_URL env override", async () => {
    setDenoEnv("ASAAS_API_URL", "https://sandbox.asaas.com/v3");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: "x" }),
    });
    const { getPaymentStatus } = await loadModule();
    await getPaymentStatus("p1");
    expect(mockFetch.mock.calls[0][0]).toContain(
      "https://sandbox.asaas.com/v3/payments/p1",
    );
  });
});
