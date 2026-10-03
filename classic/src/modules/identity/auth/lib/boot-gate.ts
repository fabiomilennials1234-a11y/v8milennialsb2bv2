/**
 * Boot gate — decide para onde um usuário logado é enviado na rota raiz `/`.
 *
 * Ordem de precedência (ADR-0021 §5): **Master → Gestor → membro**.
 * - Master mantém o app operacional (`/dashboard`); ele acessa a área master
 *   manualmente via `/master`. Master nunca cai na Área do Gestor.
 * - Gestor de Portfólio ativo (e não-master) entra na Área do Gestor (`/gestor`).
 * - Membro comum entra no app (`/dashboard`).
 *
 * Função pura — todo o estado vem por parâmetro, sem hooks. Isola a lógica de
 * ordenação (a parte load-bearing) para teste unitário sem renderização.
 */

export interface BootState {
  /** Sessão Supabase ainda carregando. */
  authLoading: boolean;
  /** Existe usuário autenticado. */
  hasUser: boolean;
  /** Gates de ator (master + gestor) ainda resolvendo. */
  gateLoading: boolean;
  isMaster: boolean;
  isGestor: boolean;
}

export type BootDecision =
  | { kind: "loading" }
  | { kind: "landing" }
  | { kind: "redirect"; to: string };

export function resolveBootRedirect(state: BootState): BootDecision {
  if (state.authLoading) return { kind: "loading" };
  if (!state.hasUser) return { kind: "landing" };
  // Usuário existe: esperar os gates de ator antes de decidir o destino,
  // senão um gestor pisca no /dashboard antes de ser reconhecido.
  if (state.gateLoading) return { kind: "loading" };

  // Ordem master → gestor → membro.
  if (state.isMaster) return { kind: "redirect", to: "/dashboard" };
  if (state.isGestor) return { kind: "redirect", to: "/gestor" };
  return { kind: "redirect", to: "/dashboard" };
}
