import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard: `useAuth()` (AuthContext) só expõe { user, session, loading, signIn, signUp, signOut }.
 * NÃO tem `organizationId`. Destructurar `organizationId` de useAuth devolve `undefined`
 * silenciosamente → queries com `enabled: !!organizationId` nunca rodam (bug /lixeira,
 * /duplicados vazios para todos). A fonte correta de org é `useOrganization()` (shadow-aware).
 *
 * Este teste falha se alguém reintroduzir o antipadrão. Ver reference: useauth-no-organizationid.
 */

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// Casa `const { ...organizationId... } = useAuth()` (destructuring de organizationId de useAuth),
// tolerando quebras de linha e outras propriedades antes/depois.
const OFFENDER = /const\s*\{[^}]*\borganizationId\b[^}]*\}\s*=\s*useAuth\s*\(/s;

describe("useAuth não fornece organizationId", () => {
  it("nenhum arquivo em src/ destructura organizationId de useAuth()", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const code = readFileSync(file, "utf8");
      if (OFFENDER.test(code)) {
        offenders.push(file.replace(process.cwd(), "").replace(/\\/g, "/"));
      }
    }
    expect(
      offenders,
      `Use useOrganization() para organizationId (shadow-aware). Arquivos com o antipadrão:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
