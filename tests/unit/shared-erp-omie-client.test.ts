/**
 * Tests for _shared/erp/omie-client.ts — Omie JSON-RPC transport (module B).
 * Behavior-first: envelope, fault parsing, 429 backoff, 425 hard-stop,
 * write serialization, query concurrency cap. See ADR-0020.
 */
import { describe, it, expect, vi } from "vitest";
import {
  OmieClient,
  OmieFaultError,
  OmieRateLimitError,
  OMIE_API_BASE,
} from "../../supabase/functions/_shared/erp/omie-client";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

const CREDS = { appKey: "ak", appSecret: "as" };
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A fetch mock whose responses are resolved manually, one at a time. */
function deferredFetch() {
  let inFlight = 0;
  let maxInFlight = 0;
  const releases: Array<() => void> = [];
  const fetchImpl = vi.fn().mockImplementation(() => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise<Response>((resolve) => {
      releases.push(() => {
        inFlight--;
        resolve(jsonResponse({ ok: true }, 200));
      });
    });
  });
  return { fetchImpl, releases, get maxInFlight() { return maxInFlight; } };
}

describe("OmieClient — envelope", () => {
  it("posts the JSON-RPC envelope to the service path and returns the parsed body", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ clientes_cadastro: [], total_de_registros: 0 }));
    const client = new OmieClient(CREDS, { fetchImpl });

    const res = await client.call<{ total_de_registros: number }>(
      "geral/clientes",
      "ListarClientes",
      { pagina: 1 },
    );

    expect(res.total_de_registros).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${OMIE_API_BASE}/geral/clientes/`);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      call: "ListarClientes",
      app_key: "ak",
      app_secret: "as",
      param: [{ pagina: 1 }],
    });
  });
});

describe("OmieClient — fault (HTTP 200 + faultstring)", () => {
  it("throws OmieFaultError instead of returning the body as success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ faultstring: "App Key inválida", faultcode: "SOAP-ENV:Client-101" }, 200),
    );
    const client = new OmieClient(CREDS, { fetchImpl });

    await expect(client.call("geral/clientes", "ListarClientes")).rejects.toBeInstanceOf(
      OmieFaultError,
    );
  });

  it("carries the faultstring and faultcode on the error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ faultstring: "App Key inválida", faultcode: "SOAP-ENV:Client-101" }, 200),
    );
    const client = new OmieClient(CREDS, { fetchImpl });

    await client.call("geral/clientes", "ListarClientes").then(
      () => {
        throw new Error("should have thrown");
      },
      (err: OmieFaultError) => {
        expect(err.faultstring).toBe("App Key inválida");
        expect(err.faultcode).toBe("SOAP-ENV:Client-101");
      },
    );
  });
});

describe("OmieClient — 429 backoff", () => {
  it("backs off and retries after a 429, then succeeds", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({ total_de_registros: 5 }, 200));
    const client = new OmieClient(CREDS, { fetchImpl, sleep });

    const res = await client.call<{ total_de_registros: number }>(
      "geral/clientes",
      "ListarClientes",
    );

    expect(res.total_de_registros).toBe(5);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});

describe("OmieClient — 425 hard-stop", () => {
  it("throws immediately on 425 and does not retry", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 425));
    const client = new OmieClient(CREDS, { fetchImpl, sleep });

    await expect(
      client.call("geral/clientes", "ListarClientes"),
    ).rejects.toBeInstanceOf(OmieRateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("short-circuits a subsequent call to the blocked method until the block window passes", async () => {
    let t = 0;
    const now = () => t;
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 425));
    const client = new OmieClient(CREDS, { fetchImpl, now, blockMs: 1000 });

    // First call trips the block.
    await expect(
      client.call("geral/clientes", "ListarClientes"),
    ).rejects.toBeInstanceOf(OmieRateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Still inside the window → no network hit, still throws.
    await expect(
      client.call("geral/clientes", "ListarClientes"),
    ).rejects.toBeInstanceOf(OmieRateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // A different method is not blocked.
    await expect(
      client.call("geral/produtos", "ListarProdutos"),
    ).rejects.toBeInstanceOf(OmieRateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // After the window → the blocked method is retried on the wire.
    t = 2000;
    await expect(
      client.call("geral/clientes", "ListarClientes"),
    ).rejects.toBeInstanceOf(OmieRateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("OmieClient — write serialization", () => {
  it("runs writes one at a time (never two on the wire at once)", async () => {
    const df = deferredFetch();
    const client = new OmieClient(CREDS, { fetchImpl: df.fetchImpl });

    const calls = [
      client.call("produtos/pedido", "IncluirPedido", {}, { isWrite: true }),
      client.call("produtos/pedido", "IncluirPedido", {}, { isWrite: true }),
      client.call("produtos/pedido", "IncluirPedido", {}, { isWrite: true }),
    ];

    for (let i = 0; i < 3; i++) {
      await tick();
      // Only the i-th write has reached the wire; the rest wait their turn.
      expect(df.fetchImpl).toHaveBeenCalledTimes(i + 1);
      df.releases[i]();
    }

    await Promise.all(calls);
    expect(df.maxInFlight).toBe(1);
  });
});

describe("OmieClient — query concurrency cap", () => {
  it("never runs more than 4 queries on the wire at once", async () => {
    const df = deferredFetch();
    const client = new OmieClient(CREDS, {
      fetchImpl: df.fetchImpl,
      maxQueryConcurrency: 4,
    });

    const calls = Array.from({ length: 6 }, () =>
      client.call("geral/clientes", "ListarClientes"),
    );

    // Only 4 of the 6 reach the wire; the other 2 wait for a slot.
    await tick();
    expect(df.fetchImpl).toHaveBeenCalledTimes(4);

    // Freeing one slot lets the 5th start.
    df.releases[0]();
    await tick();
    expect(df.fetchImpl).toHaveBeenCalledTimes(5);

    df.releases[1]();
    await tick();
    expect(df.fetchImpl).toHaveBeenCalledTimes(6);

    df.releases[2]();
    df.releases[3]();
    df.releases[4]();
    df.releases[5]();
    await Promise.all(calls);

    expect(df.maxInFlight).toBe(4);
  });
});
