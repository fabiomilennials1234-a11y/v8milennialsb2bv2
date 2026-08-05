import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as rtlRender, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O gate comercial do TorqueCalls é só de interface (o servidor já barra a
 * ação real com 403 em `torquecalls-control`) — mas isso não dá licença pra
 * interface mentir sobre o que a org tem. Antes deste arquivo, o filtro
 * `!i.featureKey || hasFeature(i.featureKey)` não tinha teste nenhum: um typo
 * (`&&` no lugar de `||`) some com WhatsApp/Facebook/Omie/etc. pra todo
 * mundo, e remover o filtro mostra o cartão pago pra quem não comprou — nos
 * dois casos o CI passa verde sem isto aqui.
 */

let voiceCallsEnabled = false;
// Sessão de voz "aberta" por padrão: existe pra provar que o badge de
// conectadas NÃO conta o TorqueCalls enquanto o cartão está escondido pela
// feature. Um dos testes troca o status para provar a outra ponta.
let voipSessionsData = [
  { tcSessionId: "tc-1", name: "Comercial", jid: "5548...", status: "open", whatsappInstanceId: "i-1" },
];

vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => ({
    hasFeature: (key: string) => (key === "voice_calls" ? voiceCallsEnabled : true),
  }),
}));

vi.mock("@/modules/communication/hooks/useMetaConnection", () => ({
  useMetaConnectionStatusByType: () => ({ isConnected: false }),
}));

vi.mock("@/modules/integrations/hooks/useGoogleCalendar", () => ({
  useGoogleCalendarStatus: () => ({ data: undefined }),
}));

vi.mock("@/modules/carteira/hooks/useTinyErp", () => ({
  useTinyErpStatus: () => ({ data: undefined }),
}));

vi.mock("@/modules/integrations", () => ({
  useOmieStatus: () => ({ data: undefined }),
}));

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null }),
        }),
      }),
    }),
  },
}));

// Mesmo specifier que `TorqueCallsSettings.tsx` consome — precisa cobrir os
// dois consumidores (este arquivo E o modal de settings que ele compõe),
// senão a importação estática do modal quebra mesmo sem o modal renderizar.
vi.mock("@/modules/communication", () => ({
  useWhatsAppInstances: () => ({ data: [] }),
  useVoipSessions: () => ({ data: voipSessionsData }),
  useVoiceSessionsCap: () => ({ data: 10 }),
  logoutVoiceSession: vi.fn(),
  VoiceControlError: class extends Error {},
  VoicePairingDialog: () => null,
}));

import IntegrationsCatalog from "./IntegrationsCatalog";

function render() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(
    <QueryClientProvider client={qc}>
      <IntegrationsCatalog />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  voiceCallsEnabled = false;
  voipSessionsData = [
    { tcSessionId: "tc-1", name: "Comercial", jid: "5548...", status: "open", whatsappInstanceId: "i-1" },
  ];
});

describe("IntegrationsCatalog — gate por feature", () => {
  it("integrações sem featureKey continuam visíveis mesmo com a org sem nenhuma feature paga", () => {
    // hasFeature nega tudo (só "voice_calls" é controlado pelo teste, e aqui
    // está false) — WhatsApp, Facebook, Instagram, Google Calendar, TinyERP,
    // Omie e ElevenLabs não têm featureKey nenhum, então o gate não se aplica.
    render();
    expect(screen.getByText("WhatsApp Business")).toBeInTheDocument();
    expect(screen.getByText("Facebook")).toBeInTheDocument();
    expect(screen.getByText("Instagram")).toBeInTheDocument();
    expect(screen.getByText("Google Calendar")).toBeInTheDocument();
    expect(screen.getByText("TinyERP")).toBeInTheDocument();
    expect(screen.getByText("Omie")).toBeInTheDocument();
    expect(screen.getByText("ElevenLabs")).toBeInTheDocument();
  });

  it("TorqueCalls não aparece sem a feature voice_calls", () => {
    voiceCallsEnabled = false;
    render();
    expect(screen.queryByText("TorqueCalls")).not.toBeInTheDocument();
  });

  it("TorqueCalls aparece quando a org tem a feature voice_calls", () => {
    voiceCallsEnabled = true;
    render();
    expect(screen.getByText("TorqueCalls")).toBeInTheDocument();
  });

  it("o badge de conectadas não conta um cartão escondido pela feature", () => {
    // TorqueCalls está "conectado" (voipSessionsData tem uma sessão aberta),
    // mas escondido — o badge tem que ignorá-lo, tanto na contagem de
    // conectadas quanto no total.
    voiceCallsEnabled = false;
    render();
    expect(screen.getByText(/0\/7 conectadas/)).toBeInTheDocument();
  });

  it("o badge de conectadas soma o TorqueCalls assim que ele fica visível", () => {
    voiceCallsEnabled = true;
    render();
    expect(screen.getByText(/1\/8 conectadas/)).toBeInTheDocument();
  });

  // Mesmo defeito da tela de settings, na outra superfície: o badge dizia
  // "conectado" para uma sessão que nasce `pending` no `createSession` e que
  // NADA neste repositório promove para `open`. O cliente que abre o modal do
  // QR e desiste via o TorqueCalls marcado como conectado no catálogo.
  it("sessão pending não conta como conectada — o catálogo não promete voz que não existe", () => {
    voiceCallsEnabled = true;
    voipSessionsData = [
      { tcSessionId: "tc-1", name: "Comercial", jid: "5548...", status: "pending", whatsappInstanceId: "i-1" },
    ];
    render();
    expect(screen.getByText("TorqueCalls")).toBeInTheDocument();
    expect(screen.getByText(/0\/8 conectadas/)).toBeInTheDocument();
  });
});
