/**
 * Provider-scope contract for whatsapp_instances dispatch fallbacks.
 *
 * Invariant (Meta Cloud isolation, cert Rule 2): any edge-function query that
 * selects an org's WhatsApp instance to DISPATCH through — i.e. an
 * organization_id-scoped select that is NOT a lookup by a specific id — MUST
 * constrain the provider to the legacy senders `["uazapi","evolution"]`.
 *
 * Why: a `provider='meta_cloud'` number is gated by Meta's 24h window +
 * approved templates. If a provider-blind "first instance of the org" fallback
 * picks it for a free-form / Uazapi-intended send, the message mis-routes
 * through the Meta API and fails. The shared resolver
 * (_shared/whatsapp-dispatch.ts resolveInstance) is already scoped; this
 * contract pins every INLINE copy and blocks new ones.
 *
 * A query is exempt when it: filters provider explicitly, looks up by id, or is
 * a monitoring/admin scan tagged with the PROVIDER_SCOPE_EXEMPT marker on the
 * `.from("whatsapp_instances")` line's statement.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const FUNCTIONS_DIR = resolve(__dirname, "../../supabase/functions");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (entry.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

const allTsFiles = walk(FUNCTIONS_DIR);

/** Split a source file into the text of each whatsapp_instances query chain. */
function instanceQueryChains(source: string): string[] {
  const chains: string[] = [];
  const re = /\.from\(["']whatsapp_instances["']\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    // Capture from the .from(...) to the end of the statement (next semicolon).
    const start = m.index;
    const end = source.indexOf(";", start);
    chains.push(source.slice(start, end === -1 ? start + 600 : end));
  }
  return chains;
}

describe("whatsapp_instances provider-scope contract (Rule 2)", () => {
  it("every org-scoped dispatch-instance select constrains provider to legacy senders", () => {
    const offenders: Array<{ file: string; excerpt: string }> = [];

    for (const file of allTsFiles) {
      if (file.includes(`${sep}whatsapp-dispatch.ts`)) continue; // the shared, already-scoped resolver
      const source = readFileSync(file, "utf8");

      for (const chain of instanceQueryChains(source)) {
        // Only "pick an instance for this org" selects are dispatch fallbacks:
        // organization_id must be a FILTER, not merely a selected column (the
        // latter is a by-token org-resolution lookup).
        const orgScoped = /\.eq\(\s*["']organization_id["']/.test(chain);
        // Explicit bindings are intentional (mirror preferredInstanceId): a
        // lookup by instance id or by the agent it's bound to may legitimately
        // resolve a Meta number on purpose.
        const explicitBinding = /\.eq\(\s*["'](id|copilot_agent_id|whatsapp_instance_id)["']/.test(chain);
        const providerFiltered = /\.(eq|in)\(\s*["']provider["']/.test(chain);
        const exempt = /PROVIDER_SCOPE_EXEMPT/.test(chain);

        if (orgScoped && !explicitBinding && !providerFiltered && !exempt) {
          offenders.push({
            file: file.slice(FUNCTIONS_DIR.length + 1).split(sep).join("/"),
            excerpt: chain.replace(/\s+/g, " ").slice(0, 160),
          });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
