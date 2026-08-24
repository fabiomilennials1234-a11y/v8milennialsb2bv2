/**
 * GÊMEO — o front e o servidor têm de concordar sobre o que é Canal Oficial.
 *
 * A regra "qual provedor dispara, e em que regime" existe duas vezes:
 *
 *   front    `src/modules/campaigns/lib/disparo-numbers.ts`  (navegador)
 *   servidor `supabase/functions/_shared/decisao-do-disparo.ts` (Deno)
 *
 * Duas, porque o repo não compartilha código entre os dois lados. Divergir aqui
 * é o defeito exato que o #1722 conserta uma camada acima — a tela ofereceria
 * um número que o servidor recusa, ou pior: recusaria um que ele aceita, e a
 * Organization ficaria sem Disparo sem ninguém saber por quê.
 *
 * Prior art do padrão neste repo: `decisao-de-envio-twin`, `template-send-twin`,
 * `instance-routing-twin`, `blast-planning-twin`.
 */
import { describe, it, expect } from "vitest";
import { regimeDaInstancia } from "@/modules/campaigns";
import { regimeDoProvedor } from "../../supabase/functions/_shared/decisao-do-disparo.ts";

// Todo provedor que o produto conhece, mais os dois casos de borda que a
// ausência produz. A lista é o contrato: provedor novo entra aqui de propósito,
// não por acidente.
const PROVEDORES = [
  "uazapi",
  "evolution",
  "notificame",
  "meta_cloud",
  "provider_do_futuro",
  "",
];

describe("regime — front e servidor", () => {
  it.each(PROVEDORES)("concordam sobre '%s'", (provider) => {
    expect(regimeDaInstancia({ id: "i", status: "open", provider })).toBe(
      regimeDoProvedor(provider),
    );
  });

  it("e concordam que só o notificame é oficial hoje", () => {
    // CONTROLE POSITIVO: sem esta linha, os dois lados poderiam concordar
    // devolvendo `null` para tudo — verde por ausência de regime, não por
    // acordo.
    expect(regimeDoProvedor("notificame")).toBe("oficial");
    expect(regimeDaInstancia({ id: "i", status: "open", provider: "notificame" })).toBe("oficial");
  });
});
