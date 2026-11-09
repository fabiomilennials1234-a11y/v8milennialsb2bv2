/**
 * Visão MEU / TODOS (hotfix Café Jurerê, 09/11).
 *
 * O admin da org com a flag `visao_meu_todos` (`organizations.feature_flags`)
 * alterna Leads, Funis e o sino entre:
 *   - "meu": só o que é dele — leads em que é dono, negócios em que é o
 *     responsável, os avisos endereçados a ele;
 *   - "todos": a org inteira (o que ele já via antes da flag).
 *
 * Quem não é admin, ou está em org sem a flag, não vê o controle e a tela fica
 * exatamente como era. Puro de propósito: a regra se testa sem React.
 */

export const VISAO_MEU_TODOS_FLAG = "visao_meu_todos";

export type Visao = "meu" | "todos";

/** Onde o controle aparece. Cada tela lembra a própria escolha. */
export type SuperficieDaVisao = "leads" | "funis" | "avisos";

/**
 * Ligar a flag não pode mudar o que o admin já via. Em Leads e Funis ele já via
 * a org inteira ("todos"); no sino, só os avisos dele ("meu").
 */
export const VISAO_PADRAO: Record<SuperficieDaVisao, Visao> = {
  leads: "todos",
  funis: "todos",
  avisos: "meu",
};

export const OPCOES_DE_VISAO = [
  { value: "meu", label: "Meus" },
  { value: "todos", label: "Todos" },
] as const satisfies ReadonlyArray<{ value: Visao; label: string }>;

export function normalizarVisao(valor: unknown, padrao: Visao = "todos"): Visao {
  return valor === "meu" || valor === "todos" ? valor : padrao;
}

/**
 * O controle existe? Precisa das três coisas — e de um `team_members.id`, sem o
 * qual "meu" não teria a quem se referir (master entrando como sombra, por ex.).
 */
export function visaoDisponivel(input: {
  flag: boolean;
  isAdmin: boolean;
  teamMemberId: string | null | undefined;
}): boolean {
  return input.flag && input.isAdmin && !!input.teamMemberId;
}

/**
 * O `team_members.id` que a tela deve filtrar como dono/responsável, ou `null`
 * quando a tela segue o próprio filtro (visão indisponível ou "todos").
 */
export function donoForcadoPelaVisao(
  disponivel: boolean,
  visao: Visao,
  teamMemberId: string | null | undefined,
): string | null {
  return disponivel && visao === "meu" && teamMemberId ? teamMemberId : null;
}
