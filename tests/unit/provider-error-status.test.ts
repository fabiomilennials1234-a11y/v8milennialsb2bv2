// @vitest-environment node
import { describe, it, expect } from "vitest";

const { providerPassthroughStatus } = await import(
  "../../supabase/functions/_shared/provider-error-status.ts"
);

describe("providerPassthroughStatus", () => {
  it("propaga 404 do provedor (downloadMedia: Message not found)", () => {
    expect(providerPassthroughStatus({ status: 404, message: "Message not found" })).toBe(404);
  });

  it("propaga 422 markread_all_failed", () => {
    expect(providerPassthroughStatus({ status: 422, provider_code: "markread_all_failed", message: "x" })).toBe(422);
  });

  it.each([429, 500, 502, 503, 401, 403, 400])("mantém %i fora da lista (continua 500)", (status) => {
    expect(providerPassthroughStatus({ status, message: "x" })).toBeNull();
  });

  it("exceção desconhecida / sem status numérico -> null", () => {
    expect(providerPassthroughStatus(new Error("boom"))).toBeNull();
    expect(providerPassthroughStatus({ status: "404" })).toBeNull();
    expect(providerPassthroughStatus(null)).toBeNull();
    expect(providerPassthroughStatus(undefined)).toBeNull();
    expect(providerPassthroughStatus("404")).toBeNull();
  });
});
