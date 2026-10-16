/**
 * Quando a consulta do sino roda sozinha, sem ninguém pedir.
 *
 * O canal realtime de `notifications` é o mecanismo de entrega: cada INSERT ou
 * UPDATE já entra no cache por `setQueryData`. A consulta periódica é só rede
 * de segurança, e rede de segurança com canal saudável é custo sem retorno —
 * em 16/10 eram 81,5 consultas por minuto ao pool do PostgREST (8,5% do tempo
 * do banco), a maioria de abas com o canal de pé.
 *
 * Regras:
 *   - canal `joined` → sonda lenta de 5 min. `postgres_changes` pode descartar
 *     evento mesmo com o canal de pé, e o sino é o único caminho de entrega do
 *     Aviso: a sonda limita esse silêncio a 5 min (10× menos consultas que os
 *     30 s de antes). O que o canal perder com a aba escondida volta pela
 *     consulta ao retornar à aba (ver `useAvisos`, `refetchOnWindowFocus`);
 *   - qualquer outro estado (entrando, em erro, circuito aberto) → 30 s,
 *     a mesma rede de antes, só que agora apenas quando ela é necessária;
 *   - aba escondida nunca consulta: quem decide é `refetchIntervalInBackground`.
 *
 * Função pura para o teste não precisar de relógio nem de canal.
 */

import type { ChannelState } from "@/shared/realtime/useRealtimeChannel";

/** Rede de segurança com o canal fora do ar. */
export const REDE_DE_SEGURANCA_MS = 30_000;

/** Sonda com o canal de pé — cobre evento descartado sem queda visível. */
export const SONDA_COM_CANAL_SAUDAVEL_MS = 300_000;

export function intervaloDaRedeDeSeguranca(
  entregar: boolean,
  estadoDoCanal: ChannelState,
): number | false {
  if (!entregar) return false;
  return estadoDoCanal === "joined" ? SONDA_COM_CANAL_SAUDAVEL_MS : REDE_DE_SEGURANCA_MS;
}
