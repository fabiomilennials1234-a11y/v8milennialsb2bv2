// Cobrança · destino e prazo máximo da promessa (20280123003000) num Postgres
// real (PGlite).
//
// Cobre: o destino do card passa a ser escolha da org (não o nome da coluna);
// o backfill da coluna padrão; o prazo máximo da promessa (só promessa, só quando
// configurado, na data de hoje no fuso da org); a validação das duas chaves na
// RPC da tela; e o rollback pareado. GRANT/RLS do banco real ficam com o pgTAP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const TORQUE = 'b2ad1ffb-e136-4356-846b-9f210f902573';
const U_ADMIN = id(1);
const TM_ADMIN = id(11);
const INST_COBRANCA = id(501);

// Quarta, 21/10/2026, 14h em São Paulo — dentro da janela padrão.
const AGORA = '2026-10-21T14:00:00-03:00';
const dia = (offset) => new Date(Date.UTC(2026, 9, 21 + offset)).toISOString().slice(0, 10);
// Dia de hoje no fuso da org (relógio real) — o cadastro usa now(), não o AGORA fixo.
const hojeBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const diaReal = (offset) => {
  const [a, m, d] = hojeBR().split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + offset)).toISOString().slice(0, 10);
};

const MIGRATIONS = [
  '20271212000000_cobranca_fundacao',
  '20271212000010_cobranca_endurecer_acl',
  '20271213000000_cobranca_regua',
  '20271214000000_cobranca_colunas_da_regua',
  '20280118010000_cobranca_trilhas_colunas_manuais_e_prazo',
  '20280120030000_cobranca_entrada_no_vencimento',
];
const NOVA = '20280123003000_cobranca_promessa_destino_e_prazo';
const _MSG0 = 'Olá {nome}, seu título de {valor} vence hoje ({vencimento}). Dias de atraso: {dias_atraso}.';

async function setup() {
  const db = new PGlite();
  await db.exec(read('./fixtures/cobranca-baseline.sql'));
  await db.exec(`
    INSERT INTO organizations (id, name, slug) VALUES ('${TORQUE}', 'TorqueCRM', 'torquecrm');
    INSERT INTO team_members (id, organization_id, user_id, name, role) VALUES
      ('${TM_ADMIN}', '${TORQUE}', '${U_ADMIN}', 'Admin', 'admin');
    INSERT INTO whatsapp_instances (id, organization_id, instance_name, provider, status) VALUES
      ('${INST_COBRANCA}', '${TORQUE}', 'cobrança', 'uazapi', 'connected');
  `);
  for (const m of MIGRATIONS) await db.exec(read(`../../supabase/migrations/${m}.sql`));
  await as(db, U_ADMIN);
  await db.query(`SELECT cobranca_regua_definir_numero('${TORQUE}', '${INST_COBRANCA}')`);
  await db.query(`SELECT cobranca_regua_ativar('${TORQUE}', true)`);
  await asPostgres(db);
  await db.exec(read(`../../supabase/migrations/${NOVA}.sql`));
  return db;
}

async function as(db, uid) {
  await db.exec(`RESET ROLE; SET test.uid = '${uid}'; SET test.role = 'authenticated'; SET ROLE authenticated;`);
}
async function asPostgres(db) {
  await db.exec(`RESET ROLE; SET test.uid = ''; SET test.role = '';`);
}
const one = async (db, sql) => (await db.query(sql)).rows[0];
const val = async (db, sql) => Object.values(await one(db, sql))[0];
const rows = async (db, sql) => (await db.query(sql)).rows;
const erro = async (db, sql) => {
  try { await db.query(sql); } catch (e) { return e; }
  assert.fail(`esperava erro em: ${sql}`);
};

async function devedor(db, { nome, telefone = '5548999990001', vencimento, valor = 100 , imediato = false}) {
  // O cadastro já entra na coluna do atraso na hora (relógio real). Os testes do cron usam
  // relógio fixo: o caso nasce com a régua desligada e quem o coloca é o planejar(AGORA).
  // `imediato: true` testa o caminho do cadastro.
  const ativa = await val(db, `SELECT COALESCE((SELECT ativa FROM cobranca_regua WHERE organization_id = '${TORQUE}'), false)`);
  if (ativa && !imediato) await db.exec(`UPDATE cobranca_regua SET ativa = false WHERE organization_id = '${TORQUE}'`);
  await as(db, U_ADMIN);
  const inad = await val(db, `SELECT cobranca_inadimplente_salvar('${TORQUE}', NULL,
    '${JSON.stringify({ nome, telefone, titulos: [{ valor, vencimento }] }).replace(/'/g, "''")}'::jsonb)`);
  await asPostgres(db);
  const caso = await val(db, `SELECT id FROM cobranca_casos WHERE inadimplente_id = '${inad}' AND encerrado_em IS NULL`);
  if (ativa && !imediato) await db.exec(`UPDATE cobranca_regua SET ativa = true WHERE organization_id = '${TORQUE}'`);
  return { inad, caso };
}
const planejar = (db, agora = AGORA) => one(db, `SELECT cobranca_regua_planejar('${agora}') AS r`).then((x) => x.r);
const colunaDo = (db, caso) => val(db, `SELECT e.nome FROM cobranca_casos c JOIN cobranca_etapas e ON e.id = c.etapa_id WHERE c.id = '${caso}'`);
const coluna = (db, nome) => val(db, `SELECT id FROM cobranca_etapas WHERE organization_id = '${TORQUE}' AND nome = '${nome}'`);
const envios = (db, caso) => rows(db, `SELECT en.gatilho, en.dias, en.status, e.nome AS coluna
  FROM cobranca_regua_envios en LEFT JOIN cobranca_etapas e ON e.id = en.etapa_id
  WHERE en.caso_id = '${caso}' ORDER BY en.created_at, en.dias`);

async function salvarColuna(db, dados, etapa = null) {
  await as(db, U_ADMIN);
  try {
    return await val(db, `SELECT cobranca_coluna_salvar('${TORQUE}', ${etapa ? `'${etapa}'` : 'NULL'},
      '${JSON.stringify(dados).replace(/'/g, "''")}'::jsonb)`);
  } finally {
    await asPostgres(db);
  }
}
async function mover(db, caso, nome, enviar = false) {
  await as(db, U_ADMIN);
  const r = await val(db, `SELECT cobranca_caso_mover('${caso}', '${await coluna(db, nome)}', NULL, ${enviar})`);
  await asPostgres(db);
  return r;
}


const registrar = async (db, caso, tipo, parcelas, moverPara = null) => {
  await as(db, U_ADMIN);
  try {
    return await val(db, `SELECT cobranca_compromisso_registrar('${caso}', '${tipo}',
      '${JSON.stringify(parcelas)}'::jsonb, NULL, ${moverPara ? `'${moverPara}'` : 'NULL'})`);
  } finally {
    await asPostgres(db);
  }
};
const ajustar = async (db, dados) => {
  await as(db, U_ADMIN);
  try {
    await db.query(`SELECT cobranca_regua_salvar('${TORQUE}', '${JSON.stringify(dados)}'::jsonb)`);
  } finally {
    await asPostgres(db);
  }
};

test('backfill: a coluna padrão "Promessa ou acordo" vira o destino; sem prazo máximo', async () => {
  const db = await setup();
  try {
    const r = await one(db, `SELECT e.nome AS destino, r.promessa_max_dias FROM cobranca_regua r
      LEFT JOIN cobranca_etapas e ON e.id = r.etapa_promessa_id WHERE r.organization_id = '${TORQUE}'`);
    assert.equal(r.destino, 'Promessa ou acordo');
    assert.equal(r.promessa_max_dias, null);
  } finally {
    await db.close();
  }
});

test('destino: a org escolhe a coluna, só coluna aberta dela; vazio = não move', async () => {
  const db = await setup();
  try {
    const col = await salvarColuna(db, { nome: 'PAGAMENTO AGENDADO', manual: true });
    await ajustar(db, { etapa_promessa_id: col });
    assert.equal(await val(db, `SELECT etapa_promessa_id FROM cobranca_regua WHERE organization_id = '${TORQUE}'`), col);
    const recuperado = await val(db, `SELECT id FROM cobranca_etapas WHERE organization_id = '${TORQUE}' AND papel = 'recuperado'`);
    await as(db, U_ADMIN);
    const e = await erro(db, `SELECT cobranca_regua_salvar('${TORQUE}', '{"etapa_promessa_id":"${recuperado}"}'::jsonb)`);
    await asPostgres(db);
    assert.match(e.message, /Etapa inválida/);
    await ajustar(db, { etapa_promessa_id: '' });
    assert.equal(await val(db, `SELECT etapa_promessa_id FROM cobranca_regua WHERE organization_id = '${TORQUE}'`), null);
  } finally {
    await db.close();
  }
});

test('prazo máximo: a promessa passa até hoje + N, não além; acordo e org sem limite não são barrados', async () => {
  const db = await setup();
  try {
    const { caso } = await devedor(db, { nome: 'Cliente Agenda', vencimento: diaReal(-5) });
    // Sem limite configurado: qualquer data.
    await registrar(db, caso, 'promessa', [{ vencimento: diaReal(60), valor: 100 }]);

    await ajustar(db, { promessa_max_dias: 7 });
    assert.ok(await registrar(db, caso, 'promessa', [{ vencimento: diaReal(7), valor: 100 }]), 'hoje + 7 passa');
    await as(db, U_ADMIN);
    const e = await erro(db, `SELECT cobranca_compromisso_registrar('${caso}', 'promessa',
      '[{"vencimento":"${diaReal(8)}","valor":100}]'::jsonb, NULL, NULL)`);
    await asPostgres(db);
    assert.equal(e.code, 'PT422');
    assert.match(e.message, /até 7 dias/);
    // A tentativa barrada não cancelou o compromisso ativo.
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_compromissos WHERE caso_id = '${caso}' AND status = 'ativo'`), 1);
    // Acordo em parcelas tem prazo próprio.
    assert.ok(await registrar(db, caso, 'acordo', [
      { vencimento: diaReal(30), valor: 50 }, { vencimento: diaReal(60), valor: 50 },
    ]));
  } finally {
    await db.close();
  }
});

test('tela: o prazo máximo valida 1..365, aceita vazio e a promessa move para o destino escolhido', async () => {
  const db = await setup();
  try {
    await as(db, U_ADMIN);
    for (const ruim of [0, 366]) {
      const e = await erro(db, `SELECT cobranca_regua_salvar('${TORQUE}', '{"promessa_max_dias":${ruim}}'::jsonb)`);
      assert.equal(e.code, 'PT422', `promessa_max_dias=${ruim}`);
    }
    await asPostgres(db);
    await ajustar(db, { promessa_max_dias: 7 });
    await ajustar(db, { promessa_max_dias: '' });
    assert.equal(await val(db, `SELECT promessa_max_dias FROM cobranca_regua WHERE organization_id = '${TORQUE}'`), null);

    const col = await salvarColuna(db, { nome: 'PAGAMENTO AGENDADO', manual: true });
    const { caso } = await devedor(db, { nome: 'Cliente Agenda 2', vencimento: diaReal(-2) });
    await registrar(db, caso, 'promessa', [{ vencimento: diaReal(3), valor: 100 }], col);
    assert.equal(await colunaDo(db, caso), 'PAGAMENTO AGENDADO');
  } finally {
    await db.close();
  }
});

test('rollback pareado: some o prazo e o destino, a régua e a promessa seguem', async () => {
  const db = await setup();
  try {
    await db.exec(read(`../../supabase/migrations/rollback/${NOVA}.sql`));
    assert.equal(await val(db, `SELECT count(*)::int FROM information_schema.columns
      WHERE table_name = 'cobranca_regua' AND column_name IN ('etapa_promessa_id', 'promessa_max_dias')`), 0);
    const { caso } = await devedor(db, { nome: 'Cliente Pós', vencimento: diaReal(-2) });
    assert.ok(await registrar(db, caso, 'promessa', [{ vencimento: diaReal(40), valor: 100 }]));
    await ajustar(db, { teto_diario: 25 });
    assert.equal(await val(db, `SELECT teto_diario FROM cobranca_regua WHERE organization_id = '${TORQUE}'`), 25);
  } finally {
    await db.close();
  }
});
