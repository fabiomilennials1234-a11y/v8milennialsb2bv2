// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { metaPilotAllows } from "../../supabase/functions/_shared/meta-pilot";
afterEach(() => vi.unstubAllGlobals());
it("denies missing and empty pilot configuration", () => {
  for (const value of [undefined, "", " , "]) {
    vi.stubGlobal("Deno", { env: { get: () => value } });
    expect(metaPilotAllows("org-a")).toBe(false);
    expect(metaPilotAllows("")).toBe(false);
  }
});
it("matches complete organization IDs and rejects substring or wildcard", () => {
  vi.stubGlobal("Deno", { env: { get: () => " ORG-A,org-b " } });
  expect(metaPilotAllows("org-a")).toBe(true);
  expect(metaPilotAllows("org-b")).toBe(true);
  expect(metaPilotAllows("org")).toBe(false);
  expect(metaPilotAllows("org-c")).toBe(false);
  vi.stubGlobal("Deno", { env: { get: () => "*" } });
  expect(metaPilotAllows("org-c")).toBe(false);
});
