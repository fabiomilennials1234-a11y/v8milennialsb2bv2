/**
 * `escolherCaixaSemConversa` — a caixa em que o chat abre um lead que ainda
 * não tem mensagem, quando o link não diz qual (Chamado 52df972e).
 *
 * Antes: a 1ª caixa conectada de uma lista em ordem alfabética. Para admin, que
 * vê todas, era a caixa de outra vendedora — e o chat ainda a gravava como
 * preferida do usuário.
 *
 * Agora: a mesma ordem do seletor "Iniciar conversa por" (`prioridadeDaCaixa`),
 * depois conectada antes de caída, depois nome. A preferência vence o status,
 * como no seletor: abrir na própria caixa caída, com o aviso de desconectada,
 * é melhor que mandar em silêncio pelo número de outra pessoa.
 *
 * Só escolhe entre `instances` — a lista já recortada por org e por membro.
 * Sinal que aponta para fora dela é ignorado (defesa cross-tenant).
 */
import { prioridadeDaCaixa, type SinaisDeQuemAtende } from "./prioridadeDaCaixa";

export interface CaixaCandidata {
  id: string;
  instance_name: string;
  status: string;
}

/** Por que esta caixa — literal estável, também usado como marcador do deploy. */
export type MotivoCaixaSemConversa =
  | "sem-conversa:preferida"
  | "sem-conversa:minha-e-do-responsavel"
  | "sem-conversa:minha"
  | "sem-conversa:do-responsavel"
  | "sem-conversa:conectada"
  | "sem-conversa:primeira";

const MOTIVO_POR_PRIORIDADE: Record<number, MotivoCaixaSemConversa> = {
  0: "sem-conversa:preferida",
  1: "sem-conversa:minha-e-do-responsavel",
  2: "sem-conversa:minha",
  3: "sem-conversa:do-responsavel",
};

export function escolherCaixaSemConversa<T extends CaixaCandidata>({
  instances,
  ...sinais
}: { instances: ReadonlyArray<T> } & SinaisDeQuemAtende): { caixa: T; motivo: MotivoCaixaSemConversa } | null {
  const prioridade = prioridadeDaCaixa(sinais);
  const desconectada = (c: T) => (c.status === "connected" ? 0 : 1);

  const [caixa] = [...instances].sort(
    (a, b) =>
      prioridade(a.id) - prioridade(b.id) ||
      desconectada(a) - desconectada(b) ||
      a.instance_name.localeCompare(b.instance_name),
  );
  if (!caixa) return null;

  const motivo =
    MOTIVO_POR_PRIORIDADE[prioridade(caixa.id)] ??
    (caixa.status === "connected" ? "sem-conversa:conectada" : "sem-conversa:primeira");
  return { caixa, motivo };
}
