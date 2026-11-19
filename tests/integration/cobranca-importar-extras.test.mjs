// Cobrança · importação com Responsável e Observação por linha
// (20280121000000) num Postgres real (PGlite).
//
// Cobre: responsável por nome (sem caixa) e por e-mail, observação gravada, o
// dry-run apontando responsável inexistente ou ambíguo, o que NÃO é sobrescrito
// em quem já existe, linha sem os campos como antes e o rollback pareado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const TORQUE = 'b2ad1ffb-e136-4356-846b-9f210f902573';
const U_ADMIN = id(1);
const TM_ADMIN = id(11);
const TM_CLARA = id(12);
const TM_ANA1 = id(13);
const TM_ANA2 = id(14);
const TM_INATIVA = id(15);
const NOVA = '20280121000000_cobranca_importar_responsavel_e_observacoes';

async function setup() {
  const db = new PGlite();
  await db.exec(read('./fixtures/cobranca-baseline.sql'));
  // O fixture mínimo não tem e-mail no membro; a tabela real tem.
  await db.exec(`ALTER TABLE team_members ADD COLUMN IF NOT EXISTS email text`);
  await db.exec(`
    INSERT INTO organizations (id, name, slug) VALUES ('${TORQUE}', 'TorqueCRM', 'torquecrm');
    INSERT INTO team_members (id, organization_id, user_id, name, email, role, is_active) VALUES
      ('${TM_ADMIN}', '${TORQUE}', '${U_ADMIN}', 'Admin', 'admin@x.com', 'admin', true),
      ('${TM_CLARA}', '${TORQUE}', NULL, 'Clara Souza', 'clara@x.com', 'member', true),
      ('${TM_ANA1}', '${TORQUE}', NULL, 'Ana Lima', 'ana1@x.com', 'member', true),
      ('${TM_ANA2}', '${TORQUE}', NULL, 'ana lima', 'ana2@x.com', 'member', true),
      ('${TM_INATIVA}', '${TORQUE}', NULL, 'Bia Inativa', 'bia@x.com', 'member', false);
  `);
  await db.exec(read('../../supabase/migrations/20271212000000_cobranca_fundacao.sql'));
  await db.exec(read('../../supabase/migrations/20271212000010_cobranca_endurecer_acl.sql'));
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

async function importar(db, linhas, dry = false) {
  await as(db, U_ADMIN);
  try {
    return await val(db, `SELECT cobranca_importar('${TORQUE}', '${JSON.stringify(linhas).replace(/'/g, "''")}'::jsonb, ${dry})`);
  } finally {
    await asPostgres(db);
  }
}
const dono = (db, telefone) => one(db, `SELECT i.observacoes, tm.name AS responsavel
  FROM cobranca_inadimplentes i
  LEFT JOIN cobranca_casos c ON c.inadimplente_id = i.id AND c.encerrado_em IS NULL
  LEFT JOIN team_members tm ON tm.id = c.responsavel_id
  WHERE i.telefone = '${telefone}'`);

const base = { valor: 100, vencimento: '2026-10-01' };

test('responsável por nome (sem caixa) e por e-mail; observação gravada', async () => {
  const db = await setup();
  try {
    const r = await importar(db, [
      { ...base, nome: 'Padaria A', telefone: '48999990001', responsavel: 'clara souza', observacoes: 'Pediu boleto novo' },
      { ...base, nome: 'Padaria B', telefone: '48999990002', responsavel: 'CLARA@x.com' },
      { ...base, nome: 'Padaria C', telefone: '48999990003' },
    ]);
    assert.equal(r.inadimplentes_novos, 3);
    assert.equal(r.casos_abertos, 3);
    assert.deepEqual(r.linhas_invalidas, []);
    assert.deepEqual(await dono(db, '48999990001'), { observacoes: 'Pediu boleto novo', responsavel: 'Clara Souza' });
    assert.deepEqual(await dono(db, '48999990002'), { observacoes: null, responsavel: 'Clara Souza' });
    assert.deepEqual(await dono(db, '48999990003'), { observacoes: null, responsavel: null });
  } finally {
    await db.close();
  }
});

test('responsável inexistente, inativo ou ambíguo: a linha é apontada e nada entra', async () => {
  const db = await setup();
  try {
    const linhas = [
      { ...base, nome: 'Sem Dono', telefone: '48999990011', responsavel: 'Fulano' },
      { ...base, nome: 'Inativa', telefone: '48999990012', responsavel: 'Bia Inativa' },
      { ...base, nome: 'Ambígua', telefone: '48999990013', responsavel: 'Ana Lima' },
      { ...base, nome: 'Ambígua resolvida', telefone: '48999990014', responsavel: 'ana1@x.com' },
      { ...base, nome: 'Nota enorme', telefone: '48999990015', observacoes: 'x'.repeat(4001) },
    ];
    const seco = await importar(db, linhas, true);
    assert.deepEqual(seco.linhas_invalidas.map((l) => l.linha), [1, 2, 3, 5]);
    assert.match(seco.linhas_invalidas[0].motivo, /responsável não encontrado: Fulano/);
    assert.match(seco.linhas_invalidas[1].motivo, /responsável não encontrado: Bia Inativa/);
    assert.match(seco.linhas_invalidas[2].motivo, /responsável ambíguo \(use o e-mail\): Ana Lima/);
    assert.match(seco.linhas_invalidas[3].motivo, /observação passa de 4\.000/);
    assert.equal(seco.inadimplentes_novos, 1, 'só a linha com o e-mail inequívoco entra');
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_inadimplentes`), 0, 'dry-run não grava');

    const real = await importar(db, linhas, false);
    assert.equal(real.inadimplentes_novos, 1);
    assert.equal((await dono(db, '48999990014')).responsavel, 'Ana Lima');
  } finally {
    await db.close();
  }
});

test('quem já existe: observação não é sobrescrita; responsável só preenche caso sem responsável', async () => {
  const db = await setup();
  try {
    await importar(db, [
      { ...base, nome: 'Já Tinha', telefone: '48999990021', observacoes: 'Nota original', responsavel: 'Clara Souza' },
      { ...base, nome: 'Sem Dono Ainda', telefone: '48999990022' },
    ]);
    // Reimporta com outra nota e outro responsável: nada muda no que já tinha dono/nota.
    const r = await importar(db, [
      { ...base, nome: 'Já Tinha', telefone: '48999990021', observacoes: 'Outra nota', responsavel: 'ana1@x.com' },
      { ...base, nome: 'Sem Dono Ainda', telefone: '48999990022', observacoes: 'Agora tem nota', responsavel: 'ana1@x.com' },
    ]);
    assert.equal(r.inadimplentes_existentes, 2);
    assert.deepEqual(await dono(db, '48999990021'), { observacoes: 'Nota original', responsavel: 'Clara Souza' });
    assert.deepEqual(await dono(db, '48999990022'), { observacoes: 'Agora tem nota', responsavel: 'Ana Lima' });
  } finally {
    await db.close();
  }
});

test('o mesmo devedor em várias linhas: o primeiro responsável vale e todas as linhas viram títulos', async () => {
  const db = await setup();
  try {
    const r = await importar(db, [
      { ...base, nome: 'Dois Títulos', telefone: '48999990031', numero: 'T1', responsavel: 'Clara Souza' },
      { ...base, nome: 'Dois Títulos', telefone: '48999990031', numero: 'T2', valor: 250, responsavel: 'ana1@x.com' },
    ]);
    assert.equal(r.inadimplentes_novos, 1);
    assert.equal(r.titulos_novos, 2);
    assert.equal(r.casos_abertos, 1);
    assert.equal((await dono(db, '48999990031')).responsavel, 'Clara Souza');
  } finally {
    await db.close();
  }
});

test('rollback pareado: volta a importação anterior, que ignora Responsável e Observação', async () => {
  const db = await setup();
  try {
    await db.exec(read(`../../supabase/migrations/rollback/${NOVA}.sql`));
    const r = await importar(db, [
      { ...base, nome: 'Antigo', telefone: '48999990041', responsavel: 'Clara Souza', observacoes: 'ignorada' },
    ]);
    assert.equal(r.inadimplentes_novos, 1);
    assert.deepEqual(await dono(db, '48999990041'), { observacoes: null, responsavel: null });
  } finally {
    await db.close();
  }
});
