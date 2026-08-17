/**
 * O alias `/chat` → `/chat-whatsapp` precisa PRESERVAR a query string.
 *
 * Este teste existe por causa de um defeito real, achado só rodando o app
 * (validação ponta a ponta do mapa #1605):
 *
 *   <Route path="/chat" element={<Navigate to="/chat-whatsapp" replace />} />
 *
 * `<Navigate>` descarta `?a=b`. Consequência, em silêncio e sem erro nenhum:
 *
 *   - o seletor de Conversa do Lead abria na caixa ERRADA, porque `?instance=`
 *     morria no redirect e o ChatShell caía no auto-select;
 *   - o `?lead=` das três telas da carteira nunca chegava ao ChatShell — ou
 *     seja, a correção do #1614 estava inerte em produção.
 *
 * Nenhum teste de unidade vê um redirect de rota, e nenhum dos 30+ testes das
 * cinco fatias pegou isto. Este pega.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";

/** Réplica do helper de App.tsx — o comportamento sob teste. */
function NavigateComQuery({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
}

function Destino() {
  const { pathname, search } = useLocation();
  return <div data-testid="destino">{pathname + search}</div>;
}

function montar(url: string, elemento: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/chat" element={elemento} />
        <Route path="/chat-whatsapp" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("alias /chat → /chat-whatsapp", () => {
  it("preserva phone, instance e lead — os três que o seletor depende", () => {
    montar(
      "/chat?phone=5548991470458&instance=cx-2&lead=lead-1",
      <NavigateComQuery to="/chat-whatsapp" />,
    );

    expect(screen.getByTestId("destino").textContent).toBe(
      "/chat-whatsapp?phone=5548991470458&instance=cx-2&lead=lead-1",
    );
  });

  it("sem query, redireciona limpo", () => {
    montar("/chat", <NavigateComQuery to="/chat-whatsapp" />);
    expect(screen.getByTestId("destino").textContent).toBe("/chat-whatsapp");
  });

  it("CONTROLE NEGATIVO: o <Navigate> cru perde a query — é o defeito de origem", () => {
    // Sem este assert o teste acima poderia passar por acidente de setup.
    // Ele fixa QUAL comportamento estava errado, não só qual está certo.
    montar(
      "/chat?phone=5548991470458&instance=cx-2",
      <Navigate to="/chat-whatsapp" replace />,
    );

    expect(screen.getByTestId("destino").textContent).toBe("/chat-whatsapp");
  });
});
