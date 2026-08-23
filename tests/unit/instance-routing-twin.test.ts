// @vitest-environment node
/**
 * O PAINEL E O EXECUTOR CONTAM INSTÂNCIAS COM A MESMA REGRA — issues #1690 e #1700.
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
 *    perde a única declaração que salvaria o nó quando a fixa morre.
 *  - Se o painel contar MENOS, ele oferece "Número de saída" sem a opção que o
 *    executor aceitaria — o canal oficial fica inalcançável pela tela.
 *
 * O que o #1700 mudou aqui: o canal oficial deixou de ser só NOMEÁVEL e passou
 * a ser ESCOLHÍVEL. Os dois eixos do gêmeo mudaram de assunto:
 *
 *  - `isRoutableInstance` — o universo de TUDO (chips + canal oficial).
 *  - `isChipInstance` / `deadPinShortcut` — o recorte que sobrou, e que é o
 *    que mantém 63 nós de fixa morta enviando.
 */
import { describe, expect, it } from "vitest";

import {
  deadPinShortcut as frontShortcut,
  isChipInstance as frontChip,
  isRoutableInstance as frontRoutable,
} from "../../src/modules/workflows/lib/instance-routing";
import {
  LEGACY_PROVIDERS,
  ROUTABLE_PROVIDERS,
  deadPinShortcut as backShortcut,
  isChipInstance as backChip,
  isRoutableInstance as backRoutable,
} from "../../supabase/functions/_shared/instance-routing.ts";

type Caso = { nome: string; inst: Record<string, unknown>; roteavel: boolean; chip: boolean };

/** Todo cruzamento que produz veredito diferente entre os dois eixos. */
const CASOS: Caso[] = [
  { nome: "uazapi conectada", inst: { provider: "uazapi", status: "connected", session_dead_since: null }, roteavel: true, chip: true },
  { nome: "evolution em open", inst: { provider: "evolution", status: "open", session_dead_since: null }, roteavel: true, chip: true },
  { nome: "uazapi desconectada", inst: { provider: "uazapi", status: "disconnected", session_dead_since: null }, roteavel: false, chip: false },
  { nome: "uazapi com sessão morta", inst: { provider: "uazapi", status: "connected", session_dead_since: "2026-08-01T09:00:00Z" }, roteavel: false, chip: false },

  // O par que define o #1700: viva, roteável, e não é chip.
  { nome: "canal oficial vivo", inst: { provider: "notificame", status: "connected", session_dead_since: null }, roteavel: true, chip: false },
  { nome: "canal oficial desconectado", inst: { provider: "notificame", status: "disconnected", session_dead_since: null }, roteavel: false, chip: false },

  { nome: "meta_cloud vivo", inst: { provider: "meta_cloud", status: "connected", session_dead_since: null }, roteavel: false, chip: false },
  { nome: "provider desconhecido", inst: { provider: "carrier_pigeon", status: "connected", session_dead_since: null }, roteavel: false, chip: false },
  { nome: "provider ausente", inst: { status: "connected", session_dead_since: null }, roteavel: false, chip: false },
];

describe("roteabilidade: front e executor concordam", () => {
  it.each(CASOS)("$nome", ({ inst, roteavel }) => {
    expect(frontRoutable(inst)).toBe(roteavel);
    expect(backRoutable(inst)).toBe(roteavel);
  });
});

describe("o recorte de chip: front e executor concordam", () => {
  it.each(CASOS)("$nome", ({ inst, chip }) => {
    expect(frontChip(inst)).toBe(chip);
    expect(backChip(inst)).toBe(chip);
  });
});

/**
 * O atalho de fixa morta é o que mantém 63 nós ativos enviando (medido em
 * 2026-08-20, 9 organizações, nenhum com recuo declarado). O painel o consulta
 * para dizer "hoje o envio sai por X"; o executor o consulta para decidir de
 * fato. Uma divergência aqui faz o aviso mentir.
 */
describe("atalho de fixa morta: front e executor concordam", () => {
  const CHIP = { provider: "uazapi", status: "connected", session_dead_since: null, instance_name: "Carol" };
  const CHIP_2 = { ...CHIP, instance_name: "Comercial" };
  const OFICIAL = { provider: "notificame", status: "connected", session_dead_since: null, instance_name: "Chiquê" };

  const CENARIOS: Array<{ nome: string; vivas: Record<string, unknown>[]; esperado: string[] }> = [
    // A Chique, exatamente: 1 chip + 1 oficial, 18 nós de fixa morta.
    { nome: "chip e canal oficial → só o chip", vivas: [CHIP, OFICIAL], esperado: ["Carol"] },
    { nome: "só chip → o chip", vivas: [CHIP], esperado: ["Carol"] },
    // Sem chip nenhum o oficial é o único número que a organização tem.
    { nome: "só canal oficial → o oficial", vivas: [OFICIAL], esperado: ["Chiquê"] },
    // Dois chips: ambíguo, o atalho não dispara nos dois lados.
    { nome: "dois chips e oficial → ambíguo", vivas: [CHIP, CHIP_2, OFICIAL], esperado: ["Carol", "Comercial"] },
    { nome: "nenhuma viva → vazio", vivas: [], esperado: [] },
  ];

  it.each(CENARIOS)("$nome", ({ vivas, esperado }) => {
    const nomes = (l: Record<string, unknown>[]) => l.map((i) => String(i.instance_name));
    expect(nomes(frontShortcut(vivas))).toEqual(esperado);
    expect(nomes(backShortcut(vivas))).toEqual(esperado);
  });
});

describe("as duas listas do executor", () => {
  it("roteável é estritamente mais larga que chip, e só pelo canal oficial", () => {
    expect(ROUTABLE_PROVIDERS).toEqual([...LEGACY_PROVIDERS, "notificame"]);
  });

  // Se alguém fizer as duas iguais, o atalho de fixa morta passa a contar o
  // canal oficial — e os 63 nós medidos em 2026-08-20 param de enviar assim
  // que a org tiver um oficial ao lado do chip. Na Chique, hoje.
  it("as duas listas NÃO são a mesma", () => {
    expect(ROUTABLE_PROVIDERS).not.toEqual(LEGACY_PROVIDERS);
  });

  // O nó `send_to_number` passa esta lista como `providers`: números avulsos
  // nunca escreveram, a janela de 24h está fechada por definição, e o canal
  // oficial recusaria o texto livre por callback.
  it("a lista de chip não contém o canal oficial", () => {
    expect(LEGACY_PROVIDERS).not.toContain("notificame");
  });
});
