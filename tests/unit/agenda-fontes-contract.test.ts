import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

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
 * Estes testes leem a definição VERSIONADA mais recente e travam as duas.
 */

const MIG_DIR = resolve(__dirname, "../../supabase/migrations");

/**
 * Casa as duas grafias que existem no repo: a que a gente escreve à mão
 * (`public.get_agenda_events`) e a que o `pg_dump` do baseline gera
 * (`"public"."get_agenda_events"`). Ignorar a segunda deixaria um baseline
 * regenerado — que carrega a versão de 4 fontes — passar despercebido.
 */
const DEFINE_A_FUNCAO =
  /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+"?public"?\."?get_agenda_events"?/i;

/**
 * A migration mais recente que (re)define `get_agenda_events`. Descoberta por
 * varredura, não por nome fixo: assim o teste continua valendo para a próxima
 * pessoa que criar uma migration nova em cima desta.
 */
function definicaoVigente(): { arquivo: string; sql: string } {
  const candidatos = readdirSync(MIG_DIR)
    .filter((f) => /^\d{14}_.*\.sql$/.test(f))
    .filter((f) =>
      DEFINE_A_FUNCAO.test(
        readFileSync(resolve(MIG_DIR, f), "utf8"),
      ),
    )
    .sort();

  const arquivo = candidatos[candidatos.length - 1];
  return { arquivo, sql: readFileSync(resolve(MIG_DIR, arquivo), "utf8") };
}

describe("get_agenda_events — as 5 fontes estão versionadas", () => {
  const { arquivo, sql } = definicaoVigente();

  it("existe uma definição versionada da função", () => {
    expect(arquivo).toBeTruthy();
  });

  it.each([
    ["Source 1 · meetings", /FROM public\.meetings m\b/],
    ["Source 2 · follow_ups", /FROM public\.follow_ups fu\b/],
    ["Source 3 · scheduled_user_messages", /FROM public\.scheduled_user_messages sm\b/],
    ["Source 4 · pipe_confirmacao", /FROM public\.pipe_confirmacao pc\b/],
    ["Source 5 · meeting_events", /FROM public\.meeting_events e\b/],
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
    // é imutável.
    expect(sql).toMatch(/DISTINCT ON \(e\.lead_id, e\.meeting_date\)/);
    expect(sql).toMatch(/e\.source IS DISTINCT FROM 'pipeline:confirmacao'/);
    expect(sql).toMatch(/NOT LIKE 'backfill:%'/);
  });
});

describe("get_agenda_events — Source 1 não pode voltar a fazer fanout", () => {
  const { sql } = definicaoVigente();

  it("o join de team_members carrega o predicado de org", () => {
    // `tm.user_id = m.created_by` sozinho casa UMA LINHA POR ORG do criador.
    // O predicado de org é o que transforma isso em no máximo uma linha.
    expect(sql).toMatch(
      /ON tm\.user_id = m\.created_by\s*\n\s*AND tm\.organization_id = m\.organization_id/,
    );
  });

  it("nenhum join de team_members por user_id fica sem escopo de org", () => {
    // Varredura genérica: pega também um join novo que alguém acrescente
    // depois copiando o padrão errado.
    const semEscopo = sql
      .split(/\r?\n/)
      .map((linha, i) => [i + 1, linha] as const)
      .filter(([, linha]) => /\.user_id\s*=\s*\w+\.created_by/.test(linha))
      .filter(([n]) => {
        const proximas = sql.split(/\r?\n/).slice(n, n + 2).join("\n");
        return !/AND\s+\w+\.organization_id\s*=/.test(proximas);
      });

    expect(semEscopo.map(([n, l]) => `L${n}: ${l.trim()}`)).toEqual([]);
  });
});

describe("get_agenda_events — a versão nova não pode colidir nem regredir", () => {
  const { arquivo } = definicaoVigente();

  it("a definição vigente é a de maior versão entre TODAS as migrations", () => {
    // Se alguém adicionar uma migration com prefixo MENOR que redefine a
    // função, o replay em base limpa aplica a errada por último. Este teste
    // reprova a inversão de ordem antes de ela chegar ao banco.
    const versoes = readdirSync(MIG_DIR)
      .filter((f) => /^\d{14}_.*\.sql$/.test(f))
      .filter((f) =>
        DEFINE_A_FUNCAO.test(
          readFileSync(resolve(MIG_DIR, f), "utf8"),
        ),
      )
      .map((f) => f.slice(0, 14));

    expect(arquivo.slice(0, 14)).toBe([...versoes].sort().pop());
  });

  it("existe rollback para a definição vigente", () => {
    const rollback = readdirSync(resolve(MIG_DIR, "rollback"));
    expect(rollback).toContain(arquivo);
  });
});
