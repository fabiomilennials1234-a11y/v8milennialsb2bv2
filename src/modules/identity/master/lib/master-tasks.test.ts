import { describe, expect, it } from "vitest";
import { formatTaskDueDate, formatTaskEstimate, isMasterTaskOverdue, masterTaskSchema } from "./master-tasks";

const input = {
  title: "Conferir acesso", description: "", status: "a_fazer",
  owner_master_user_id: "00000000-0000-4000-8000-000000000001",
  due_date: "2026-10-30", estimated_minutes: 1,
};

describe("prazo e tempo estimado das tarefas", () => {
  it.each(["", "2026-02-29", "2026-02-30", "2026-13-01", "0000-01-01", "infinity"])("rejeita data inválida %s", due_date => {
    expect(masterTaskSchema.safeParse({ ...input, due_date }).success).toBe(false);
  });

  it("aceita data passada e dia bissexto sem deslocar a data exibida", () => {
    expect(masterTaskSchema.safeParse({ ...input, due_date: "2024-02-29" }).success).toBe(true);
    expect(formatTaskDueDate("2024-02-29")).toBe("29/02/2024");
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2147483648])("rejeita duração inválida %s", estimated_minutes => {
    expect(masterTaskSchema.safeParse({ ...input, estimated_minutes }).success).toBe(false);
  });

  it("exibe estimativas curtas e longas sem arredondar ou tratar horas como dias", () => {
    expect(formatTaskEstimate(1)).toBe("1min");
    expect(formatTaskEstimate(60)).toBe("1h");
    expect(formatTaskEstimate(150)).toBe("2h 30min");
    expect(formatTaskEstimate(1500)).toBe("25h");
  });

  it("só marca atraso a partir do dia seguinte em Brasília, mesmo após virar a data UTC", () => {
    const task = { due_date: "2026-10-30", status: "a_fazer" as const };
    expect(isMasterTaskOverdue(task, new Date("2026-10-31T02:59:59Z"))).toBe(false);
    expect(isMasterTaskOverdue(task, new Date("2026-10-31T03:00:00Z"))).toBe(true);
    expect(isMasterTaskOverdue({ ...task, status: "fazendo" }, new Date("2026-10-31T03:00:00Z"))).toBe(true);
    expect(isMasterTaskOverdue({ ...task, status: "feito" }, new Date("2026-11-01T12:00:00Z"))).toBe(false);
  });
});
