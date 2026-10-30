/**
 * Pulso de saúde do worker: a última vez que o banco respondeu (alimenta o HEALTHCHECK do container).
 */
import type { Banco } from "./db.ts";

/**
 * Embrulha o banco para saber a última vez que ele respondeu. O pulso só é renovado enquanto isso for
 * recente: processo vivo que não alcança o banco (chave revogada, rede fora, banco em swap) NÃO é
 * saudável, e o orquestrador precisa ver isso para reiniciar e alertar.
 *
 * Embrulha TODOS os métodos do banco, não uma lista escrita à mão: método novo na interface (como `varrer`,
 * ADR-0046) que ficasse de fora chegaria ao executor como "is not a function" e derrubaria a busca em produção.
 */
export function comPulso(banco: Banco, agora: () => number = Date.now): { banco: Banco; ultimoContatoMs: () => number } {
  let ultimo = agora();
  const embrulhado: Record<string, unknown> = {};
  for (const [nome, f] of Object.entries(banco)) {
    embrulhado[nome] = async (...a: unknown[]) => {
      const r = await (f as (...x: unknown[]) => Promise<unknown>).apply(banco, a);
      ultimo = agora();
      return r;
    };
  }
  return { ultimoContatoMs: () => ultimo, banco: embrulhado as unknown as Banco };
}
