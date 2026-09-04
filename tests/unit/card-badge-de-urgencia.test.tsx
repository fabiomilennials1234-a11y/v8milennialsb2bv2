/**
 * O badge de urgência do card do funil não pode vir de carona com a data.
 *
 * ── O DEFEITO ──────────────────────────────────────────────────────────────
 * `LeadCard` tinha UMA linha decidindo DUAS coisas:
 *
 *     const dateIndicator = config.showDate ? getDateIndicator(parsedDate) : null;
 *
 * `dateIndicator` alimenta o BADGE ("Atrasado", "Hoje", "D-2", "12 dias"), não
 * a linha de data. O S6 precisou ligar `showDate` na variante `custom` para
 * que a reunião marcada na Agenda aparecesse no card — e, com essa linha, ligou
 * junto o badge vermelho em TODO card de TODO funil custom, de toda org, sem
 * ninguém ter pedido. A data no `metadata` de um funil custom pode ser
 * qualquer coisa; carimbar "Atrasado" nela é o produto afirmando uma urgência
 * que ele não tem como conhecer.
 *
 * ── O QUE ESTE ARQUIVO PRENDE ─────────────────────────────────────────────
 *   1. `custom` DESENHA a data e NÃO ganha o badge;
 *   2. as cinco variantes que já tinham `showDate` ligada não perdem o badge
 *      (é a não-regressão que paga pela separação);
 *   3. `upsell_client`, que não mostra data, continua sem badge;
 *   4. quem QUISER o badge num funil custom pede pela prop, explicitamente.
 *
 * Renderiza o `LeadCard` REAL: o defeito mora na costura variante → config →
 * `dateIndicator` → `<Badge>`, e um dublê do card provaria só que o dublê
 * copia o que lhe entregam. Só os vizinhos que precisam de banco/identidade
 * entram como marcador — mesma lista de `lead-card-menu-checklists.test.tsx`.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/modules/leads/components/leads/card/LeadCardQualificationPopover", () => ({
  LeadCardQualificationPopover: () => null,
}));
vi.mock("@/modules/communication/components/chat/ScheduleMessageModal", () => ({
  ScheduleMessageModal: () => null,
}));
vi.mock("@/modules/communication/components/chat/AbrirConversaButton", () => ({
  AbrirConversaButton: () => null,
}));
vi.mock("@/modules/communication/components/chat/AbrirConversaMenuItem", () => ({
  AbrirConversaMenuItem: () => null,
}));
vi.mock("@/modules/leads/components/leads/AddToFunilDialog", () => ({
  AddToFunilMenuItem: () => null,
  AddToFunilDialog: () => null,
}));
vi.mock("@/modules/engagement", () => ({
  CreateMeetingDialog: () => null,
}));

import { LeadCard } from "@/modules/leads/components/leads/LeadCard";
import type { LeadCardVariant } from "@/modules/leads/components/leads/LeadCard";

/**
 * Uma data claramente no passado. `getDateIndicator` a rotula "Atrasado" — o
 * rótulo mais barulhento que ele produz, e o que mais estraga a tela quando
 * aparece onde não foi pedido.
 */
const ATRASADA = new Date("2020-03-01T10:00:00Z");

/** No futuro distante, para o rótulo neutro "N dias" (também é badge). */
const FUTURA = new Date(Date.now() + 30 * 86400000);

function montar(
  variant: LeadCardVariant,
  extra: Record<string, unknown> = {},
  date: Date = ATRASADA,
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LeadCard
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lead={{ id: "e-1", leadId: "l-1", name: "Evandro", date } as any}
        variant={variant}
        {...extra}
      />
    </QueryClientProvider>,
  );
}

/** O badge existe? Procura pelos rótulos que `getDateIndicator` produz. */
function temBadgeDeUrgencia(): boolean {
  return (
    screen.queryByText("Atrasado") !== null ||
    screen.queryByText(/^\d+ dias$/) !== null ||
    screen.queryByText("Hoje") !== null ||
    screen.queryByText("Amanhã") !== null
  );
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("o badge de urgencia e uma decisao separada da linha de data", () => {
  it("🚨 funil custom com reuniao atrasada DESENHA a data e NAO carimba 'Atrasado'", () => {
    montar("custom");

    // A linha de data existe: é o que o S6 foi buscar.
    expect(screen.getByText("01/03/2020")).toBeTruthy();
    // O badge não: ninguém pediu urgência em funil de assunto qualquer.
    expect(screen.queryByText("Atrasado")).toBeNull();
  });

  it("🚨 funil custom com data futura tambem nao ganha badge — nao e so o 'Atrasado'", () => {
    // O ternário antigo ligava o indicador INTEIRO, não só o caso vermelho.
    // Testar apenas "Atrasado" deixaria passar um "30 dias" cinza em cada card.
    montar("custom", {}, FUTURA);

    expect(temBadgeDeUrgencia()).toBe(false);
  });

  it("as cinco variantes que ja mostravam data NAO perdem o badge", () => {
    // A não-regressão que paga pela separação. Se alguma destas perder o
    // badge, a correção trocou um defeito por outro.
    const comBadge: LeadCardVariant[] = [
      "whatsapp",
      "confirmacao",
      "propostas",
      "followup",
      "upsell_campanha",
    ];

    for (const variante of comBadge) {
      montar(variante);
      expect(
        screen.queryByText("Atrasado"),
        `variante ${variante} perdeu o badge de urgência`,
      ).not.toBeNull();
      cleanup();
    }
  });

  it("upsell_client, que nao mostra data, continua sem badge", () => {
    montar("upsell_client");

    expect(screen.queryByText("01/03/2020")).toBeNull();
    expect(temBadgeDeUrgencia()).toBe(false);
  });

  it("quem QUER o badge num funil custom pede pela prop, explicitamente", () => {
    montar("custom", { showDateBadge: true });

    expect(screen.getByText("Atrasado")).toBeTruthy();
  });

  it("desligar a data NAO e o jeito de desligar o badge — sao eixos independentes", () => {
    // Prova que a separação vale nos dois sentidos: badge ligado com a linha
    // de data desligada continua sendo uma combinação alcançável.
    montar("custom", { showDate: false, showDateBadge: true });

    expect(screen.queryByText("01/03/2020")).toBeNull();
    expect(screen.getByText("Atrasado")).toBeTruthy();
  });
});
