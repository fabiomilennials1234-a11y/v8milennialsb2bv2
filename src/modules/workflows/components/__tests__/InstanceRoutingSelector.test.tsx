/**
 * InstanceRoutingSelector — o canal oficial na tela do nó (issue #1690).
 *
 * O painel tem de contar de dois jeitos ao mesmo tempo, e a diferença é o
 * assunto inteiro da fatia:
 *
 *  - "Número de saída" oferece o que o operador pode NOMEAR — inclui o canal
 *    oficial, porque o degrau 1 do executor o aceita.
 *  - O recuo e a contagem de "uma Instance viva só" usam o que o executor
 *    ESCOLHE sozinho — e ali o oficial não entra.
 *
 * Oferecer o oficial como recuo seria prometer uma escolha automática que o
 * executor recusa: o nó ficaria com um recuo declarado que nunca resolve.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const OFICIAL = {
  id: "inst-oficial",
  instance_name: "Chique Oficial",
  phone_number: "5511999999999",
  provider: "notificame",
  status: "connected",
  session_dead_since: null,
};
const CHIP = {
  id: "inst-chip",
  instance_name: "Carol",
  phone_number: "555597350981",
  provider: "uazapi",
  status: "connected",
  session_dead_since: null,
};
const CHIP_2 = { ...CHIP, id: "inst-chip-2", instance_name: "Comercial", phone_number: "5511888888888" };

let instancias: unknown[] = [];
vi.mock("@/modules/communication", () => ({
  useWhatsAppInstances: () => ({ data: instancias, isLoading: false }),
}));

import { InstanceRoutingSelector } from "@/modules/workflows/components/sidebar-panels/InstanceRoutingSelector";

function montar(data: Record<string, unknown>, insts: unknown[], fixedOnly = false) {
  instancias = insts;
  const onUpdate = vi.fn();
  render(<InstanceRoutingSelector data={data} onUpdate={onUpdate} fixedOnly={fixedOnly} />);
  return { onUpdate };
}

/** Abre um Select do Radix pelo seu aria-label e devolve as opções visíveis. */
function opcoesDe(label: string): string[] {
  fireEvent.click(screen.getByLabelText(label));
  return screen.getAllByRole("option").map((o) => o.textContent ?? "");
}

beforeEach(() => {
  instancias = [];
});

describe("o canal oficial na lista", () => {
  it("aparece em Número de saída, rotulado", () => {
    montar({ instanceRoutingPolicy: "fixed" }, [CHIP, OFICIAL]);
    const opcoes = opcoesDe("Número de saída");

    expect(opcoes.some((o) => o.includes("Chique Oficial"))).toBe(true);
    expect(opcoes.find((o) => o.includes("Chique Oficial"))).toContain("canal oficial");
  });

  it("NÃO aparece no recuo — ali quem escolhe é a regra", () => {
    // Duas legadas: com uma só o campo de recuo nem é exibido.
    montar({ instanceRoutingPolicy: "conversation" }, [CHIP, CHIP_2, OFICIAL]);
    const opcoes = opcoesDe("Se não houver conversa");

    expect(opcoes.some((o) => o.includes("Carol"))).toBe(true);
    expect(opcoes.some((o) => o.includes("Chique Oficial"))).toBe(false);
  });

  it("não conta para o atalho de uma Instance viva só", () => {
    // Chique de verdade: 1 chip + 1 oficial. Se o oficial contasse, o painel
    // exibiria o campo de recuo — e prometeria uma escolha que não existe.
    montar({ instanceRoutingPolicy: "conversation" }, [CHIP, OFICIAL]);
    expect(screen.queryByLabelText("Se não houver conversa")).toBeNull();
  });
});

describe("aviso de pin obsoleto", () => {
  it("com um número conectado, diz por onde o envio sai hoje", () => {
    montar(
      { instanceRoutingPolicy: "fixed", whatsappInstanceId: "inst-que-sumiu" },
      [CHIP, OFICIAL],
    );
    const aviso = screen.getByText(/não existe mais/);
    expect(aviso.textContent).toContain("Carol");
  });

  it("com dois números conectados, diz que o nó falha", () => {
    montar(
      { instanceRoutingPolicy: "fixed", whatsappInstanceId: "inst-que-sumiu" },
      [CHIP, CHIP_2, OFICIAL],
    );
    expect(screen.getByText(/falha no envio/)).toBeTruthy();
  });

  it("não aparece quando o número escolhido existe", () => {
    montar(
      { instanceRoutingPolicy: "fixed", whatsappInstanceId: OFICIAL.id },
      [CHIP, OFICIAL],
    );
    expect(screen.queryByText(/não existe mais/)).toBeNull();
  });
});

/**
 * `send_to_number` manda para números avulsos — vendedores, gestores. Eles não
 * são leads e nunca escreveram antes, então a janela de 24 horas está fechada
 * por definição e o canal oficial recusaria o texto livre, por callback, depois
 * de a tela dizer "enviado".
 */
describe("send_to_number não oferece o canal oficial", () => {
  it("lista só os números comuns", () => {
    montar({ whatsappInstanceId: "" }, [CHIP, OFICIAL], true);
    const opcoes = opcoesDe("Número de saída");

    expect(opcoes.some((o) => o.includes("Carol"))).toBe(true);
    expect(opcoes.some((o) => o.includes("Chique Oficial"))).toBe(false);
  });

  it("org só com canal oficial recebe explicação, não um seletor vazio", () => {
    montar({ whatsappInstanceId: "" }, [OFICIAL], true);
    expect(screen.getByText(/não alcança quem nunca escreveu antes/)).toBeTruthy();
  });
});
