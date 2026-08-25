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
 * A migration mais recente que (re)define `get_agenda_events`. Descoberta por
 * varredura, não por nome fixo: assim o teste continua valendo para a próxima
 * pessoa que criar uma migration nova em cima desta.
 */
function definicaoVigente(): { arquivo: string; corpo: string } {
  const candidatos = migrations()
    .filter((f) => DEFINE_A_FUNCAO.test(ler(f)))
    .sort();

  const arquivo = candidatos[candidatos.length - 1];
  return { arquivo, corpo: corpoDaDefinicao(ler(arquivo)) };
}

describe("get_agenda_events — as 5 fontes estão versionadas", () => {
  const { arquivo, corpo } = definicaoVigente();
  const sql = norm(corpo);

  it("existe uma definição versionada da função", () => {
    expect(arquivo).toBeTruthy();
  });

  // MUTAÇÃO — os regexes fixavam a LETRA do alias (`meeting_events e`), então
  // renomear `e` para `ev`, um refactor sem efeito nenhum, deixava dois testes
  // vermelhos. Guarda que reprova refactor correto é guarda que alguém relaxa.
  it.each([
    ["Source 1 · meetings", /FROM public\.meetings \w+/i],
    ["Source 2 · follow_ups", /FROM public\.follow_ups \w+/i],
    ["Source 3 · scheduled_user_messages", /FROM public\.scheduled_user_messages \w+/i],
    ["Source 4 · pipe_confirmacao", /FROM public\.pipe_confirmacao \w+/i],
    ["Source 5 · meeting_events", /FROM public\.meeting_events \w+/i],
  ])("%s continua na definição vigente", (_nome, padrao) => {
    expect(sql).toMatch(padrao);
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

    const corpo = norm(
      corpoDaDefinicao(readFileSync(resolve(rollbackDir, arquivo), "utf8")),
    );

    expect(corpo).toMatch(/FROM public\.meetings \w+/i);
    expect(corpo).toMatch(/FROM public\.follow_ups \w+/i);
    expect(corpo).toMatch(/FROM public\.scheduled_user_messages \w+/i);
    expect(corpo).toMatch(/FROM public\.pipe_confirmacao \w+/i);
    expect(corpo).toMatch(/FROM public\.meeting_events \w+/i);
    expect(corpo.match(/\bUNION ALL\b/g) ?? []).toHaveLength(4);
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
  const { corpo } = definicaoVigente();

  /** Os literais de `'<x>'::text AS source` da definição vigente. */
  const fontesDoSql = [
    ...new Set(
      [...norm(corpo).matchAll(/'([a-z_]+)'::text AS source\b/gi)].map((m) => m[1]),
    ),
  ].sort();

  it("a definição vigente emite exatamente as 5 fontes conhecidas", () => {
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
