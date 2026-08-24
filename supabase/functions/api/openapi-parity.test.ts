import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { routes } from "./routes.ts";

/**
 * A especificação pública e o roteador declaram o MESMO conjunto de rotas.
 *
 * Antes deste teste, a paridade era coincidência bem mantida: elas batiam 12/12
 * porque alguém conferiu na mão uma vez. Bastou eu somar sete rotas para a doc
 * ficar descrevendo metade do que existe — e doc que descreve metade é pior que
 * doc nenhuma, porque quem lê acredita.
 *
 * Este teste falha nos DOIS sentidos, e os dois importam:
 *
 *   • rota no roteador e ausente da doc → quem integra não descobre que existe;
 *   • caminho na doc e ausente do roteador → quem integra chama e toma 404,
 *     depois de escrever o código inteiro.
 */

const ESPEC = new URL("../../../public/api/openapi.json", import.meta.url);

function daEspecificacao(): Set<string> {
  const spec = JSON.parse(Deno.readTextFileSync(ESPEC));
  const out = new Set<string>();
  for (const [caminho, ops] of Object.entries(spec.paths ?? {})) {
    for (const metodo of Object.keys(ops as Record<string, unknown>)) {
      if (["get", "post", "patch", "put", "delete"].includes(metodo)) {
        out.add(`${metodo.toUpperCase()} ${caminho}`);
      }
    }
  }
  return out;
}

function doRoteador(): Set<string> {
  return new Set(routes.map((r) => `${r.method} ${r.pattern}`));
}

Deno.test("openapi — toda rota do roteador está na especificação pública", () => {
  const faltando = [...doRoteador()].filter((r) => !daEspecificacao().has(r)).sort();
  assertEquals(faltando, [], `rotas sem documentação: ${faltando.join(", ")}`);
});

Deno.test("openapi — a especificação não promete rota que não existe", () => {
  const sobrando = [...daEspecificacao()].filter((r) => !doRoteador().has(r)).sort();
  assertEquals(sobrando, [], `documentadas e inexistentes: ${sobrando.join(", ")}`);
});

/**
 * A armadilha de vocabulário, e por que ela merece um teste.
 *
 * No Kommo, "lead" É o negócio — é o card que anda no funil. No Pipedrive,
 * "lead" é pré-negócio e "deal" é o que anda. Nós somos o Pipedrive: Lead é
 * pessoa, Negócio é o que anda.
 *
 * Quem chegar do Kommo vai chamar nosso Negócio de "lead" e modelar tudo errado
 * — e vai descobrir depois de escrever a integração. A frase na descrição é o
 * que evita isso, e o teste existe para ela não sumir numa edição distraída.
 */
Deno.test("openapi — a descrição avisa que Negócio é `deal`, e sobre o Kommo", () => {
  const spec = JSON.parse(Deno.readTextFileSync(ESPEC));
  const desc = String(spec.info?.description ?? "");

  assertEquals(/negócio/i.test(desc) && /\bdeal\b/i.test(desc), true, "falta a equivalência Negócio = deal");
  assertEquals(/kommo/i.test(desc), true, "falta o aviso sobre o vocabulário do Kommo");
});
