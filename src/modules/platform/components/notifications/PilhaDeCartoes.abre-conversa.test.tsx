import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Aviso } from "../../lib/aviso-stream";
import { mostrarCartao, reiniciarCartoes } from "../../lib/cartoes-store";
import { PilhaDeCartoes } from "./PilhaDeCartoes";

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), flag: false }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn().mockResolvedValue(undefined) }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }) },
}));
vi.mock("../../hooks/useAvisos", () => ({ useAvisos: () => ({}) }));
vi.mock("../../hooks/useFeatureFlag", () => ({ useFeatureFlag: () => ({ enabled: mocks.flag, isLoading: false }) }));

const LINK = "/chat-whatsapp?instance=7aac7b5e-2533-4eec-aae1-29aff074f4bb&phone=553398674703";
const aviso: Aviso = {
  id: "a1",
  organization_id: "org",
  user_id: "u",
  type: "lead_message",
  title: "Cliente X",
  description: "oi",
  link: LINK,
  lead_id: "l1",
  entity_id: "l1",
  group_key: "msg:org:i:553398674703",
  event_count: 1,
  last_event_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  read_at: null,
} as Aviso;

beforeEach(() => {
  mocks.navigate.mockClear();
  reiniciarCartoes();
});
afterEach(cleanup);

async function clicarNoTitulo() {
  act(() => mostrarCartao(aviso, Date.now(), true));
  render(<PilhaDeCartoes />);
  await act(async () => { fireEvent.click(screen.getByText("Cliente X")); });
}

describe("PilhaDeCartoes — clique no cartão", () => {
  it("com a flag, clicar no cartão abre a conversa do aviso", async () => {
    mocks.flag = true;
    await clicarNoTitulo();
    expect(mocks.navigate).toHaveBeenCalledWith(LINK, { state: { abrirConversa: expect.any(Number) } });
  });

  it("sem a flag, clicar no cartão não faz nada (só o botão Abrir navega)", async () => {
    mocks.flag = false;
    await clicarNoTitulo();
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Abrir" })); });
    expect(mocks.navigate).toHaveBeenCalledWith(LINK);
  });

  it("com a flag, o X dispensa sem navegar", async () => {
    mocks.flag = true;
    act(() => mostrarCartao(aviso, Date.now(), true));
    render(<PilhaDeCartoes />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dispensar" })); });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
