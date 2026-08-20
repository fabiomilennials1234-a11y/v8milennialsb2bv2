// @vitest-environment node
/**
 * O PAINEL E O EXECUTOR CONTAM INSTÂNCIAS COM A MESMA REGRA — issue #1690.
 *
 * A regra de quais Instances participam do roteamento existe duas vezes: no
 * front (`src/modules/workflows/lib/instance-routing.ts`, que desenha o
 * seletor) e no executor (`supabase/functions/_shared/instance-routing.ts`, que
 * escolhe o número). O front nunca importa de `supabase/functions`, e o padrão
 * do projeto para regra que dois runtimes precisam é DUPLICAR COM TESTE GÊMEO
 * — há quatro precedentes (`blast-planning-twin`, `stage-role-classifier-twin`,
 * `template-send-twin`, `notificame-template-buttons-twin`).
 *
 * ⚠️ POR QUE UMA DIVERGÊNCIA AQUI É CARA, e em duas direções opostas:
 *
 *  - Se o PAINEL contar MAIS que o executor, ele esconde o campo de recuo por
 *    achar que a org tem dois números, o executor vê um só, e o operador
 *    perde a única declaração que salvaria o nó quando o pin morre.
 *  - Se o painel contar MENOS, ele oferece "Número de saída" sem a opção que o
 *    executor aceitaria — o canal oficial fica inalcançável pela tela, que é
 *    exatamente o estado que o #1690 veio corrigir.
 *
 * Duas listas, dois predicados, e a diferença entre elas é o assunto do #1690:
 * o canal oficial é NOMEÁVEL (degrau 1) e não é ESCOLHÍVEL (degraus 2 a 4).
 */
import { describe, expect, it } from "vitest";

import {
  isPinnableInstance as frontPinnable,
  isRoutableInstance as frontRoutable,
} from "../../src/modules/workflows/lib/instance-routing";
import {
  LEGACY_PROVIDERS,
  PINNABLE_PROVIDERS,
  isRoutableInstance as backRoutable,
} from "../../supabase/functions/_shared/instance-routing.ts";

type Caso = { nome: string; inst: Record<string, unknown>; roteavel: boolean; nomeavel: boolean };

/** Todo cruzamento que produz veredito diferente entre os dois eixos. */
const CASOS: Caso[] = [
  { nome: "uazapi conectada", inst: { provider: "uazapi", status: "connected", session_dead_since: null }, roteavel: true, nomeavel: true },
  { nome: "evolution em open", inst: { provider: "evolution", status: "open", session_dead_since: null }, roteavel: true, nomeavel: true },
  { nome: "uazapi desconectada", inst: { provider: "uazapi", status: "disconnected", session_dead_since: null }, roteavel: false, nomeavel: false },
  { nome: "uazapi com sessão morta", inst: { provider: "uazapi", status: "connected", session_dead_since: "2026-08-01T09:00:00Z" }, roteavel: false, nomeavel: false },

  // O par que define o #1690: viva, nomeável, e fora dos degraus automáticos.
  { nome: "canal oficial vivo", inst: { provider: "notificame", status: "connected", session_dead_since: null }, roteavel: false, nomeavel: true },
  { nome: "canal oficial desconectado", inst: { provider: "notificame", status: "disconnected", session_dead_since: null }, roteavel: false, nomeavel: false },

  { nome: "meta_cloud vivo", inst: { provider: "meta_cloud", status: "connected", session_dead_since: null }, roteavel: false, nomeavel: false },
  { nome: "provider desconhecido", inst: { provider: "carrier_pigeon", status: "connected", session_dead_since: null }, roteavel: false, nomeavel: false },
  { nome: "provider ausente", inst: { status: "connected", session_dead_since: null }, roteavel: false, nomeavel: false },
];

describe("roteabilidade: front e executor concordam", () => {
  it.each(CASOS)("$nome", ({ inst, roteavel }) => {
    expect(frontRoutable(inst)).toBe(roteavel);
    expect(backRoutable(inst)).toBe(roteavel);
  });
});

describe("nomeabilidade: o front oferece o que o degrau 1 aceita", () => {
  it.each(CASOS)("$nome", ({ inst, nomeavel }) => {
    expect(frontPinnable(inst)).toBe(nomeavel);
    // O executor não expõe predicado de nomeabilidade — o degrau 1 é uma
    // consulta. O que o gêmeo prende é a LISTA que ela usa.
    const aceitoPeloDegrau1 =
      PINNABLE_PROVIDERS.includes(String(inst.provider)) &&
      ["connected", "open"].includes(String(inst.status)) &&
      inst.session_dead_since == null;
    expect(aceitoPeloDegrau1).toBe(nomeavel);
  });
});

describe("as duas listas do executor", () => {
  it("nomeável é estritamente mais larga que roteável, e só pelo canal oficial", () => {
    expect(PINNABLE_PROVIDERS).toEqual([...LEGACY_PROVIDERS, "notificame"]);
  });

  // Se alguém fizer as duas iguais, o atalho de "uma Instance viva só" passa a
  // contar o canal oficial — e os 63 nós de pin morto medidos em 2026-08-20
  // param de enviar assim que a org ganhar o segundo número.
  it("as duas listas NÃO são a mesma", () => {
    expect(PINNABLE_PROVIDERS).not.toEqual(LEGACY_PROVIDERS);
  });
});
