/**
 * Interface nova ou clássica por organização — a decisão que as duas builds
 * compartilham (`src/shared/ui-version/core.ts`).
 *
 * O que não pode quebrar:
 * - sem resposta clara da org, fica a clássica (o que está em produção hoje);
 * - build certa só sincroniza o cookie, sem recarregar;
 * - build errada troca UMA vez; se o servidor insiste na mesma build (dev,
 *   preview, nginx sem o mapa), a guarda desiste em vez de recarregar em laço.
 */
import { describe, expect, it } from "vitest";
import {
  JANELA_DE_TROCA_MS,
  decidirUi,
  lerCookieUi,
  uiPedidaPelaOrg,
} from "@/shared/ui-version/core";

describe("uiPedidaPelaOrg", () => {
  it("só `true` liga a interface nova", () => {
    expect(uiPedidaPelaOrg(true)).toBe("v5");
    expect(uiPedidaPelaOrg(false)).toBe("classic");
    expect(uiPedidaPelaOrg(null)).toBe("classic");
    expect(uiPedidaPelaOrg(undefined)).toBe("classic");
  });
});

describe("lerCookieUi", () => {
  it("acha o cookie entre outros", () => {
    expect(lerCookieUi("a=1; torque_ui=v5; b=2")).toBe("v5");
    expect(lerCookieUi("torque_ui=classic")).toBe("classic");
  });

  it("valor desconhecido ou ausente é null", () => {
    expect(lerCookieUi("")).toBeNull();
    expect(lerCookieUi("torque_ui=v4")).toBeNull();
    // prefixo parecido não conta
    expect(lerCookieUi("xtorque_ui=v5")).toBeNull();
  });
});

describe("decidirUi", () => {
  const agora = 1_000_000;

  it("build certa e cookie certo: fica", () => {
    expect(decidirUi({ rodando: "v5", pedida: "v5", cookie: "v5", ultimaTentativa: null, agora })).toBe("ficar");
  });

  it("build certa sem cookie: grava o cookie, não recarrega", () => {
    expect(decidirUi({ rodando: "classic", pedida: "classic", cookie: null, ultimaTentativa: null, agora })).toBe(
      "sincronizar-cookie",
    );
  });

  it("build errada: troca", () => {
    expect(decidirUi({ rodando: "classic", pedida: "v5", cookie: null, ultimaTentativa: null, agora })).toBe("trocar");
  });

  it("já tentou trocar para o mesmo destino há pouco e segue na build errada: desiste", () => {
    expect(
      decidirUi({
        rodando: "v5",
        pedida: "classic",
        cookie: "classic",
        ultimaTentativa: { destino: "classic", em: agora - 1_000 },
        agora,
      }),
    ).toBe("desistir");
  });

  it("tentativa velha ou para outro destino não bloqueia a troca", () => {
    expect(
      decidirUi({
        rodando: "v5",
        pedida: "classic",
        cookie: "classic",
        ultimaTentativa: { destino: "classic", em: agora - JANELA_DE_TROCA_MS - 1 },
        agora,
      }),
    ).toBe("trocar");
    expect(
      decidirUi({
        rodando: "v5",
        pedida: "classic",
        cookie: "v5",
        ultimaTentativa: { destino: "v5", em: agora - 1_000 },
        agora,
      }),
    ).toBe("trocar");
  });
});
