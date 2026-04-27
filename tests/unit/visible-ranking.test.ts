import { describe, it, expect } from "vitest";
import { filterVisibleRanking } from "@/lib/visible-ranking";

function u(
  id: string,
  position: number,
  extra: { role?: string; name?: string; value?: number } = {}
) {
  return {
    id,
    position,
    name: extra.name ?? `User ${id}`,
    role: extra.role ?? "admin",
    value: extra.value ?? 0,
  };
}

describe("filterVisibleRanking", () => {
  it("retorna array vazio quando ranking é null ou undefined", () => {
    const visible = new Set<string>(["a"]);
    expect(filterVisibleRanking(null, visible)).toEqual([]);
    expect(filterVisibleRanking(undefined, visible)).toEqual([]);
  });

  it("mantém somente ids presentes em visibleMemberIds", () => {
    const visible = new Set(["a", "b"]);
    const ranking = [u("a", 1), u("master-1", 2), u("b", 3)];
    const result = filterVisibleRanking(ranking, visible);
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("renumera posições sequencialmente (1..N) após o filtro", () => {
    const visible = new Set(["a", "b", "c"]);
    const ranking = [
      u("a", 1),
      u("master-x", 2),
      u("b", 3),
      u("master-y", 4),
      u("c", 5),
    ];
    const result = filterVisibleRanking(ranking, visible);
    expect(result.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(result.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("exclui entries com role === 'master' mesmo se id estiver no set visível", () => {
    const visible = new Set(["a", "b"]);
    const ranking = [u("a", 1), u("b", 2, { role: "master" })];
    const result = filterVisibleRanking(ranking, visible);
    expect(result.map((r) => r.id)).toEqual(["a"]);
  });

  it("exclui ids virtuais (master-virtual-*) mesmo se no set visível", () => {
    const visible = new Set(["a", "master-virtual-xyz"]);
    const ranking = [u("a", 1), u("master-virtual-xyz", 2)];
    const result = filterVisibleRanking(ranking, visible);
    expect(result.map((r) => r.id)).toEqual(["a"]);
  });

  it("preserva admin e member/membro normalmente", () => {
    const visible = new Set(["adm", "mem"]);
    const ranking = [
      u("adm", 1, { role: "admin" }),
      u("mem", 2, { role: "membro" }),
    ];
    const result = filterVisibleRanking(ranking, visible);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("admin");
    expect(result[1].role).toBe("membro");
  });

  it("retorna array vazio quando visibleMemberIds está vazio", () => {
    const ranking = [u("a", 1), u("b", 2)];
    const result = filterVisibleRanking(ranking, new Set());
    expect(result).toEqual([]);
  });

  it("não muta o array original", () => {
    const visible = new Set(["a", "b"]);
    const ranking = [u("a", 1), u("master-1", 2), u("b", 3)];
    const snapshot = JSON.parse(JSON.stringify(ranking));
    filterVisibleRanking(ranking, visible);
    expect(ranking).toEqual(snapshot);
  });

  it("preserva os campos extras do entry (name, value)", () => {
    const visible = new Set(["a"]);
    const ranking = [u("a", 5, { name: "Alice", value: 12345 })];
    const [result] = filterVisibleRanking(ranking, visible);
    expect(result.name).toBe("Alice");
    expect(result.value).toBe(12345);
    expect(result.position).toBe(1); // renumerado
  });

  it("aplica as 3 camadas de defesa simultaneamente", () => {
    const visible = new Set(["admin-1", "master-virtual-1", "not-visible-stays-out"]);
    const ranking = [
      u("admin-1", 1, { role: "admin" }),
      u("master-1", 2, { role: "master" }), // falha camada 1 (não visível) e 2 (role)
      u("master-virtual-1", 3, { role: "admin" }), // passa camada 1 e 2, falha camada 3 (virtual)
      u("phantom", 4, { role: "membro" }), // falha camada 1 (não visível)
    ];
    const result = filterVisibleRanking(ranking, visible);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("admin-1");
    expect(result[0].position).toBe(1);
  });

  it("mantém ordem relativa do ranking após filtro (não reordena)", () => {
    const visible = new Set(["c", "a", "b"]);
    const ranking = [u("c", 1), u("a", 2), u("b", 3)];
    const result = filterVisibleRanking(ranking, visible);
    expect(result.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});
