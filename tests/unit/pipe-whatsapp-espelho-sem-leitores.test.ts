/**
 * SCRUM-202 — `leads.pipe_whatsapp` não tem mais leitor nem escritor no código
 * das edge functions.
 *
 * POR QUE UM TESTE ESTÁTICO, E NÃO COMPORTAMENTAL
 * ------------------------------------------------
 * O defeito que este arquivo trava não é de comportamento — hoje o código roda
 * certo com a coluna presente. Ele é de SOBREVIVÊNCIA ao `DROP COLUMN` da fatia
 * 3: um `.select(...)` que ainda pede a coluna vira
 * `column leads.pipe_whatsapp does not exist` vindo do PostgREST no dia do drop,
 * e derruba a query inteira — não só a variável que ninguém usava.
 *
 * E o formato do defeito é INVENTÁRIO, não lógica. O ticket nasceu dizendo
 * "8 sítios" e a varredura achou 10; a correção de um sítio nunca prova que não
 * há um décimo primeiro. Um caso por sítio não fecha isso: fecha o sítio. O que
 * fecha o inventário é uma asserção sobre a ÁRVORE, que reprova no dia em que
 * alguém acrescentar o próximo — inclusive por copiar um arquivo que já estava
 * limpo.
 *
 * O achado que motivou o arquivo: `_shared/workflow-action-handler.ts:85` ainda
 * pedia `pipe_whatsapp` no select de `leads` — e usava ZERO vezes. É a segunda
 * cópia de `resolveVariables`; a primeira
 * (`_shared/action-handlers/whatsapp-helpers.ts`) foi limpa quando o espelho
 * deixou de ser fonte da etapa, e esta ficou para trás por seis dias, invisível
 * porque a sobra não muda resultado nenhum até o drop.
 *
 * O QUE ESTE TESTE **NÃO** COBRE, dito explicitamente
 * ---------------------------------------------------
 *  • `src/` (frontend). Lá a coluna ainda é lida de propósito em
 *    `useWhatsAppFunnel` e `useAgentMetrics` enquanto a fatia 3 não chega — e
 *    incluir `src/` aqui produziria uma lista de exceções maior que a asserção.
 *    O gate do frontend é o SCRUM-222 (o DROP em si).
 *  • SQL. O gatilho-espelho `sync_pipeline_entry_to_lead_pipe_whatsapp` ESCREVE
 *    a coluna por desenho, e é ele quem morre junto com ela na fatia 3.
 *  • A view `pipe_whatsapp`, que é outro objeto: `.from("pipe_whatsapp")` lê a
 *    VIEW, não a coluna de `leads`. Confundir as duas foi o que inflou o
 *    inventário original; o filtro abaixo separa as duas por sintaxe.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const RAIZ_FUNCTIONS = join(process.cwd(), "supabase", "functions");

function arquivosTs(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    // `node_modules` e artefatos de cobertura não são código nosso.
    if (nome === "node_modules" || nome === ".coverage") continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosTs(caminho, acc);
    // `.test.ts` fora: a suíte que PROVA a ausência da coluna precisa escrever o
    // nome dela para afirmar que não está lá
    // (`action-handlers/whatsapp-helpers-estagio.test.ts` faz exatamente isso).
    // Um gate que reprova o teste que o documenta se autodestrói.
    else if (nome.endsWith(".ts") && !nome.endsWith(".d.ts") && !nome.endsWith(".test.ts")) acc.push(caminho);
  }
  return acc;
}

/**
 * Sítios onde o token aparece e NÃO é a coluna. Lista explícita, com motivo por
 * linha, em vez de regex esperta: a distinção view-vs-coluna é semântica, não
 * sintática, e foi justamente confundi-las que inflou o inventário original do
 * SCRUM-202. Quem acrescentar aqui tem que escrever por que — e isso aparece no
 * diff.
 */
const NAO_E_A_COLUNA: Record<string, string> = {
  "supabase/functions/_shared/copilot-v2/tool-executor.ts":
    'SYSTEM_PIPE_TABLE mapeia o funil para o nome da VIEW `pipe_whatsapp` (usada em `.from(table)`), não para a coluna de `leads`. A view é construída sobre `pipeline_entries` e sobrevive ao DROP COLUMN.',
};

/**
 * Uma linha "cita a coluna" quando tem o token `pipe_whatsapp` que NÃO é:
 *   • `pipe_whatsapp_entry` / `pipe_whatsapp_by_lead` — identificadores locais,
 *     nomes de chave de cache. O `[^_\w]` depois do token corta isso.
 *   • `.from("pipe_whatsapp")` — a VIEW homônima, outro objeto.
 *   • comentário (`//`, `*`) — os arquivos limpos carregam nota explicando a
 *     remoção, e a nota não pode reprovar o teste que ela documenta.
 */
function citaAColuna(linha: string): boolean {
  const semEspaco = linha.trimStart();
  if (semEspaco.startsWith("//") || semEspaco.startsWith("*") || semEspaco.startsWith("/*")) return false;
  if (/\.from\(\s*["'`]pipe_whatsapp["'`]\s*\)/.test(linha)) return false;
  return /pipe_whatsapp(?![_\w])/.test(linha);
}

describe("SCRUM-202 — o espelho `leads.pipe_whatsapp` não é mais lido nem escrito nas edge functions", () => {
  it("nenhum arquivo de supabase/functions cita a coluna fora de comentário", () => {
    const ofensores: string[] = [];

    for (const caminho of arquivosTs(RAIZ_FUNCTIONS)) {
      const rel = relative(process.cwd(), caminho).split(sep).join("/");
      if (rel in NAO_E_A_COLUNA) continue;
      const linhas = readFileSync(caminho, "utf8").split(/\r?\n/);
      linhas.forEach((linha, i) => {
        if (citaAColuna(linha)) {
          ofensores.push(`${rel}:${i + 1} → ${linha.trim().slice(0, 120)}`);
        }
      });
    }

    // A mensagem carrega o arquivo:linha porque quem for reprovado por isto
    // provavelmente está copiando um select de outro handler e não sabe que a
    // coluna morre na fatia 3.
    expect(
      ofensores,
      ofensores.length === 0
        ? ""
        : `Estes sítios ainda citam a coluna legada \`leads.pipe_whatsapp\`:\n  ${ofensores.join("\n  ")}\n\n` +
            "A etapa do funil WhatsApp vem do NEGÓCIO (`pipeline_entries.stage_key` via `getPipeEntry`/`getPipeEntriesByLeads`), " +
            "nunca do espelho — que CONGELA quando o negócio sai do funil por move (ADR-0023 §10). " +
            "E na fatia 3 a coluna é dropada: um select que ainda a pede derruba a query inteira com " +
            "`column leads.pipe_whatsapp does not exist`. Se você precisa da etapa, leia a entry. " +
            "Se a linha é a VIEW `pipe_whatsapp`, use `.from(\"pipe_whatsapp\")`, que este gate já ignora.",
    ).toEqual([]);
  });

  it("a varredura de fato enxerga os arquivos (o gate não passa por lista vazia)", () => {
    // Sem isto, um erro de caminho faria o caso acima passar sempre — verde por
    // não ter olhado, que é o modo de falha silenciosa de todo teste de árvore.
    const arquivos = arquivosTs(RAIZ_FUNCTIONS);
    expect(arquivos.length).toBeGreaterThan(200);
    expect(
      arquivos.some((c) => c.endsWith(join("_shared", "workflow-action-handler.ts"))),
      "o arquivo do achado original tem que estar no escopo da varredura",
    ).toBe(true);
  });
});
