/**
 * O telefone da chamada, legível.
 *
 * Mora fora dos componentes por duas razões. A boba: exportar função de um
 * arquivo de componente quebra o Fast Refresh — a mesma razão que tirou
 * `callPhases` de dentro do provider. A que importa: os dois painéis de voz (o
 * da chamada que sai e o da que entra) mostram o mesmo número, e duas cópias de
 * uma formatação são duas cópias livres para divergir — foi assim que a ligação
 * que sai passou a aparecer como `(48) 9100-5289` e a que entra apareceria como
 * `554891005289`, sem nenhum defeito visível em lugar nenhum.
 */

/**
 * `554891005289` → `(48) 9100-5289`.
 *
 * NÃO valida e não normaliza — quem precisa disso é o casamento com o lead, e
 * ele usa `normalizePhone`. Aqui o trabalho é só deixar legível, e um número que
 * não caiba no formato brasileiro volta como veio: mostrar os dígitos crus é
 * pior que mostrar nada, mas mostrar um número mutilado é pior que os dois.
 */
export function formatPeerPhone(digits: string | null | undefined): string {
  if (!digits) return "";
  const local = digits.replace(/^55/, "");
  if (local.length < 10) return digits;
  const ddd = local.slice(0, 2);
  const resto = local.slice(2);
  return `(${ddd}) ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
}
