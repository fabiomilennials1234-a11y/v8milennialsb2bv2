// carga-por-minuto.mjs — quantos jobs do pg_cron disparam em cada minuto.
//
// Por que existe: em 2026-10-02 12:40:00 UTC ~30 jobs dispararam no mesmo
// segundo e o banco de prod (max_connections=90) bateu `too many clients`.
// Cada `invoke_*` faz net.http_post para uma edge function, que abre conexão
// de volta via PostgREST/pooler — o custo real de um disparo é uma conexão.
// Este módulo mede a coincidência (disparos por minuto) para que o
// reescalonamento seja provado por número, não por olho.
//
// Escopo do parser: os cinco campos do cron, com `*`, `a`, `a-b`, `*/n`,
// `a-b/n` e listas `x,y`. Dia do mês e mês precisam ser `*` (nenhum job de
// prod usa outra coisa); o parser recusa em vez de calcular errado.
// Também recusa a sintaxe de segundos do pg_cron ('30 seconds').
//
// Uso (CLI):
//   node scripts/cron/carga-por-minuto.mjs \
//     scripts/cron/prod-snapshot-2026-10-02.json \
//     supabase/migrations/<arquivo>.sql
// Imprime a tabela antes/depois por job e a carga por minuto (0..59).

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MINUTOS_NA_SEMANA = 7 * 24 * 60;

/** Expande um campo do cron em um Set de inteiros dentro de [min, max]. */
export function expandirCampo(campo, min, max) {
  const valores = new Set();
  for (const parte of campo.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(parte);
    if (!m) throw new Error(`Campo de cron não suportado: "${campo}"`);
    const [, faixa, passoTxt] = m;
    const passo = passoTxt === undefined ? 1 : Number(passoTxt);
    if (passo < 1) throw new Error(`Passo inválido em "${campo}"`);
    let inicio;
    let fim;
    if (faixa === '*') {
      inicio = min;
      fim = max;
    } else if (faixa.includes('-')) {
      [inicio, fim] = faixa.split('-').map(Number);
    } else {
      inicio = Number(faixa);
      // `5/10` em cron vixie significa "de 5 até o fim, de 10 em 10".
      fim = passoTxt === undefined ? inicio : max;
    }
    if (inicio < min || fim > max || inicio > fim) {
      throw new Error(`Faixa fora de [${min},${max}] em "${campo}"`);
    }
    for (let v = inicio; v <= fim; v += passo) valores.add(v);
  }
  return valores;
}

/**
 * Agenda → descrição normalizada. `porMinuto` é true quando o job dispara em
 * todo minuto de toda hora de todo dia: esses não têm fase a escolher.
 */
export function analisarAgenda(agenda) {
  const campos = agenda.trim().split(/\s+/);
  if (campos.length !== 5) throw new Error(`Agenda não é cron de 5 campos: "${agenda}"`);
  const [min, hora, diaMes, mes, diaSemana] = campos;
  if (diaMes !== '*' || mes !== '*') {
    throw new Error(`Dia do mês/mês diferentes de * não suportados: "${agenda}"`);
  }
  const minutos = expandirCampo(min, 0, 59);
  const horas = expandirCampo(hora, 0, 23);
  // 7 é domingo em alguns crons; normaliza para 0.
  const dias = new Set([...expandirCampo(diaSemana, 0, 7)].map((d) => d % 7));
  return {
    minutos,
    horas,
    dias,
    porMinuto: minutos.size === 60 && horas.size === 24 && dias.size === 7,
  };
}

/** Índices (0..10079) dos minutos da semana em que a agenda dispara. Domingo 00:00 = 0. */
export function disparosNaSemana(agenda) {
  const { minutos, horas, dias } = analisarAgenda(agenda);
  const out = [];
  for (const d of [...dias].sort((a, b) => a - b)) {
    for (const h of [...horas].sort((a, b) => a - b)) {
      for (const m of [...minutos].sort((a, b) => a - b)) out.push(d * 1440 + h * 60 + m);
    }
  }
  return out;
}

/**
 * Carga por minuto da semana: quantos jobs NÃO-por-minuto disparam em cada um
 * dos 10.080 minutos. Os `* * * * *` somam a mesma constante em todo minuto e
 * não têm fase a escolher; ficam fora para que o número meça só o que o
 * escalonamento controla (são reportados à parte).
 */
export function cargaSemanal(jobs) {
  const carga = new Uint16Array(MINUTOS_NA_SEMANA);
  for (const job of jobs) {
    if (analisarAgenda(job.schedule).porMinuto) continue;
    for (const t of disparosNaSemana(job.schedule)) carga[t] += 1;
  }
  return carga;
}

/** Pico da carga em cada minuto-da-hora (0..59), olhando a semana inteira. */
export function picoPorMinutoDaHora(carga) {
  const pico = new Array(60).fill(0);
  for (let t = 0; t < carga.length; t += 1) pico[t % 60] = Math.max(pico[t % 60], carga[t]);
  return pico;
}

/** Carga numa hora "comum" (terça 14h, hora par): sem diários, mostra o padrão recorrente. */
export function cargaHoraComum(carga) {
  const base = 2 * 1440 + 14 * 60;
  return Array.from(carga.slice(base, base + 60));
}

/** Disparos por semana — a frequência. Reescalonar não pode mudá-la. */
export function frequenciaSemanal(agenda) {
  return disparosNaSemana(agenda).length;
}

/**
 * Lê o bloco VALUES da migration de reescalonamento: tuplas
 * ('jobname', 'agenda antes', 'agenda depois'). Contrato de formato: uma tupla
 * por linha, entre os marcadores `-- reescalonamento:inicio` e
 * `-- reescalonamento:fim`. Devolve Map jobname → { antes, depois }.
 */
export function lerReescalonamento(sql) {
  const m = /--\s*reescalonamento:inicio([\s\S]*?)--\s*reescalonamento:fim/.exec(sql);
  if (!m) throw new Error('Marcadores -- reescalonamento:inicio/fim ausentes na migration');
  const pares = new Map();
  const re = /\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g;
  let t;
  while ((t = re.exec(m[1])) !== null) {
    if (pares.has(t[1])) throw new Error(`Job repetido na migration: ${t[1]}`);
    pares.set(t[1], { antes: t[2], depois: t[3] });
  }
  if (pares.size === 0) throw new Error('Nenhuma tupla de reescalonamento encontrada');
  return pares;
}

/**
 * Jobs agendados por migrations POSTERIORES a `arquivoBase` (ordem lexical =
 * ordem de versão): cada `cron.schedule('nome', 'agenda', ...)` vira
 * { arquivo, jobname, schedule }. O snapshot de prod não conhece job criado
 * depois dele; sem isto os contratos de carga ficam verdes por ausência.
 * `cron.alter_job` não é lido — mudança de agenda por alter_job precisa ser
 * declarada à mão no contrato que depende dela.
 */
export function lerAgendadosDepois(dirMigrations, arquivoBase) {
  return readdirSync(dirMigrations)
    .filter((f) => f.endsWith('.sql') && arquivoBase !== undefined && f > arquivoBase)
    .flatMap((f) =>
      [...readFileSync(path.join(dirMigrations, f), 'utf8').matchAll(
        /cron\.schedule\(\s*'([^']+)'\s*,\s*'([^']+)'/g,
      )].map(([, jobname, schedule]) => ({ arquivo: f, jobname, schedule })),
    );
}

/** Aplica o reescalonamento sobre o snapshot, sem mutar a entrada. */
export function aplicar(jobs, reescalonamento) {
  return jobs.map((j) =>
    reescalonamento.has(j.jobname) ? { ...j, schedule: reescalonamento.get(j.jobname).depois } : j,
  );
}

function resumo(carga) {
  const pico = Math.max(...carga);
  const minutosNoPico = carga.reduce((n, c) => n + (c === pico ? 1 : 0), 0);
  return { pico, minutosNoPico };
}

/** Relatório em Markdown: antes/depois por job + carga por minuto-da-hora. */
export function relatorio(jobs, reescalonamento) {
  const depois = aplicar(jobs, reescalonamento);
  const porMinuto = jobs.filter((j) => analisarAgenda(j.schedule).porMinuto).length;
  const cA = cargaSemanal(jobs);
  const cD = cargaSemanal(depois);
  const hA = cargaHoraComum(cA);
  const hD = cargaHoraComum(cD);
  const pA = picoPorMinutoDaHora(cA);
  const pD = picoPorMinutoDaHora(cD);
  const rA = resumo(cA);
  const rD = resumo(cD);
  const linhas = [];
  linhas.push('### Jobs reescalonados');
  linhas.push('');
  linhas.push('| jobid | jobname | antes | depois | s médio |');
  linhas.push('|---:|---|---|---|---:|');
  for (const j of jobs) {
    if (!reescalonamento.has(j.jobname)) continue;
    linhas.push(
      `| ${j.jobid} | ${j.jobname} | \`${j.schedule}\` | \`${reescalonamento.get(j.jobname).depois}\` | ${j.avgSeconds ?? '-'} |`,
    );
  }
  linhas.push('');
  linhas.push(`Jobs \`* * * * *\` (fora da conta, +${porMinuto} em todo minuto): ${porMinuto}`);
  linhas.push('');
  linhas.push('### Disparos não-por-minuto por minuto-da-hora');
  linhas.push('');
  linhas.push('`hora comum` = terça 14:00–14:59 (sem diários; hora par, inclui toth-sync-cobrancas). `pico semana` = máximo daquele minuto em qualquer hora da semana (inclui diários e semanais).');
  linhas.push('');
  linhas.push('| min | hora comum antes | hora comum depois | pico semana antes | pico semana depois |');
  linhas.push('|---:|---:|---:|---:|---:|');
  for (let m = 0; m < 60; m += 1) linhas.push(`| ${m} | ${hA[m]} | ${hD[m]} | ${pA[m]} | ${pD[m]} |`);
  linhas.push('');
  linhas.push(
    `**Pico na semana (não-por-minuto):** antes ${rA.pico} (${rA.minutosNoPico} minutos da semana no pico) → depois ${rD.pico} (${rD.minutosNoPico} minutos).`,
  );
  linhas.push(
    `**Pico com os ${porMinuto} por-minuto somados:** antes ${rA.pico + porMinuto} → depois ${rD.pico + porMinuto}.`,
  );
  return linhas.join('\n');
}

const executadoDireto = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (executadoDireto) {
  const [snapshotPath, migrationPath] = process.argv.slice(2);
  if (!snapshotPath || !migrationPath) {
    console.error('uso: node scripts/cron/carga-por-minuto.mjs <snapshot.json> <migration.sql>');
    process.exit(2);
  }
  const { jobs } = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  const resc = lerReescalonamento(readFileSync(migrationPath, 'utf8'));
  process.stdout.write(relatorio(jobs, resc) + '\n');
}
