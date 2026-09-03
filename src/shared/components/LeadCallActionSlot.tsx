/**
 * O slot do botão de LIGAR para um lead — injetado pela raiz, consumido pelos
 * cards.
 *
 * ─── Por que um contexto em `shared`, e não um import ───────────────────────
 * Quem desenha o botão é `communication` (`VoiceCallButton`); quem precisa dele
 * é `leads` (Card do Lead, Card do Negócio). Mas o barrel de `communication` já
 * alcança o barrel de `leads` (ContextPanel, LinkLeadDialog, …): um import
 * estático de `leads` para `communication` fecharia um ciclo entre os dois
 * módulos — medido com o dep-cruiser em 2026-09-02: 47 arestas novas de
 * `no-circular`. Inversão de dependência é o remédio que o próprio
 * `.dependency-cruiser.cjs` prescreve: `leads` pede "o botão de ligar deste
 * lead" a um contrato neutro, e `App.tsx` — a raiz, que já monta os dois
 * módulos — é quem responde com o componente real.
 *
 * Sem provider (testes, `/preview.html`) o slot é `null` e o card simplesmente
 * não mostra o botão — que é exatamente o que ele faz sem número de voz.
 */
import { createContext, useContext, type ReactNode } from "react";

export interface LeadCallActionTarget {
  id: string;
  nome: string | null;
}

export type LeadCallActionRenderer = (lead: LeadCallActionTarget) => ReactNode;

const LeadCallActionContext = createContext<LeadCallActionRenderer | null>(null);

export const LeadCallActionProvider = LeadCallActionContext.Provider;

/** O renderizador do botão de ligar, ou `null` quando ninguém o forneceu. */
export function useLeadCallAction(): LeadCallActionRenderer | null {
  return useContext(LeadCallActionContext);
}
