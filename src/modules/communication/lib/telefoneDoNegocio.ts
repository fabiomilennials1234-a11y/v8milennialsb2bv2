/**
 * Com qual telefone se fala sobre ESTE negócio (Chamado 82c50502, ADR-0039).
 *
 * Regra (decisão do CTO, 07/10): o escolhido no negócio; senão, o único
 * telefone do lead; com 2+ e nenhum escolhido, PERGUNTA. Nunca chuta o
 * principal — chutar é como o vendedor acaba mandando a proposta do Compras
 * para o celular do sócio.
 */
export interface TelefoneOpcao {
  id: string;
  phone: string;
  label: string | null;
}

export type TelefoneDoNegocio<T extends TelefoneOpcao = TelefoneOpcao> =
  | { tipo: "escolhido"; telefone: T }
  | { tipo: "unico"; telefone: T }
  | { tipo: "precisaEscolher"; opcoes: T[] }
  | { tipo: "nenhum" };

export function telefoneDoNegocio<T extends TelefoneOpcao>({
  deal,
  phones,
}: {
  deal: { leadPhoneId: string | null | undefined } | null | undefined;
  phones: T[];
}): TelefoneDoNegocio<T> {
  const escolhido = deal?.leadPhoneId ? phones.find((p) => p.id === deal.leadPhoneId) : undefined;
  if (escolhido) return { tipo: "escolhido", telefone: escolhido };
  if (phones.length === 1) return { tipo: "unico", telefone: phones[0] };
  if (phones.length === 0) return { tipo: "nenhum" };
  // Escolhido que sumiu (apagado depois) também cai aqui: perguntar de novo.
  return { tipo: "precisaEscolher", opcoes: phones };
}

/** O número a usar, ou null quando é preciso perguntar (ou não há telefone). */
export function numeroDoNegocio(resolucao: TelefoneDoNegocio): string | null {
  return resolucao.tipo === "escolhido" || resolucao.tipo === "unico" ? resolucao.telefone.phone : null;
}
