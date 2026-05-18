/**
 * Unit tests for `resolveAction` — pure permission-resolution function.
 *
 * Issue #254 (parent #253). TDD red-green-refactor.
 *
 * Cascade: master → admin → ACTION_TO_FEATURE → ACTION_TO_MATRIX
 *          → open actions (send_message) → fail-closed (unmapped_action).
 */

import { describe, it, expect } from "vitest";
import { resolveAction } from "@/lib/permissions";

const emptyMatrix = () => new Map<string, "allowed" | "denied">();

describe("resolveAction — pure permission resolver", () => {
  it("master → allowed for any action (even unmapped)", () => {
    const result = resolveAction("totally_unknown_action" as never, {
      isMaster: true,
      role: "membro",
      featurePermissions: {},
      matrixPermissions: emptyMatrix(),
    });
    expect(result).toEqual({ allowed: true, reason: "admin" });
  });

  it("admin → allowed for any action", () => {
    const result = resolveAction("move_pipe_record", {
      isMaster: false,
      role: "admin",
      featurePermissions: {},
      matrixPermissions: emptyMatrix(),
    });
    expect(result).toEqual({ allowed: true, reason: "admin" });
  });

  it("membro + move_pipe_record + empty matrix → allowed (matrix_default_allowed)", () => {
    const result = resolveAction("move_pipe_record", {
      isMaster: false,
      role: "membro",
      featurePermissions: {},
      matrixPermissions: emptyMatrix(),
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toMatch(/matrix/i);
  });

  it("membro + move_pipe_record + matrix pipe:move=denied → denied", () => {
    const matrix = new Map<string, "allowed" | "denied">();
    matrix.set("pipe:move", "denied");
    const result = resolveAction("move_pipe_record", {
      isMaster: false,
      role: "membro",
      featurePermissions: {},
      matrixPermissions: matrix,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/denied/);
  });

  it("membro + move_pipe_record + matrix pipe:move=allowed → allowed", () => {
    const matrix = new Map<string, "allowed" | "denied">();
    matrix.set("pipe:move", "allowed");
    const result = resolveAction("move_pipe_record", {
      isMaster: false,
      role: "membro",
      featurePermissions: {},
      matrixPermissions: matrix,
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("matrix_allowed");
  });

  it("membro + send_message → allowed (open action)", () => {
    const result = resolveAction("send_message", {
      isMaster: false,
      role: "membro",
      featurePermissions: {},
      matrixPermissions: emptyMatrix(),
    });
    expect(result).toEqual({ allowed: true, reason: "open" });
  });

  it("membro + unmapped action → denied (unmapped_action)", () => {
    const result = resolveAction("totally_unknown_action" as never, {
      isMaster: false,
      role: "membro",
      featurePermissions: {},
      matrixPermissions: emptyMatrix(),
    });
    expect(result).toEqual({ allowed: false, reason: "unmapped_action" });
  });

  it("membro + feature action + feature enabled → allowed", () => {
    const result = resolveAction("edit_workflow", {
      isMaster: false,
      role: "membro",
      featurePermissions: { "workflows.edit": true },
      matrixPermissions: emptyMatrix(),
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("feature:workflows.edit");
  });

  it("membro + feature action + feature disabled → denied", () => {
    const result = resolveAction("manage_copilot", {
      isMaster: false,
      role: "membro",
      featurePermissions: { "copilot.create": false },
      matrixPermissions: emptyMatrix(),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/copilot\.create/);
  });

  it("admin in matrix-mapped action returns admin reason (does not consult matrix)", () => {
    // Regression: admin bypass takes precedence over matrix lookup.
    const matrix = new Map<string, "allowed" | "denied">();
    matrix.set("pipe:move", "denied");
    const result = resolveAction("move_pipe_record", {
      isMaster: false,
      role: "admin",
      featurePermissions: {},
      matrixPermissions: matrix,
    });
    expect(result).toEqual({ allowed: true, reason: "admin" });
  });
});
