/**
 * InstanceRoutingSelector — o canal oficial na tela do nó (issues #1690, #1700).
 *
 * O #1690 deixou o oficial NOMEÁVEL: ele aparecia em "Número de saída" e ficava
 * fora do recuo e da contagem de "uma Instance viva só", porque o executor não
 * o escolhia sozinho. O #1700 o tornou ESCOLHÍVEL, e a assimetria caiu: ele
 * entra no recuo e conta no atalho, porque o executor passou a fazer o mesmo.
 *
 * O que NÃO caiu, e é o assunto do #1700, são dois recortes de chip que o
 * painel tem de reproduzir exatamente:
 *
 *  - `send_to_number`, que nunca oferece o oficial;
 *  - o aviso de fixa obsoleta, que descreve `deadPinShortcut` — com a fixa
 *    morta o executor conta só chips, e são 63 nós ativos pendurados nisso.
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

  it("aparece no recuo — o degrau 4 do executor o aceita (#1700)", () => {
    // Duas legadas: com uma só o campo de recuo nem é exibido.
    montar({ instanceRoutingPolicy: "conversation" }, [CHIP, CHIP_2, OFICIAL]);
    const opcoes = opcoesDe("Se não houver conversa");

    expect(opcoes.some((o) => o.includes("Carol"))).toBe(true);
    expect(opcoes.some((o) => o.includes("Chique Oficial"))).toBe(true);
  });

  it("conta para o atalho de uma Instance viva só (#1700)", () => {
    // Chique de verdade: 1 chip + 1 oficial. O executor conta DOIS números
    // roteáveis, então a política precisa resolver — e o operador precisa ver o
    // campo de recuo, que é a única declaração que salva o nó se ela não
    // resolver. Esconder aqui seria o painel contar menos que o envio.
    montar({ instanceRoutingPolicy: "conversation" }, [CHIP, OFICIAL]);
    expect(screen.queryByLabelText("Se não houver conversa")).not.toBeNull();
  });

  it("org só com canal oficial não pede recuo — é o único número", () => {
    montar({ instanceRoutingPolicy: "conversation" }, [OFICIAL]);
    expect(screen.queryByLabelText("Se não houver conversa")).toBeNull();
  });
});

/**
 * O aviso descreve `deadPinShortcut`, não a contagem geral. São 63 nós ativos
 * em 9 orgs com a fixa morta e sem recuo (medido 2026-08-20); o operador
 * precisa ler por onde o envio sai HOJE, e "hoje" é o chip.
 */
describe("aviso de fixa obsoleta", () => {
  it("com chip e canal oficial, nomeia o chip — é por ele que o envio sai", () => {
    montar(
      { instanceRoutingPolicy: "fixed", whatsappInstanceId: "inst-que-sumiu" },
      [CHIP, OFICIAL],
    );
    const aviso = screen.getByText(/não existe mais/);
    expect(aviso.textContent).toContain("Carol");
    expect(aviso.textContent).not.toContain("Chique Oficial");
  });

  it("org só com canal oficial nomeia o oficial — é o único número que existe", () => {
    montar(
      { instanceRoutingPolicy: "fixed", whatsappInstanceId: "inst-que-sumiu" },
      [OFICIAL],
    );
    expect(screen.getByText(/não existe mais/).textContent).toContain("Chique Oficial");
  });

  it("com dois chips conectados, diz que o nó falha", () => {
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
