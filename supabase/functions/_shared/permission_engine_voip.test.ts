import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { featureKeyForAction, VOIP_ACTIONS } from "./permission_engine.ts";

const ENGINE_SRC = await Deno.readTextFile(
  new URL("./permission_engine.ts", import.meta.url),
);

const MIGRATION_SRC = await Deno.readTextFile(
  new URL(
    "../../migrations/20270730000000_torquecalls_voip_foundation.sql",
    import.meta.url,
  ),
);

/** Membros da união PermissionAction, lidos do próprio arquivo. */
function unionMembers(): string[] {
  const block = ENGINE_SRC.match(
    /export type PermissionAction =([\s\S]*?);\n/,
  );
  assert(block, "não achei a união PermissionAction em permission_engine.ts");
  return [...block[1].matchAll(/\|\s*"([^"]+)"/g)].map((m) => m[1]);
}

/** feature_permissions.key semeadas pela migration da fundação TorqueCalls. */
function seededVoipKeys(): string[] {
  return [...MIGRATION_SRC.matchAll(/\('(voip\.[a-z_.]+)',\s*'Chamadas'/g)]
    .map((m) => m[1])
    .sort();
}

Deno.test("toda ação de voz tem feature_key mapeada", () => {
  for (const action of VOIP_ACTIONS) {
    const key = featureKeyForAction(action);
    assert(
      key !== undefined,
      `${action} sem entrada em ACTION_TO_FEATURE — cairia no fallback ` +
        `terminal e negaria todo membro não-admin com permission_not_defined`,
    );
    assert(key!.startsWith("voip."), `${action} → ${key} não é feature de voz`);
  }
});

Deno.test("nenhuma ação de voz escapa do mapa", () => {
  // Guarda contra a ação nova que alguém acrescenta à união e esquece de mapear.
  // A união é apagada em runtime, então a fonte é lida como texto.
  const suspects = unionMembers().filter((a) =>
    /voip|call/i.test(a) && a !== "trigger_campaign"
  );
  assert(suspects.length > 0, "regex de detecção não pegou nada — teste inútil");

  for (const action of suspects) {
    assert(
      (VOIP_ACTIONS as readonly string[]).includes(action),
      `${action} parece ação de voz mas está fora de VOIP_ACTIONS`,
    );
    assert(
      featureKeyForAction(action as never) !== undefined,
      `${action} está na união sem feature_key`,
    );
  }
});

Deno.test("o mapa do engine bate com o que a migration semeia", () => {
  // O modo de falha que este teste existe para pegar: chave semeada no banco com
  // um nome, referenciada no código com outro. A permissão fica inerte e ninguém
  // percebe até um cliente reclamar que não consegue ligar.
  const fromEngine = VOIP_ACTIONS
    .map((a) => featureKeyForAction(a)!)
    .sort();

  assertEquals(
    fromEngine,
    seededVoipKeys(),
    "ACTION_TO_FEATURE e a migration discordam sobre as chaves de voz",
  );
});

Deno.test("voip.session.manage é semeada como admin-only", () => {
  const stanza = MIGRATION_SRC.match(
    /\('voip\.session\.manage',[\s\S]*?\n\s*(true|false),\s*(true|false),\s*\d+\)/,
  );
  assert(stanza, "não achei a linha de voip.session.manage na migration");
  assertEquals(stanza[1], "true", "voip.session.manage precisa ser is_admin_only");
  assertEquals(stanza[2], "false", "voip.session.manage não pode nascer liberada");
});

Deno.test("discagem avulsa nasce negada", () => {
  const stanza = MIGRATION_SRC.match(
    /\('voip\.call\.dial_manual',[\s\S]*?\n\s*(true|false),\s*(true|false),\s*\d+\)/,
  );
  assert(stanza, "não achei a linha de voip.call.dial_manual na migration");
  assertEquals(
    stanza[2],
    "false",
    "discar número avulso não pode nascer liberado: sem lead não há fronteira nem trilha",
  );
});
