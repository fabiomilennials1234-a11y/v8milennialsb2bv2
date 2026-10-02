/**
 * Comando V5 — duas regras novas que a tela passa a depender.
 *
 * 1. "Minha central" só ESTREITA. O admin alterna entre a visão da equipe e a
 *    dele; a troca nunca pode dar a um membro a visão da equipe, e não vale para
 *    quem não tem `team_member` real (master/gestor com id virtual — ADR-0021),
 *    que não teria o que filtrar e veria a fila vazia.
 * 2. A espera é curta e exata ("6 min", "1 h 35 min", "3 dias") e marca como
 *    longa a partir de uma hora — é o que pinta a linha de vermelho.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

const identityRef = {
  current: { isAdmin: true, teamMemberId: "tm-1", userId: "u-1", isReady: true },
};

vi.mock("@/modules/identity", () => ({
  useIdentity: () => identityRef.current,
  isVirtualTeamMember: (id: string | null) => !!id && id.startsWith("master-virtual-"),
}));

import { ComandoVisaoProvider, useComandoScope, type ComandoVisao } from "@/modules/analytics/hooks/useComandoScope";
import { esperaCurta } from "@/modules/analytics/components/dashboard/v2/CardConversasAguardando";

function escopoCom(visao: ComandoVisao | null) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ComandoVisaoProvider value={visao}>{children}</ComandoVisaoProvider>
  );
  return renderHook(() => useComandoScope(), { wrapper }).result.current;
}

describe("useComandoScope — visão do Comando", () => {
  it("admin sem escolha vê a equipe", () => {
    identityRef.current = { isAdmin: true, teamMemberId: "tm-1", userId: "u-1", isReady: true };
    const s = escopoCom(null);
    expect(s.isAdmin).toBe(true);
    expect(s.escopo).toBe("tudo");
  });

  it("admin em 'Minha central' vê como membro", () => {
    identityRef.current = { isAdmin: true, teamMemberId: "tm-1", userId: "u-1", isReady: true };
    const s = escopoCom("minha");
    expect(s.isAdmin).toBe(false);
    expect(s.escopo).toBe("meu");
  });

  it("membro nunca ganha a visão da equipe, nem pedindo", () => {
    identityRef.current = { isAdmin: false, teamMemberId: "tm-2", userId: "u-2", isReady: true };
    const s = escopoCom("equipe");
    expect(s.isAdmin).toBe(false);
    expect(s.escopo).toBe("meu");
  });

  it("master com id virtual ignora 'minha' — não há o que filtrar", () => {
    identityRef.current = { isAdmin: true, teamMemberId: "master-virtual-u9", userId: "u-9", isReady: true };
    const s = escopoCom("minha");
    expect(s.isAdmin).toBe(true);
    expect(s.escopo).toBe("tudo");
    expect(s.meuTeamMemberId).toBeNull();
  });
});

describe("esperaCurta", () => {
  const agora = new Date("2026-10-02T15:00:00Z").getTime();
  const ha = (min: number) => new Date(agora - min * 60_000).toISOString();

  it("minutos abaixo de uma hora, sem alarme", () => {
    expect(esperaCurta(ha(6), agora)).toMatchObject({ texto: "6 min", longa: false });
  });

  it("horas e minutos a partir de uma hora, marcada como longa", () => {
    expect(esperaCurta(ha(95), agora)).toMatchObject({ texto: "1 h 35 min", valor: "1", unidade: "h 35 min", longa: true });
  });

  it("hora cheia não mostra '0 min'", () => {
    expect(esperaCurta(ha(120), agora)).toMatchObject({ texto: "2 h" });
  });

  it("dias a partir de 24 h, no singular e no plural", () => {
    expect(esperaCurta(ha(60 * 24), agora)).toMatchObject({ texto: "1 dia" });
    expect(esperaCurta(ha(60 * 24 * 3 + 10), agora)).toMatchObject({ texto: "3 dias" });
  });

  it("sem data ou data inválida não inventa número", () => {
    expect(esperaCurta(null, agora)).toBeNull();
    expect(esperaCurta("não é data", agora)).toBeNull();
  });
});
