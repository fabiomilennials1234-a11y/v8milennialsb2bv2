import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import {
  SOURCE_COLORS,
  SOURCE_LABELS,
} from "@/modules/engagement/components/agenda/agenda-helpers";

/**
 * Contrato das FONTES da Agenda (`public.get_agenda_events`).
 *
 * Esta função é reescrita inteira a cada mudança — é `CREATE OR REPLACE` de um
 * corpo de ~180 linhas. Quem mexe copia a versão anterior e edita. Duas coisas
 * já se perderam exatamente assim, e as duas só apareceram em produção:
 *
 *  1. A **Source 5** (`meeting_events`, o funil mergeado do ADR-0004/0007) foi
 *     aplicada à mão em 2026-07-30 e a migration ficou fora do repo por quase
 *     um mês. Nesse período, a última definição versionada tinha 4 fontes:
 *     qualquer `db push` teria apagado as reuniões do funil mergeado da Agenda.
 *
 *  2. O **predicado de org** no join de `team_members` da Source 1.
 *     `team_members.user_id` não é único (um master tem uma linha por org),
 *     então sem ele o LEFT JOIN faz fanout e a mesma reunião volta N vezes.
 *     Medido no PROD em 2026-08-24: fator 16x em 4 orgs.
 *
 * 🚨 A primeira versão deste arquivo passou por uma bateria de mutação e
 * **oito** delas ficaram VERDES. Um teste de guarda que não fica vermelho
 * quando deveria é pior que nenhum: ele documenta uma cobertura que não existe.
 * As correções estão marcadas com `MUTAÇÃO` ao longo do arquivo, cada uma
 * nomeando o buraco concreto que fecha.
 */

const MIG_DIR = resolve(__dirname, "../../supabase/migrations");

/**
 * Casa as três grafias possíveis do nome: a que a gente escreve à mão
 * (`public.get_agenda_events`), a que o `pg_dump` do baseline gera
 * (`"public"."get_agenda_events"`) e a não-qualificada.
 *
 * MUTAÇÃO — sem a lookahead negativa no fim, o nome casava por PREFIXO: uma
 * migration de versão maior definindo `get_agenda_events_v2` virava "a
 * definição vigente" e o guarda passava a auditar a função ERRADA, deixando as
 * duas regressões acima voltarem com o CI verde. Medido: cópia byte-a-byte
 * desta migration com o nome trocado para `_v2` → 17 testes verdes.
 *
 * MUTAÇÃO — o `public.` era obrigatório, então um CREATE sem qualificar o
 * schema escapava da varredura inteira. Aqui ele é opcional; o nome é único no
 * banco (1 linha em `pg_proc`), então isso não gera falso positivo.
 */
const NOME = `"?public"?\\.)?"?get_agenda_events"?(?![A-Za-z0-9_])`;
const DEFINE_A_FUNCAO = new RegExp(
  `CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(${NOME}`,
  "i",
);

/**
 * Qualquer TOQUE na função, não só a definição.
 *
 * MUTAÇÃO — uma migration de versão maior contendo apenas
 * `DROP FUNCTION IF EXISTS public.get_agenda_events(...)` era INVISÍVEL: a
 * varredura só olhava `CREATE`, então a nossa continuava sendo "a vigente" e o
 * teste passava verde com a função apagada no replay. Não é hipótese remota —
 * há 19 `DROP FUNCTION` nas migrations deste repo, e trocar as colunas do
 * `RETURNS TABLE` OBRIGA drop+create (Postgres 42P13).
 */
const TOCA_A_FUNCAO = new RegExp(
  `(CREATE\\s+(OR\\s+REPLACE\\s+)?|DROP\\s+)FUNCTION\\s+(IF\\s+EXISTS\\s+)?(${NOME}`,
  "i",
);

function migrations(): string[] {
  return readdirSync(MIG_DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f));
}

function ler(arquivo: string): string {
  return readFileSync(resolve(MIG_DIR, arquivo), "utf8");
}

/**
 * O CORPO da função, sem comentários.
 *
 * MUTAÇÃO — este é o buraco mais perverso dos oito. As asserções rodavam sobre
 * o ARQUIVO INTEIRO, e o idioma desta base é documentar generosamente: esta
 * migration tem ~90 linhas de cabeçalho. Uma migration que REMOVE a Source 5 e
 * explica honestamente no comentário o que removeu — citando
 * `FROM public.meeting_events e` na prosa — passava verde. O teste lia a
 * documentação da remoção como prova de que nada foi removido.
 *
 * Recorta do `CREATE` até o fechamento do dollar-quote que abre o corpo, e
 * remove `--` até o fim da linha. (Uma string SQL que contivesse `--` seria
 * mutilada; não há nenhuma nesta função, e a alternativa — um parser de SQL —
 * não se paga aqui.)
 */
function corpoDaDefinicao(sql: string): string {
  const m = DEFINE_A_FUNCAO.exec(sql);
  const resto = sql.slice(m ? m.index : 0);
  const abre = /\$(\w*)\$/.exec(resto);
  if (!abre) return semComentarios(resto);
  const tag = abre[0];
  const fim = resto.indexOf(tag, abre.index + tag.length);
  const corpo =
    fim === -1
      ? resto.slice(abre.index + tag.length)
      : resto.slice(abre.index + tag.length, fim);
  return semComentarios(corpo);
}

function semComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, " ");
}

/** Espaço em branco colapsado — o SQL é a semântica, a formatação não é. */
function norm(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

/**
 * A ASSINATURA: do `CREATE` até o dollar-quote que abre o corpo. É onde mora o
 * `RETURNS TABLE(...)`, que o `corpoDaDefinicao` deixa de fora de propósito.
 */
function assinaturaDaDefinicao(sql: string): string {
  const m = DEFINE_A_FUNCAO.exec(sql);
  const resto = sql.slice(m ? m.index : 0);
  const abre = /\$(\w*)\$/.exec(resto);
  return semComentarios(abre ? resto.slice(0, abre.index) : resto);
}

/**
 * ═══ LEITURA ESTRUTURAL DO SQL ════════════════════════════════════════════
 *
 * Este bloco existe por causa de uma regressão CONCRETA do próprio guarda.
 *
 * A versão anterior lia as fontes por `'([a-z_]+)'::text AS source`. Em
 * 2026-09-03 a migration da SCRUM-647 fatia 2 capturou os corpos de prod com
 * `pg_get_functiondef` — e o Postgres NÃO devolve apelido de coluna em função
 * `RETURNS TABLE`, porque ali o nome da coluna vem da assinatura, não do
 * SELECT. O corpo ficou correto, o comportamento ficou provado idêntico, e o
 * guarda ficou vermelho por um detalhe COSMÉTICO — devolvendo `[]`, que é a
 * pior forma de vermelho: a próxima pessoa afrouxa o regex (basta tirar o
 * `AS source` do padrão para casar `'task'::text` e `'completed'` também) e o
 * arquivo passa a jurar que audita 5 fontes enquanto audita ruído.
 *
 * Este repo captura corpo de prod — é o idioma dele. Um contrato ancorado num
 * apelido que o round-trip do Postgres apaga estava condenado a reincidir.
 *
 * A âncora certa é ESTRUTURAL, e é mais forte que o apelido jamais foi:
 * `source` é a 2ª coluna do `RETURNS TABLE` (lido da assinatura, não fixado),
 * e cada ramo da união tem que pôr um LITERAL nessa posição. Some um ramo,
 * some a fonte. Trocam a ordem da assinatura, o teste segue a assinatura.
 * E `'task'::text` (posição 8) nunca é confundido com fonte, porque a posição
 * é conferida, não o texto.
 */

/**
 * Divide por vírgulas de PROFUNDIDADE ZERO. `COALESCE(l4.name, 'Reuniao')` é
 * UM elemento, não dois. (Parênteses dentro de string literal quebrariam a
 * contagem; não há nenhum nesta função nem no rollback dela.)
 */
function listaTopo(s: string): string[] {
  const partes: string[] = [];
  let profundidade = 0;
  let atual = "";
  for (const ch of s) {
    if (ch === "(") profundidade++;
    else if (ch === ")") profundidade--;
    else if (ch === "," && profundidade === 0) {
      partes.push(atual);
      atual = "";
      continue;
    }
    atual += ch;
  }
  partes.push(atual);
  return partes.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Os nomes das colunas do `RETURNS TABLE`, na ordem declarada. */
function colunasDoReturnsTable(assinatura: string): string[] {
  const s = norm(assinatura);
  const abre = /RETURNS\s+TABLE\s*\(/i.exec(s);
  if (!abre) return [];
  const inicio = abre.index + abre[0].length;
  let profundidade = 1;
  let i = inicio;
  for (; i < s.length && profundidade > 0; i++) {
    if (s[i] === "(") profundidade++;
    else if (s[i] === ")") profundidade--;
  }
  return listaTopo(s.slice(inicio, i - 1)).map((c) => c.split(/\s+/)[0]);
}

/**
 * Os ramos da união de topo. O `UNION ALL` dentro de subquery (não há hoje,
 * mas o dedup da Source 5 já é uma subquery) não parte ramo: só conta o de
 * profundidade zero.
 */
function ramosDaUniao(sqlNormalizado: string): string[] {
  const ramos: string[] = [];
  let profundidade = 0;
  let inicio = 0;
  for (let i = 0; i < sqlNormalizado.length; i++) {
    const ch = sqlNormalizado[i];
    if (ch === "(") profundidade++;
    else if (ch === ")") profundidade--;
    else if (
      profundidade === 0 &&
      /^UNION ALL\b/i.test(sqlNormalizado.slice(i, i + 10))
    ) {
      ramos.push(sqlNormalizado.slice(inicio, i));
      i += "UNION ALL".length - 1;
      inicio = i + 1;
    }
  }
  ramos.push(sqlNormalizado.slice(inicio));
  return ramos.map((r) => r.trim()).filter((r) => r.length > 0);
}

/** Índice, no ramo, da palavra-chave dada em profundidade zero. */
function posicaoDeTopo(ramo: string, palavra: string, apartirDe = 0): number {
  let profundidade = 0;
  const re = new RegExp(`^${palavra}\\b`, "i");
  for (let i = 0; i < ramo.length; i++) {
    const ch = ramo[i];
    if (ch === "(") profundidade++;
    else if (ch === ")") profundidade--;
    else if (
      profundidade === 0 &&
      i >= apartirDe &&
      re.test(ramo.slice(i, i + palavra.length + 1))
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * A expressão que o ramo põe na coluna `source`, sem o apelido.
 *
 * Aceita as DUAS grafias — `'x'::text` (o que o Postgres devolve) e
 * `'x'::text AS source` (o que a gente escreve à mão) — porque as duas dizem
 * a mesma coisa e nenhuma das duas é o contrato. O contrato é a posição.
 *
 * `null` quando a posição não carrega um literal: isso é falha, não "não sei".
 * O front faz `SOURCE_LABELS[event.source]`; fonte que não é literal fixo é
 * rótulo que ninguém consegue declarar.
 */
function fonteDoRamo(ramo: string, indiceDeSource: number): string | null {
  const select = posicaoDeTopo(ramo, "SELECT");
  if (select === -1) return null;
  const from = posicaoDeTopo(ramo, "FROM", select + 6);
  if (from === -1) return null;

  const colunas = listaTopo(ramo.slice(select + "SELECT".length, from));
  const expr = colunas[indiceDeSource];
  if (!expr) return null;

  const m = /^'([a-z_]+)'(?:::text)?(?:\s+AS\s+source)?$/i.exec(expr.trim());
  return m ? m[1] : null;
}

/** A relação de entrada do ramo: o `FROM public.<relação> <alias>` de topo. */
function entradaDoRamo(ramo: string): { relacao: string; alias: string } | null {
  const select = posicaoDeTopo(ramo, "SELECT");
  const from = posicaoDeTopo(ramo, "FROM", (select === -1 ? 0 : select) + 6);
  if (from === -1) return null;
  const m = /^FROM\s+public\.(\w+)\s+(\w+)\b/i.exec(ramo.slice(from));
  return m ? { relacao: m[1], alias: m[2] } : null;
}

/**
 * ═══ A CONFIRMAÇÃO, LIDA DE DUAS RELAÇÕES DIFERENTES ══════════════════════
 *
 * A Source 4 lia `public.pipe_confirmacao` — a view de compat. A SCRUM-647
 * fatia 2 a fez ler `public.negocio_projetado`, a projeção canônica, que
 * carrega TODOS os funis. A view já embutia o recorte no nome; a projeção não:
 * ali o recorte é o predicado `funil_sistema = 'confirmacao'`.
 *
 * Ou seja: a troca de relação transferiu para o PREDICADO uma garantia que
 * antes vinha de graça. Ler `negocio_projetado` sem ele não some com nada —
 * faz PIOR: derrama proposta e qualificação na Agenda como se fossem reunião
 * marcada. Por isso o par é conferido junto, e no ESCOPO DO RAMO: a Source 5
 * também cita `funil_sistema = 'confirmacao'` (no seu anti-duplicata), e uma
 * varredura de corpo inteiro leria o predicado do vizinho como se fosse deste.
 */
const RELACOES_DA_CONFIRMACAO = ["pipe_confirmacao", "negocio_projetado"];

function leiturasDaProjecaoSemFiltroDeFunil(corpoNorm: string): string[] {
  const problemas: string[] = [];

  for (const ramo of ramosDaUniao(corpoNorm)) {
    const re = /\bpublic\.negocio_projetado\s+(\w+)\b/gi;
    for (const m of ramo.matchAll(re)) {
      const alias = m[1];
      const temFiltro = new RegExp(
        `\\b${alias}\\.funil_sistema\\s*=\\s*'confirmacao'`,
        "i",
      ).test(ramo);
      if (!temFiltro) {
        problemas.push(
          `negocio_projetado ${alias}: sem \`${alias}.funil_sistema = 'confirmacao'\` no mesmo ramo`,
        );
      }
    }
  }
  return problemas;
}

/** O ramo que emite a fonte pedida, ou `undefined`. */
function ramoQueEmite(
  corpoNorm: string,
  fonte: string,
  indiceDeSource: number,
): string | undefined {
  return ramosDaUniao(corpoNorm).find(
    (r) => fonteDoRamo(r, indiceDeSource) === fonte,
  );
}

/**
 * A migration mais recente que (re)define `get_agenda_events`. Descoberta por
 * varredura, não por nome fixo: assim o teste continua valendo para a próxima
 * pessoa que criar uma migration nova em cima desta.
 */
function definicaoVigente(): {
  arquivo: string;
  corpo: string;
  indiceDeSource: number;
} {
  const candidatos = migrations()
    .filter((f) => DEFINE_A_FUNCAO.test(ler(f)))
    .sort();

  const arquivo = candidatos[candidatos.length - 1];
  const texto = ler(arquivo);
  return {
    arquivo,
    corpo: corpoDaDefinicao(texto),
    indiceDeSource: colunasDoReturnsTable(assinaturaDaDefinicao(texto)).indexOf(
      "source",
    ),
  };
}

describe("get_agenda_events — as 5 fontes estão versionadas", () => {
  const { arquivo, corpo, indiceDeSource } = definicaoVigente();
  const sql = norm(corpo);

  it("existe uma definição versionada da função", () => {
    expect(arquivo).toBeTruthy();
  });

  it("a assinatura declara a coluna `source` (âncora de tudo que vem abaixo)", () => {
    // Controle positivo do parser: `indiceDeSource === -1` faria toda leitura
    // de fonte devolver `null`, e "nenhuma fonte encontrada" viraria vermelho
    // sem causa legível — ou, pior, verde num `filter` mais adiante.
    expect(indiceDeSource).toBeGreaterThanOrEqual(0);
  });

  // MUTAÇÃO — os regexes fixavam a LETRA do alias (`meeting_events e`), então
  // renomear `e` para `ev`, um refactor sem efeito nenhum, deixava dois testes
  // vermelhos. Guarda que reprova refactor correto é guarda que alguém relaxa.
  it.each([
    ["Source 1 · meetings", /FROM public\.meetings \w+/i],
    ["Source 2 · follow_ups", /FROM public\.follow_ups \w+/i],
    ["Source 3 · scheduled_user_messages", /FROM public\.scheduled_user_messages \w+/i],
    ["Source 5 · meeting_events", /FROM public\.meeting_events \w+/i],
  ])("%s continua na definição vigente", (_nome, padrao) => {
    expect(sql).toMatch(padrao);
  });

  // A Source 4 não entra na lista acima porque a relação dela deixou de ser
  // fixa: pode ser a view de compat OU a projeção canônica. O que NÃO pode
  // variar é o recorte — ver o bloco `RELACOES_DA_CONFIRMACAO`.
  it("Source 4 · a confirmação sai de uma relação conhecida", () => {
    const ramo = ramoQueEmite(sql, "pipe_confirmacao", indiceDeSource);
    expect(ramo, "nenhum ramo emite 'pipe_confirmacao'").toBeTruthy();

    const entrada = entradaDoRamo(ramo!);
    expect(entrada, "ramo da Source 4 sem `FROM public.<relação> <alias>`").toBeTruthy();
    expect(RELACOES_DA_CONFIRMACAO).toContain(entrada!.relacao);
  });

  it("Source 4 · ler a projeção canônica exige o filtro de funil", () => {
    // Sem `funil_sistema = 'confirmacao'`, `negocio_projetado` traz proposta e
    // qualificação junto: a Agenda mostra funil errado como reunião marcada.
    expect(leiturasDaProjecaoSemFiltroDeFunil(sql)).toEqual([]);
  });

  it("são 5 blocos unidos — 4 UNION ALL", () => {
    // Contagem explícita: perder uma fonte pelo caminho é o erro que este
    // arquivo inteiro existe para impedir, e ele não dá erro em lugar nenhum —
    // some evento da tela e pronto.
    const unions = sql.match(/\bUNION ALL\b/g) ?? [];
    expect(unions).toHaveLength(4);
  });

  it("a Source 5 mantém o dedup que evita reunião fantasma", () => {
    // Sem estes três, o funil mergeado duplica o que a Source 4 já mostra —
    // e mostra a data ANTIGA de uma reunião remarcada, porque meeting_events
    // é imutável. O alias é LIDO do próprio SQL, não fixado.
    //
    // A âncora é o DISTINCT ON, não o `FROM public.meeting_events`: a função
    // varre `meeting_events` DUAS vezes (a segunda é o EXISTS correlacionado
    // que decide `held_status`), e casar o primeiro FROM pega a subquery
    // errada. Partir do dedup garante que é o alias da fonte, e de quebra
    // prova que o dedup existe antes de usar seu alias.
    const m = /SELECT DISTINCT ON \((\w+)\.lead_id, \1\.meeting_date\)/i.exec(sql);
    expect(m, "dedup `DISTINCT ON (<alias>.lead_id, <alias>.meeting_date)` não encontrado").toBeTruthy();
    const alias = m![1];

    expect(sql).toMatch(new RegExp(`FROM public\\.meeting_events ${alias}\\b`, "i"));
    expect(sql).toContain(`${alias}.source IS DISTINCT FROM 'pipeline:confirmacao'`);
    expect(sql).toMatch(/NOT LIKE 'backfill:%'/);
  });
});

/**
 * Os controles negativos da leitura estrutural.
 *
 * A leitura por posição é mais forte que a por apelido, mas ela também pode
 * estar QUEBRADA e devolver verde — foi assim que oito mutações passaram na
 * primeira versão deste arquivo. Aqui cada asserção de cima é forçada a ficar
 * vermelha contra um SQL construído com o defeito dentro.
 */
describe("a leitura estrutural fica vermelha quando o defeito existe", () => {
  const COLUNAS = "RETURNS TABLE(id uuid, source text, title text)";
  const I = colunasDoReturnsTable(COLUNAS).indexOf("source");

  const source4 = (from: string) =>
    norm(`SELECT pc.id, 'pipe_confirmacao'::text, COALESCE(l4.name, 'Reuniao')
          FROM ${from}
          LEFT JOIN public.leads l4 ON l4.id = pc.lead_id
          WHERE pc.organization_id = p_organization_id
            AND pc.meeting_date IS NOT NULL`);

  it("acha a coluna `source` na assinatura", () => {
    expect(I).toBe(1);
    expect(colunasDoReturnsTable(COLUNAS)).toEqual(["id", "source", "title"]);
  });

  it("lê a fonte pela posição, com ou sem o apelido `AS source`", () => {
    // As duas grafias existem no repo: as migrations escritas à mão têm o
    // apelido, os corpos capturados de prod com `pg_get_functiondef` não —
    // função `RETURNS TABLE` não precisa dele. As duas são a MESMA função.
    expect(fonteDoRamo(source4("public.pipe_confirmacao pc"), I)).toBe("pipe_confirmacao");
    expect(
      fonteDoRamo(
        norm("SELECT pc.id, 'pipe_confirmacao'::text AS source, x FROM public.pipe_confirmacao pc"),
        I,
      ),
    ).toBe("pipe_confirmacao");
  });

  it("não confunde literal de OUTRA coluna com fonte", () => {
    // O regex antigo, afrouxado para casar sem o apelido, colheria `'task'` e
    // `'completed'` como se fossem fontes da Agenda. A posição não colhe.
    const ramo = norm(
      `SELECT sm.id, 'scheduled_message'::text, 'task'::text, 'completed'
       FROM public.scheduled_user_messages sm`,
    );
    expect(fonteDoRamo(ramo, I)).toBe("scheduled_message");
    expect(fonteDoRamo(ramo, 2)).toBe("task");
  });

  // 🚨 A REGRESSÃO QUE ESTE BLOCO EXISTE PARA IMPEDIR.
  it("reprova a Source 4 lendo a projeção canônica SEM o filtro de funil", () => {
    const comFiltro = source4(
      "public.negocio_projetado pc WHERE pc.funil_sistema = 'confirmacao' AND",
    );
    const semFiltro = source4("public.negocio_projetado pc");

    expect(leiturasDaProjecaoSemFiltroDeFunil(semFiltro)).toHaveLength(1);
    expect(leiturasDaProjecaoSemFiltroDeFunil(comFiltro)).toEqual([]);
  });

  it("não aceita o filtro do ramo VIZINHO como se fosse o da Source 4", () => {
    // Defeito realista e invisível numa varredura de corpo inteiro: a Source 5
    // tem o predicado no seu anti-duplicata, então o corpo inteiro CONTÉM
    // `funil_sistema = 'confirmacao'` mesmo com a Source 4 sem filtro nenhum.
    const corpo = norm(`${source4("public.negocio_projetado pc")}
      UNION ALL
      SELECT me.id, 'meeting_event'::text, x
      FROM public.meeting_events me
      WHERE NOT EXISTS (
        SELECT 1 FROM public.negocio_projetado pc2
         WHERE pc2.funil_sistema = 'confirmacao' AND pc2.lead_id = me.lead_id
      )`);

    expect(corpo).toContain("funil_sistema = 'confirmacao'");
    expect(leiturasDaProjecaoSemFiltroDeFunil(corpo)).toHaveLength(1);
  });

  it("parte os ramos pelo UNION ALL de TOPO, não pelo de dentro de subquery", () => {
    const doisRamos = norm(
      `SELECT a FROM t1 UNION ALL SELECT b FROM (SELECT c UNION ALL SELECT d) s`,
    );
    expect(ramosDaUniao(doisRamos)).toHaveLength(2);
  });

  it("lê a relação de entrada mesmo com subquery na lista do SELECT", () => {
    const ramo = norm(
      `SELECT me.id, 'meeting_event'::text, (SELECT 1 FROM public.outra o)
       FROM public.meeting_events me LEFT JOIN public.leads l5 ON l5.id = me.lead_id`,
    );
    expect(entradaDoRamo(ramo)).toEqual({ relacao: "meeting_events", alias: "me" });
  });
});

/**
 * Todo join de `team_members` por `user_id` precisa de escopo de org.
 *
 * MUTAÇÃO — a versão anterior tinha um teste que fixava o texto EXATO do join
 * (`ON tm.user_id = m.created_by\n AND tm.organization_id = …`) e uma
 * "varredura genérica" que casava só `\.user_id\s*=\s*\w+\.created_by`. As duas
 * eram cegas para o MESMO defeito escrito ao contrário
 * (`ON m.created_by = tm.user_id`) e o teste de texto exato ficava vermelho com
 * o join escrito numa linha só — que é justamente o formato que o `pg_dump` do
 * baseline usa. Aqui a varredura é por BLOCO e por ALIAS: pega as duas ordens,
 * qualquer coluna do outro lado, e qualquer join novo que alguém acrescente.
 */
function joinsDeTeamMembersSemEscopo(sqlNormalizado: string): string[] {
  const FIM_DO_BLOCO =
    /\s(?:LEFT JOIN|RIGHT JOIN|INNER JOIN|CROSS JOIN|JOIN|WHERE|ORDER BY|GROUP BY|UNION|LIMIT)\s/i;

  const encontrados: string[] = [];
  const re = /(?:LEFT |RIGHT |INNER |)JOIN public\.team_members (\w+) ON /gi;

  for (const m of sqlNormalizado.matchAll(re)) {
    const alias = m[1];
    const depois = sqlNormalizado.slice(m.index + m[0].length);
    const corte = FIM_DO_BLOCO.exec(depois);
    const bloco = corte ? depois.slice(0, corte.index) : depois;

    // Gatilho: o join casa por `user_id`, que NÃO é único em team_members.
    // Join por `<alias>.id` é PK e nunca fez fanout.
    const porUserId = new RegExp(`\\b${alias}\\.user_id\\b`).test(bloco);
    if (!porUserId) continue;

    const temEscopo = new RegExp(`\\b${alias}\\.organization_id\\s*=`).test(bloco);
    if (!temEscopo) encontrados.push(`${alias}: ${bloco.trim()}`);
  }
  return encontrados;
}

describe("get_agenda_events — Source 1 não pode voltar a fazer fanout", () => {
  const { corpo } = definicaoVigente();
  const sql = norm(corpo);

  it("existe pelo menos um join de team_members por user_id (controle positivo)", () => {
    // "0 joins sem escopo" é ambíguo: significa "todos escopados" E TAMBÉM
    // "não li join nenhum". Sem este controle, um regex quebrado passa verde.
    expect(sql).toMatch(/JOIN public\.team_members \w+ ON /i);
    expect(sql).toMatch(/\w+\.user_id\b/);
  });

  it("nenhum join de team_members por user_id fica sem escopo de org", () => {
    expect(joinsDeTeamMembersSemEscopo(sql)).toEqual([]);
  });

  it("a varredura acha o defeito quando ele existe (controle negativo)", () => {
    // Prova que o teste acima pode ficar vermelho. As duas grafias do mesmo
    // defeito — a ordem natural e a invertida — têm que ser pegas.
    const semEscopo =
      "SELECT 1 FROM public.meetings m LEFT JOIN public.team_members tm ON tm.user_id = m.created_by WHERE 1 = 1";
    const invertido =
      "SELECT 1 FROM public.meetings m LEFT JOIN public.team_members tm ON m.created_by = tm.user_id WHERE 1 = 1";

    expect(joinsDeTeamMembersSemEscopo(semEscopo)).toHaveLength(1);
    expect(joinsDeTeamMembersSemEscopo(invertido)).toHaveLength(1);
  });
});

describe("get_agenda_events — a versão nova não pode colidir nem regredir", () => {
  const { arquivo } = definicaoVigente();

  it("nenhuma migration de versão maior TOCA a função", () => {
    // MUTAÇÃO — o teste anterior comparava a maior versão entre os candidatos
    // com o candidato escolhido, que `definicaoVigente()` já elege por
    // `sort().pop()`. Era tautológico: 500 mil sorteios, zero contra-exemplos.
    // Não podia ficar vermelho nunca, e anunciava cobertura de uma inversão de
    // ordem que não estava travada.
    //
    // O que importa de verdade é o ÚLTIMO evento do replay: se um `DROP` ou um
    // `CREATE` de versão maior vier depois, é ele que decide o estado final.
    const tocam = migrations()
      .filter((f) => TOCA_A_FUNCAO.test(ler(f)))
      .sort();

    expect(tocam[tocam.length - 1]).toBe(arquivo);
  });

  it("existe rollback, e ele restaura as 5 fontes — não só o nome do arquivo", () => {
    // MUTAÇÃO — o teste anterior só checava a presença do NOME na listagem.
    // Rollback truncado para 0 bytes: verde. Rollback com a definição de 4
    // FONTES — que é exatamente o que o cabeçalho dele diz que NÃO se deve
    // fazer, porque apagaria a Source 5 do PROD: verde também. É o artefato que
    // se usa sob pressão, em incidente; checar o nome não é checar nada.
    const rollbackDir = resolve(MIG_DIR, "rollback");
    expect(readdirSync(rollbackDir)).toContain(arquivo);

    const texto = readFileSync(resolve(rollbackDir, arquivo), "utf8");
    const corpo = norm(corpoDaDefinicao(texto));
    const iSource = colunasDoReturnsTable(assinaturaDaDefinicao(texto)).indexOf("source");

    expect(corpo).toMatch(/FROM public\.meetings \w+/i);
    expect(corpo).toMatch(/FROM public\.follow_ups \w+/i);
    expect(corpo).toMatch(/FROM public\.scheduled_user_messages \w+/i);
    expect(corpo).toMatch(/FROM public\.meeting_events \w+/i);
    expect(corpo.match(/\bUNION ALL\b/g) ?? []).toHaveLength(4);

    // A Source 4 do rollback passa pela MESMA porta da definição vigente: o
    // rollback pode voltar para a view de compat (é o que ele faz hoje) ou
    // parar numa versão que já lia a projeção — e nesse caso o filtro de funil
    // continua obrigatório. Rollback é o artefato de incidente; ele não pode
    // ser a porta dos fundos por onde o funil errado volta para a Agenda.
    expect(iSource).toBeGreaterThanOrEqual(0);
    const ramo4 = ramoQueEmite(corpo, "pipe_confirmacao", iSource);
    expect(ramo4, "rollback sem ramo que emite 'pipe_confirmacao'").toBeTruthy();
    expect(RELACOES_DA_CONFIRMACAO).toContain(entradaDoRamo(ramo4!)!.relacao);
    expect(leiturasDaProjecaoSemFiltroDeFunil(corpo)).toEqual([]);
  });
});

/**
 * A METADE DE CIMA do contrato — e a que faltava.
 *
 * Travar as 5 fontes no SQL não impede o defeito que a Source 5 realmente
 * produziu na tela. `normalizeAgendaEvents` faz `e.source as EventSource`: um
 * cast cego. Quando a Source 5 entrou no PROD em 30/07/2026, o banco passou a
 * devolver `'meeting_event'`, a união `EventSource` não conhecia esse valor,
 * `SOURCE_LABELS['meeting_event']` deu `undefined` e os três lugares que leem o
 * mapa caem em `?? event.source` — então a Agenda imprimiu o identificador cru
 * **"meeting_event"** para o usuário por quase um mês. Zero erro, zero tipo
 * vermelho, zero teste: o cast comeu o sinal e o `??` comeu o resto.
 *
 * Estes testes comparam as duas camadas DIRETAMENTE, lendo os literais que o
 * SQL emite. Uma Source 6 amanhã reprova aqui antes de virar palavra em inglês
 * no meio da tela.
 */
describe("as fontes do SQL e as do front dizem a mesma coisa", () => {
  const { corpo, indiceDeSource } = definicaoVigente();

  /**
   * O literal que cada ramo põe na coluna `source` — lido pela POSIÇÃO
   * declarada no `RETURNS TABLE`, não pelo apelido `AS source`. Ver o bloco
   * "LEITURA ESTRUTURAL DO SQL" lá em cima: o apelido é cosmético e o
   * `pg_get_functiondef` o apaga; a posição é o contrato.
   */
  const porRamo = ramosDaUniao(norm(corpo)).map((r) =>
    fonteDoRamo(r, indiceDeSource),
  );
  const fontesDoSql = [...new Set(porRamo.filter((f): f is string => !!f))].sort();

  it("todo ramo da união declara uma fonte literal", () => {
    // `null` aqui é ramo cuja coluna `source` não é literal fixo — e o front
    // indexa `SOURCE_LABELS[event.source]`. Sem literal não há rótulo possível.
    // É também o alarme se o parser se perder: 5 ramos, 5 fontes, sempre.
    expect(porRamo.filter((f) => f === null)).toEqual([]);
    expect(porRamo).toHaveLength(5);
  });

  it("a definição vigente emite exatamente as 5 fontes conhecidas", () => {
    // `pipe_confirmacao` continua sendo o LITERAL emitido mesmo agora que o
    // ramo lê `negocio_projetado`: é o valor que o front recebe, tem rótulo e
    // cor próprios, e trocá-lo quebraria a Agenda de quem já está aberto. A
    // relação lida mudou; o nome da fonte, não.
    expect(fontesDoSql).toEqual([
      "follow_up",
      "meeting",
      "meeting_event",
      "pipe_confirmacao",
      "scheduled_message",
    ]);
  });

  it("toda fonte que o SQL emite tem rótulo em pt-BR", () => {
    // Sem rótulo, o fallback `?? event.source` imprime o identificador cru.
    const semRotulo = fontesDoSql.filter((f) => !SOURCE_LABELS[f]);
    expect(semRotulo).toEqual([]);
  });

  it("nenhum rótulo é o próprio identificador (o fallback disfarçado)", () => {
    // Preencher `meeting_event: "meeting_event"` calaria o teste acima sem
    // consertar nada. Rótulo é texto para humano.
    for (const f of fontesDoSql) {
      expect(SOURCE_LABELS[f], f).not.toBe(f);
    }
  });

  it("toda fonte que o SQL emite tem cor própria no mapa", () => {
    const semCor = fontesDoSql.filter((f) => !SOURCE_COLORS[f]);
    expect(semCor).toEqual([]);
  });

  it("o tipo EventSource cobre as fontes do SQL mais o overlay do Google", () => {
    // O cast de `normalizeAgendaEvents` é cego; a união é a única declaração de
    // intenção que sobra. Ela é lida do arquivo porque type não existe em
    // runtime — e ler o arquivo é justamente o que pega a união defasada.
    const fonte = readFileSync(
      resolve(__dirname, "../../src/modules/engagement/components/agenda/agenda-helpers.ts"),
      "utf8",
    );
    const bloco = fonte.match(/export type EventSource\s*=([\s\S]*?);/);
    expect(bloco, "declaração de EventSource não encontrada").toBeTruthy();

    const daUniao = [...bloco![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(daUniao).toEqual([...fontesDoSql, "google"].sort());
  });
});
