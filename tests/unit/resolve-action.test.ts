/**
 * Unit tests for `resolvePermission` — pure permission-resolution function.
 *
 * Cascade: master → admin → ACTION_TO_FEATURE → fail-closed.
 */

import { describe, it, expect } from "vitest";
import { resolvePermission } from "@/shared/permission-actions";

describe("resolvePermission — pure permission resolver", () => {
  it("master → allowed for any action (even unmapped)", () => {
    const result = resolvePermission("totally_unknown_action" as never, {
      isMaster: true,
      role: "membro",
      featurePermissions: {},
    });
    expect(result).toEqual({ allowed: true, reason: "master" });
  });

  it("admin → allowed for any action", () => {
    const result = resolvePermission("move_pipe_record", {
      isMaster: false,
      role: "admin",
      featurePermissions: {},
    });
    expect(result).toEqual({ allowed: true, reason: "admin" });
  });

  it("membro + move_pipe_record + feature enabled → allowed", () => {
    const result = resolvePermission("move_pipe_record", {
      isMaster: false,
      role: "membro",
      featurePermissions: { "pipeline.move_cards": true },
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("feature:pipeline.move_cards");
  });

  it("membro + move_pipe_record + feature disabled → denied", () => {
    const result = resolvePermission("move_pipe_record", {
      isMaster: false,
      role: "membro",
      featurePermissions: { "pipeline.move_cards": false },
    });
    expect(result.allowed).toBe(false);
  });

  it("membro + move_pipe_record + feature missing → denied (fail-closed)", () => {
    const result = resolvePermission("move_pipe_record", {
      isMaster: false,
      role: "membro",
      featurePermissions: {},
    });
    expect(result.allowed).toBe(false);
  });

  it("membro + send_message + feature enabled → allowed", () => {
    const result = resolvePermission("send_message", {
      isMaster: false,
      role: "membro",
      featurePermissions: { "whatsapp.send_messages": true },
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("feature:whatsapp.send_messages");
  });

  it("membro + unmapped action → denied", () => {
    const result = resolvePermission("totally_unknown_action" as never, {
      isMaster: false,
      role: "membro",
      featurePermissions: {},
    });
    expect(result.allowed).toBe(false);
  });

  it("membro + feature action + feature enabled → allowed", () => {
    const result = resolvePermission("edit_workflow", {
      isMaster: false,
      role: "membro",
      featurePermissions: { "workflows.edit": true },
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("feature:workflows.edit");
  });

  it("membro + feature action + feature disabled → denied", () => {
    const result = resolvePermission("manage_copilot", {
      isMaster: false,
      role: "membro",
      featurePermissions: { "copilot.create": false },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/copilot\.create/);
  });

  it("admin bypasses feature permissions even when disabled", () => {
    const result = resolvePermission("move_pipe_record", {
      isMaster: false,
      role: "admin",
      featurePermissions: { "pipeline.move_cards": false },
    });
    expect(result).toEqual({ allowed: true, reason: "admin" });
  });
});
