import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.fn().mockResolvedValue({ data: { id: "inst-1", name: "Main" }, error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: any[]) => mockInvoke(...args) },
  },
}));

import {
  testEvolutionConnection,
  createEvolutionInstance,
  getQRCode,
  getConnectionState,
  deleteEvolutionInstance,
  logoutInstance,
} from "@/lib/evolutionApi";

beforeEach(() => vi.clearAllMocks());

describe("testEvolutionConnection", () => {
  it("returns working=true on success", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { message: "OK", version: "1.0" }, error: null });
    const result = await testEvolutionConnection();
    expect(result.working).toBe(true);
    expect(result.status).toBe(200);
    expect(mockInvoke).toHaveBeenCalledWith("evolution-api-proxy", expect.anything());
  });

  it("returns working=false on edge function error", async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: { message: "Failed" } });
    const result = await testEvolutionConnection();
    expect(result.working).toBe(false);
  });

  it("returns working=false on API error", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { error: "Not found", status: 404 }, error: null });
    const result = await testEvolutionConnection();
    expect(result.working).toBe(false);
  });
});

describe("createEvolutionInstance", () => {
  it("creates instance via proxy", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { instance: { instanceName: "Test" } }, error: null });
    const result = await createEvolutionInstance("TestInstance", "5511999999999");
    expect(result).toBeDefined();
    expect(mockInvoke).toHaveBeenCalled();
  });
});

describe("getQRCode", () => {
  it("fetches QR code", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { base64: "data:image/png;base64,xxx", code: "123" }, error: null });
    const result = await getQRCode("TestInstance");
    expect(result).toBeDefined();
  });
});

describe("getConnectionState", () => {
  it("fetches connection state", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { state: "open" }, error: null });
    const result = await getConnectionState("TestInstance");
    expect(result).toBeDefined();
  });
});

describe("deleteEvolutionInstance", () => {
  it("deletes instance", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { success: true }, error: null });
    await deleteEvolutionInstance("TestInstance");
    expect(mockInvoke).toHaveBeenCalled();
  });
});

describe("logoutInstance", () => {
  it("logs out instance", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { success: true }, error: null });
    await logoutInstance("TestInstance");
    expect(mockInvoke).toHaveBeenCalled();
  });
});
