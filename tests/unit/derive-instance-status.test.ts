/**
 * deriveInstanceStatus — settings-side reconciliation between provider-webhook
 * `status` and watchdog-polled `session_dead_since`.
 *
 * Background: when WhatsApp is logged out from a different device, Uazapi never
 * fires a webhook, so `whatsapp_instances.status` stays frozen at "connected".
 * The watchdog cron detects this via active polling and stamps
 * `session_dead_since`. The settings page must surface the watchdog's verdict
 * so it matches the global SessionDeadBanner.
 */
import { describe, it, expect } from "vitest";
import { deriveInstanceStatus } from "../../src/components/settings/WhatsAppSettings";

describe("deriveInstanceStatus", () => {
  it("returns status when session_dead_since is null", () => {
    expect(
      deriveInstanceStatus({ status: "connected", session_dead_since: null } as any),
    ).toBe("connected");
    expect(
      deriveInstanceStatus({ status: "connecting", session_dead_since: null } as any),
    ).toBe("connecting");
    expect(
      deriveInstanceStatus({ status: "disconnected", session_dead_since: null } as any),
    ).toBe("disconnected");
  });

  it("Bertin regression: overrides stale status='connected' when watchdog stamped session_dead_since", () => {
    // whatsapp_instances row Comercial Interno Bertin: status='connected' (webhook
    // never landed after logout-from-another-device), session_dead_since set by
    // watchdog. UI must show "disconnected" so it agrees with the red banner.
    const result = deriveInstanceStatus({
      status: "connected",
      session_dead_since: "2026-05-23T04:40:04Z",
    } as any);
    expect(result).toBe("disconnected");
  });

  it("overrides any non-empty session_dead_since regardless of status value", () => {
    for (const status of ["connected", "connecting", "error", "disconnected", "unknown"]) {
      expect(
        deriveInstanceStatus({
          status,
          session_dead_since: "2026-01-01T00:00:00Z",
        } as any),
      ).toBe("disconnected");
    }
  });

  it("falls back to 'disconnected' when status is null and no session_dead_since", () => {
    expect(
      deriveInstanceStatus({ status: null, session_dead_since: null } as any),
    ).toBe("disconnected");
  });
});
