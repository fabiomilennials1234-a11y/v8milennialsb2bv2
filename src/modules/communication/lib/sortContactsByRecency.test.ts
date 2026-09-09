import { describe, it, expect } from "vitest";
import { sortContactsByRecency } from "./sortContactsByRecency";

const c = (id: string, last_message_time: string | null) => ({ id, last_message_time });

describe("sortContactsByRecency", () => {
  it("põe a conversa mais recente no topo — a ordem da RPC (last_message_time DESC)", () => {
    const out = sortContactsByRecency([
      c("a", "2026-08-01T10:00:00Z"),
      c("b", "2026-08-06T10:00:00Z"),
      c("c", "2026-08-03T10:00:00Z"),
    ]);
    expect(out.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("devolve array NOVO — o cache do TanStack trata mutação in place como 'não mudou'", () => {
    const input = [c("a", "2026-08-01T10:00:00Z"), c("b", "2026-08-06T10:00:00Z")];
    const out = sortContactsByRecency(input);
    expect(out).not.toBe(input);
    // E não embaralha a entrada.
    expect(input.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("empate preserva a ordem anterior (estável) — timestamp tem precisão de segundo", () => {
    const mesmo = "2026-08-06T10:00:00Z";
    const out = sortContactsByRecency([c("a", mesmo), c("b", mesmo), c("c", mesmo)]);
    // Sem estabilidade, a lista se reembaralharia a cada patch de realtime.
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("timestamp ausente ou inválido vai pro FIM, nunca pro topo", () => {
    const out = sortContactsByRecency([
      c("sem-data", null),
      c("lixo", "não é data"),
      c("recente", "2026-08-06T10:00:00Z"),
      c("velha", "2026-01-01T10:00:00Z"),
    ]);
    expect(out.map((x) => x.id)).toEqual(["recente", "velha", "sem-data", "lixo"]);
  });

  it("lista vazia não explode", () => {
    expect(sortContactsByRecency([])).toEqual([]);
  });
});
