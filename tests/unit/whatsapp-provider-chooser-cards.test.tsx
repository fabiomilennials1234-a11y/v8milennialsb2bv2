/**
 * O chooser oferece EXATAMENTE os caminhos que a org tem.
 *
 * O defeito que este teste tranca: até 2026-08-17 o card da Meta renderizava
 * incondicionalmente. A flag `meta_cloud` decidia só se o DIÁLOGO abria, não se
 * aquele card aparecia — então uma org com `notificame` ligada e `meta_cloud`
 * desligada via o Embedded Signup oferecido e clicava num caminho que ela não
 * tem. A regra passou a ser a mesma dos dois caminhos oficiais: o card existe se,
 * e somente se, o handler dele chegar.
 *
 * A asserção é pela AUSÊNCIA do card, não pelo número de cards: contar cards
 * continuaria verde se o card errado fosse escondido.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WhatsAppProviderChooser } from "@/modules/communication/components/whatsapp/WhatsAppProviderChooser";
import { getProviderProfile } from "@/modules/communication/lib/whatsapp-provider";

const META_LABEL = getProviderProfile("meta_cloud").label;
const UAZAPI_LABEL = getProviderProfile("uazapi").label;
const NOTIFICAME_LABEL = getProviderProfile("notificame").label;

describe("WhatsAppProviderChooser", () => {
  it("esconde o card da Meta quando o handler não é passado (flag meta_cloud OFF)", () => {
    render(
      <WhatsAppProviderChooser
        open
        onOpenChange={vi.fn()}
        onChooseUazapi={vi.fn()}
        onChooseNotificame={vi.fn()}
      />,
    );

    expect(screen.queryByText(META_LABEL)).toBeNull();
    // Controle positivo: o teste falharia por render vazio sem estas duas.
    expect(screen.getByText(UAZAPI_LABEL)).toBeTruthy();
    expect(screen.getByText(NOTIFICAME_LABEL)).toBeTruthy();
  });

  it("mostra o card da Meta quando o handler é passado (flag meta_cloud ON)", () => {
    render(
      <WhatsAppProviderChooser
        open
        onOpenChange={vi.fn()}
        onChooseUazapi={vi.fn()}
        onChooseMeta={vi.fn()}
        onChooseNotificame={vi.fn()}
      />,
    );

    expect(screen.getByText(META_LABEL)).toBeTruthy();
  });

  it("esconde o card do NotificaMe quando o handler não é passado (flag notificame OFF)", () => {
    render(
      <WhatsAppProviderChooser
        open
        onOpenChange={vi.fn()}
        onChooseUazapi={vi.fn()}
        onChooseMeta={vi.fn()}
      />,
    );

    expect(screen.queryByText(NOTIFICAME_LABEL)).toBeNull();
    expect(screen.getByText(META_LABEL)).toBeTruthy();
  });
});
