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
 *  • LEITURA em `src/` (frontend). Lá a coluna ainda é lida de propósito em
 *    `useAgentMetrics` enquanto a fatia 3 não chega — e varrer leitura no
 *    frontend produziria uma lista de exceções maior que a asserção (a coluna
 *    aparece em tipo gerado, em mapa de config indexado por nome de funil e em
 *    chave de cache, nenhum dos três sendo a coluna). O gate da leitura no
 *    frontend é o SCRUM-222 (o DROP em si).
 *
 *    ESCRITA em `src/`, porém, ESTÁ coberta — segundo bloco deste arquivo.
 *    Escrita não tem a ambiguidade da leitura: ou a linha manda `pipe_whatsapp`
 *    dentro de um `update`/`insert` em `leads`, ou não manda. E escrita é a
 *    metade que faz dano ANTES do drop, não depois: desde a `20270803000040` o
 *    espelho não acompanha o move, então quem escreve a coluna na mão pode
 *    deixá-la afirmando uma etapa que a entry não confirma — e é o espelho que
 *    a lista lê. Leitura sobrante só quebra no dia do drop; escrita sobrante
 *    mente hoje.
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

const RAIZ_SRC = join(process.cwd(), "src");

/**
 * Acha `.from("leads")` e devolve o trecho até o fim do primeiro
 * `.update(...)` / `.insert(...)` / `.upsert(...)` que venha depois.
 *
 * A varredura é sobre o TEXTO do arquivo, não linha a linha, porque o payload
 * costuma estar quebrado em várias linhas — e um gate que só olha uma linha por
 * vez não enxerga justamente a forma mais comum de escrever isso.
 *
 * A janela é limitada porque `.from("leads")` também abre SELECT, e sem teto um
 * arquivo grande casaria com um `update` de outra tabela dez funções abaixo.
 */
function escritasEmLeads(fonte: string): string[] {
  const trechos: string[] = [];
  const abertura = /\.from\(\s*["'`]leads["'`]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = abertura.exec(fonte)) !== null) {
    const janela = fonte.slice(m.index, m.index + 600);
    const escrita = /\.(update|insert|upsert)\(([\s\S]{0,400}?)\)\s*(\.|;|$)/.exec(janela);
    if (escrita) trechos.push(escrita[2]);
  }
  return trechos;
}

function arquivosFonte(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules") continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosFonte(caminho, acc);
    else if (/\.(ts|tsx)$/.test(nome) && !nome.endsWith(".d.ts") && !/\.test\.tsx?$/.test(nome)) acc.push(caminho);
  }
  return acc;
}

describe("SCRUM-202 — nenhum código do frontend ESCREVE o espelho `leads.pipe_whatsapp`", () => {
  it("nenhum update/insert em `leads` carrega a coluna no payload", () => {
    const ofensores: string[] = [];

    for (const caminho of arquivosFonte(RAIZ_SRC)) {
      const rel = relative(process.cwd(), caminho).split(sep).join("/");
      // O tipo gerado do Supabase espelha o schema por definição: enquanto a
      // coluna existir no banco ela aparece ali, e não é escrita de ninguém.
      if (rel === "src/integrations/supabase/types.ts") continue;

      for (const payload of escritasEmLeads(readFileSync(caminho, "utf8"))) {
        if (/pipe_whatsapp(?![_\w])\s*:/.test(payload)) {
          ofensores.push(`${rel} → ${payload.replace(/\s+/g, " ").trim().slice(0, 120)}`);
        }
      }
    }

    expect(
      ofensores,
      ofensores.length === 0
        ? ""
        : `Estes sítios do frontend ESCREVEM a coluna legada \`leads.pipe_whatsapp\`:\n  ${ofensores.join("\n  ")}\n\n` +
            "Quem alimenta a coluna é o gatilho `sync_pipeline_entry_to_lead_pipe_whatsapp`, no write da ENTRY. " +
            "Escrever direto em `leads` duplica a fonte e desde a `20270803000040` pode divergir dela — o espelho " +
            "não acompanha o move, então a coluna passa a afirmar uma etapa que a entry não confirma. " +
            "Para mudar a etapa do funil WhatsApp, escreva a entry (a view `pipe_whatsapp`, ou a RPC `mover_negocio`).",
    ).toEqual([]);
  });

  it("a varredura enxerga o frontend e reconhece a forma que ela procura", () => {
    const arquivos = arquivosFonte(RAIZ_SRC);
    expect(arquivos.length).toBeGreaterThan(500);

    // Prova que o casador pega a forma real do defeito — a linha que este mesmo
    // commit removeu de `useCustomPipelines`. Sem isto o gate poderia passar por
    // não casar com nada, que é como um teste de árvore morre em silêncio.
    const amostra = `await supabase.from("leads").update({ pipe_whatsapp: targetStageKey }).eq("id", data.lead_id);`;
    expect(escritasEmLeads(amostra).some((p) => /pipe_whatsapp\s*:/.test(p))).toBe(true);

    // E que não confunde a VIEW homônima com a coluna.
    const view = `await supabase.from("pipe_whatsapp").update({ status: targetStageKey }).eq("id", existing.id);`;
    expect(escritasEmLeads(view)).toEqual([]);
  });
});
