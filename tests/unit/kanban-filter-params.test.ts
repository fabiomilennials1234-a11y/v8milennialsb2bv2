import { describe, it, expect } from "vitest";
import {
  CONFIRMACAO_OVERDUE_EXCLUDE_STATUS_KEYS,
} from "@/modules/pipelines/lib/kanbanFilterParams";

describe("status-key constants", () => {
  it("confirmação overdue exclusions", () => {
    expect([...CONFIRMACAO_OVERDUE_EXCLUDE_STATUS_KEYS]).toEqual(["compareceu", "perdido"]);
  });
});
