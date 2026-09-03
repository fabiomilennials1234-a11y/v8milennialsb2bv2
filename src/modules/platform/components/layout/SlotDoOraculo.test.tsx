import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SlotDoOraculo } from "./SlotDoOraculo";

/**
 * A forma do slot em cada degrau.
 *
 * O degrau em si já é decidido e testado fora daqui (`slot-do-oraculo.ts` e
 * `useDegrauDoSlot`). O que este arquivo cobre é o que o degrau vira na tela.
 */

const GARGALO_CURTO = "3 leads parados";
const GARGALO_LONGO =
  "Quatorze negócios em Orçamentos sem nenhum contato há mais de nove dias, " +
  "somando duzentos e trinta mil reais em receita parada no funil inteiro";

function renderSlot(props: Partial<React.ComponentProps<typeof SlotDoOraculo>> = {}) {
  return render(
    <TooltipProvider>
      <SlotDoOraculo degrau="card" gargalo={GARGALO_CURTO} onAbrir={() => {}} {...props} />
    </TooltipProvider>,
  );
}

describe("SlotDoOraculo", () => {
  it("texto longo não cresce o card — a altura é do degrau, não do conteúdo", () => {
    const { unmount } = renderSlot({ gargalo: GARGALO_CURTO });
    const alturaComTextoCurto = screen.getByTestId("slot-do-oraculo").style.height;
    unmount();

    renderSlot({ gargalo: GARGALO_LONGO });
    const alturaComTextoLongo = screen.getByTestId("slot-do-oraculo").style.height;

    expect(alturaComTextoLongo).toBe(alturaComTextoCurto);
    expect(alturaComTextoLongo).not.toBe("");
  });

  it("no degrau ícone o alvo continua tendo nome — ícone mudo é adivinhação", () => {
    renderSlot({ degrau: "icone", gargalo: GARGALO_LONGO });

    const alvo = screen.getByRole("button", { name: /Oráculo/ });
    expect(alvo).toBeInTheDocument();
    // O gargalo não cabe em 36px: no ícone ele não é desenhado.
    expect(screen.queryByText(GARGALO_LONGO)).not.toBeInTheDocument();
  });

  it("o marcador aparece com gargalo e some sem gargalo", () => {
    // As duas metades no mesmo caso de propósito: só a ausência provaria nada,
    // porque um testid escrito errado também some.
    const { unmount } = renderSlot({ degrau: "icone", gargalo: GARGALO_CURTO });
    expect(screen.getByTestId("marcador-do-oraculo")).toBeInTheDocument();
    unmount();

    renderSlot({ degrau: "icone", gargalo: null });
    expect(screen.queryByTestId("marcador-do-oraculo")).not.toBeInTheDocument();
  });
});
