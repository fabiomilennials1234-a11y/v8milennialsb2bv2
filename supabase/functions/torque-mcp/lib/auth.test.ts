import { assertEquals } from "@std/assert";
import { createCachedMasterClientProvider, sessionNeedsRefresh } from "./auth.ts";

const NOW = 1_000_000_000_000; // fixed clock (ms)

Deno.test("sessionNeedsRefresh — no expiry → refresh", () => {
  assertEquals(sessionNeedsRefresh(undefined, NOW), true);
});

Deno.test("sessionNeedsRefresh — expires comfortably in the future → reuse", () => {
  const expiresAtSec = NOW / 1000 + 3600; // +1h
  assertEquals(sessionNeedsRefresh(expiresAtSec, NOW), false);
});

Deno.test("sessionNeedsRefresh — within the skew window → refresh early", () => {
  const expiresAtSec = NOW / 1000 + 30; // +30s, inside default 60s skew
  assertEquals(sessionNeedsRefresh(expiresAtSec, NOW), true);
});

Deno.test("sessionNeedsRefresh — already expired → refresh", () => {
  const expiresAtSec = NOW / 1000 - 10;
  assertEquals(sessionNeedsRefresh(expiresAtSec, NOW), true);
});

Deno.test("master client provider — caches the client across calls while fresh", async () => {
  let signIns = 0;
  const provider = createCachedMasterClientProvider({
    now: () => NOW,
    signIn: () => {
      signIns++;
      return Promise.resolve({
        client: { n: signIns },
        session: { expires_at: NOW / 1000 + 3600 },
      });
    },
  });
  const c1 = await provider();
  const c2 = await provider();
  assertEquals(signIns, 1); // signed in exactly once
  assertEquals(c1, c2); // same cached client instance
});

Deno.test("master client provider — re-signs in when the session goes stale", async () => {
  let signIns = 0;
  let clock = NOW;
  const provider = createCachedMasterClientProvider({
    now: () => clock,
    signIn: () => {
      signIns++;
      return Promise.resolve({
        client: { n: signIns },
        session: { expires_at: clock / 1000 + 100 },
      });
    },
  });
  await provider(); // sign-in #1, expires +100s
  clock = NOW + 50_000; // +50s → within 60s skew of expiry → stale
  await provider(); // sign-in #2
  assertEquals(signIns, 2);
});
