// Lista Fria · fonte CNPJ no worker (services/lista-fria-worker): filtros, paginação por cursor,
// deduplicação, fluxo completo pelo executor, sincronização da base e o SQL no DuckDB de verdade.
//
// Sem rede: banco, consulta, MX e Storage entram falsos. O teste com DuckDB real só roda onde a
// dependência do worker está instalada (cd services/lista-fria-worker && npm ci); no CI, pula.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import {
  CFG_CNPJ_PADRAO, candidatoDaLinha, filtrosDaBusca, fonteCnpj, municipioNormalizado, planoDaBuscaCnpj,
} from '../../services/lista-fria-worker/src/fonte-cnpj.ts';
import { CFG_PADRAO, executarBusca } from '../../services/lista-fria-worker/src/executor.ts';
import { ARQUIVO_BASE, VERSAO_LAYOUT, baseLocal, sincronizarBase } from '../../services/lista-fria-worker/src/base-cnpj.ts';

const busca = (extra = {}) => ({
  id: 'b1', organization_id: 'o', fonte: 'cnpj', nicho: null, cidade: null, instagram_handle: null,
  filtros: { cnaes: ['4639'], uf: 'SP', contato: 'qualquer' }, creditos_limite: 10, creditos_usados: 0, ...extra,
});
const linha = (n, extra = {}) => ({
  cnpj: String(n).padStart(14, '0'), razao: `EMPRESA ${n} LTDA`, fantasia: null, cnae: '4639701', cnae_desc: 'Comércio atacadista',
  uf: 'SP', municipio: 'SAO PAULO', bairro: 'CENTRO', endereco: `RUA ${n}, 10`, tel: `119${String(90000000 + n)}`,
  email: `contato${n}@empresa${n}.com.br`, porte: '01', celular: true, ...extra,
});

describe('filtros da busca', () => {
  test('normaliza CNAE, UF e contato; recusa o que não é válido', () => {
    assert.deepEqual(filtrosDaBusca(busca({ filtros: { cnaes: ['46.39-7-01', '4639701', '86'], uf: 'sp', municipio: ' Campinas ', contato: 'email' } })),
      { cnaes: ['4639701', '86'], uf: 'SP', municipio: 'Campinas', contato: 'email' });
    assert.equal(filtrosDaBusca(busca({ filtros: { cnaes: ['4639'], uf: 'SP' } })).contato, 'qualquer');
    for (const f of [null, {}, { cnaes: [], uf: 'SP' }, { cnaes: ['x'], uf: 'SP' }, { cnaes: ['4639'], uf: 'XX' }, { cnaes: ['4639'], uf: 'SP', contato: 'sms' },
      { cnaes: Array.from({ length: 21 }, (_, i) => String(1000 + i)), uf: 'SP' }]) {
      assert.throws(() => filtrosDaBusca(busca({ filtros: f })), undefined, JSON.stringify(f));
    }
  });
  test('município: sem acento, maiúsculo, sem "- UF" no fim', () => {
    assert.equal(municipioNormalizado('São Paulo - SP'), 'SAO PAULO');
    assert.equal(municipioNormalizado('  florianópolis  '), 'FLORIANOPOLIS');
    assert.equal(municipioNormalizado("Santa Bárbara d'Oeste/SP"), "SANTA BARBARA D'OESTE");
    assert.equal(municipioNormalizado('Rio de Janeiro'), 'RIO DE JANEIRO');
  });
  test('plano: varredura e prazo proporcionais ao crédito, com piso e teto', () => {
    assert.deepEqual(planoDaBuscaCnpj(1, CFG_CNPJ_PADRAO), { maxLinhas: 250, maxTimeS: 300 });
    assert.deepEqual(planoDaBuscaCnpj(1_000, CFG_CNPJ_PADRAO), { maxLinhas: 20_000, maxTimeS: 1_000 });
    assert.equal(planoDaBuscaCnpj(100_000, CFG_CNPJ_PADRAO).maxTimeS, 7_200);
  });
});

describe('candidato', () => {
  test('nome fantasia vence a razão; endereço junta rua, bairro e cidade; sem site', () => {
    const c = candidatoDaLinha(linha(7, { fantasia: 'ACME' }));
    assert.equal(c.titulo, 'ACME');
    assert.equal(c.ref, '00000000000007');
    assert.equal(c.categoria, 'Comércio atacadista');
    assert.equal(c.endereco, 'RUA 7, 10, CENTRO, SAO PAULO - SP');
    assert.equal(c.site, null);
    assert.deepEqual(c.emails, ['contato7@empresa7.com.br']);
    assert.equal(candidatoDaLinha(linha(8)).titulo, 'EMPRESA 8 LTDA');
  });
  test('sem nome ou sem CNPJ não vira candidato; e-mail nulo (contador) deixa só o telefone', () => {
    assert.equal(candidatoDaLinha(linha(9, { fantasia: null, razao: null })), null);
    assert.equal(candidatoDaLinha(linha(9, { cnpj: '' })), null);
    assert.deepEqual(candidatoDaLinha(linha(10, { email: null })).emails, []);
  });
});

describe('fonteCnpj', () => {
  const consultaDe = (todas) => ({
    chamadas: [],
    async buscar(filtros, depois, limite) {
      this.chamadas.push({ filtros, depois, limite });
      return todas.filter((l) => !depois || l.cnpj > depois).slice(0, limite);
    },
  });
  const log = () => {};

  test('lê por cursor de CNPJ, sem reler, e termina na página curta', async () => {
    const consulta = consultaDe(Array.from({ length: 5 }, (_, i) => linha(i + 1)));
    const f = fonteCnpj(busca({ creditos_limite: 100 }), consulta, { ...CFG_CNPJ_PADRAO, pagina: 2 }, log);
    const { id, maxTimeS } = await f.iniciar();
    assert.equal(id, 'b1');
    assert.equal(maxTimeS, 300);
    const a = await f.ler(id); const b = await f.ler(id); const c = await f.ler(id);
    assert.deepEqual([a, b, c].map((r) => r.linhas.map((l) => l.ref.slice(-1))), [['1', '2'], ['3', '4'], ['5']]);
    assert.deepEqual([a.terminou, b.terminou, c.terminou], [false, false, true]);
    assert.deepEqual(consulta.chamadas.map((x) => x.depois), [null, '00000000000002', '00000000000004']);
  });

  test('filtros e município normalizados vão para a consulta', async () => {
    const consulta = consultaDe([]);
    const f = fonteCnpj(busca({ filtros: { cnaes: ['86'], uf: 'rj', municipio: 'Niterói - RJ', contato: 'ambos' } }), consulta, CFG_CNPJ_PADRAO, log);
    await f.iniciar();
    const r = await f.ler('b1');
    assert.deepEqual(consulta.chamadas[0].filtros, { cnaes: ['86'], uf: 'RJ', municipio: 'NITEROI', contato: 'ambos' });
    assert.equal(r.terminou, true, 'base vazia para o alvo = acabou');
    assert.equal(r.falhou, false);
  });

  test('o mesmo e-mail ou telefone em outro CNPJ não vira outro contato (não cobra duas vezes)', async () => {
    const consulta = consultaDe([
      linha(1, { email: 'dono@x.com', tel: '11911110000' }),
      linha(2, { email: 'DONO@x.com', tel: '11922220000' }),
      linha(3, { email: 'outro@y.com', tel: '(11) 91111-0000' }),
      linha(4, { email: null, tel: '11933330000' }),
    ]);
    const f = fonteCnpj(busca(), consulta, CFG_CNPJ_PADRAO, log);
    await f.iniciar();
    const { linhas } = await f.ler('b1');
    assert.deepEqual(linhas.map((l) => l.ref.slice(-1)), ['1', '4']);
  });

  test('para de varrer quando passa do teto de linhas por crédito', async () => {
    const consulta = consultaDe(Array.from({ length: 1000 }, (_, i) => linha(i + 1)));
    const f = fonteCnpj(busca({ creditos_limite: 1 }), consulta, { ...CFG_CNPJ_PADRAO, pagina: 100, varreduraPorCredito: 1 }, log);
    await f.iniciar();
    assert.equal((await f.ler('b1')).terminou, true, '100 linhas lidas >= teto de max(pagina, 1 × 1)');
  });

  test('busca sem filtros válidos falha ao iniciar', async () => {
    const f = fonteCnpj(busca({ filtros: null }), consultaDe([]), CFG_CNPJ_PADRAO, log);
    await assert.rejects(f.iniciar(), /sem filtros/);
  });
});

describe('fluxo completo pelo executor', () => {
  const bancoMemoria = (limiteReal) => {
    const reg = { registrados: [], encerrar: [], progressos: [] };
    return {
      reg,
      banco: {
        progresso: async (b, w, p) => { reg.progressos.push(p); return 'executando'; },
        registrar: async (b, w, itens) => {
          const cabem = Math.max(0, limiteReal - reg.registrados.length);
          reg.registrados.push(...itens.slice(0, cabem));
          return { aceitos: Math.min(cabem, itens.length), limite_atingido: reg.registrados.length >= limiteReal, ativa: true };
        },
        encerrar: async (b, w, s, e) => { reg.encerrar.push([s, e ?? null]); },
        reivindicar: async () => null, recuperarTravadas: async () => 0,
      },
    };
  };
  const ambiente = (banco, mx = async () => true) => ({
    banco, gosom: null, ia: null,
    site: async () => { throw new Error('CNPJ não lê site'); },
    mx, esperar: async () => {}, agora: () => Date.now(), abortar: () => false, log: () => {},
  });
  const consulta = (todas) => ({ buscar: async (f, depois, limite) => todas.filter((l) => !depois || l.cnpj > depois).slice(0, limite) });

  test('registra os contatos, para no limite de créditos e fecha como parada', async () => {
    const m = bancoMemoria(3);
    const b = busca({ creditos_limite: 3 });
    const todas = Array.from({ length: 8 }, (_, i) => linha(i + 1));
    await executarBusca(b, fonteCnpj(b, consulta(todas), { ...CFG_CNPJ_PADRAO, pagina: 5 }, () => {}), ambiente(m.banco), { ...CFG_PADRAO, workerId: 'w', pollMs: 1 });
    assert.deepEqual(m.reg.registrados.map((r) => r.ref_externa.slice(-1)), ['1', '2', '3'], 'na ordem de CNPJ');
    assert.deepEqual(m.reg.encerrar, [['parada', null]]);
    const r = m.reg.registrados[0];
    assert.equal(r.nome, 'EMPRESA 1 LTDA');
    assert.equal(r.email, 'contato1@empresa1.com.br');
    assert.equal(r.categoria, 'Comércio atacadista');
    assert.equal(r.site, null);
    assert.equal(r.qualidade, 'verificado');
  });

  test('qualidade: celular verifica; fixo + e-mail sem MX fica não verificado; só e-mail sem MX é inválido', async () => {
    const m = bancoMemoria(10);
    const b = busca();
    const todas = [
      linha(1),                                          // celular: verificado mesmo sem MX
      linha(2, { tel: '1133334444', celular: false }),   // fixo + e-mail sem MX
      linha(3, { tel: null, celular: false }),           // só e-mail, sem MX
    ];
    await executarBusca(b, fonteCnpj(b, consulta(todas), CFG_CNPJ_PADRAO, () => {}), ambiente(m.banco, async () => false), { ...CFG_PADRAO, workerId: 'w', pollMs: 1 });
    assert.deepEqual(m.reg.registrados.map((r) => r.qualidade), ['verificado', 'nao_verificado', 'email_invalido']);
    assert.deepEqual(m.reg.encerrar, [['concluida', null]]);
  });

  test('base vazia para o alvo conclui sem erro e sem cobrar', async () => {
    const m = bancoMemoria(10);
    const b = busca();
    await executarBusca(b, fonteCnpj(b, consulta([]), CFG_CNPJ_PADRAO, () => {}), ambiente(m.banco), { ...CFG_PADRAO, workerId: 'w', pollMs: 1 });
    assert.deepEqual(m.reg.registrados, []);
    assert.deepEqual(m.reg.encerrar, [['concluida', null]]);
  });
});

describe('sincronização da base (Storage -> disco)', () => {
  const sha = (buf) => createHash('sha256').update(buf).digest('hex');
  const manifestoDe = (buf, extra = {}) => ({ mes: '2026-10', linhas: 7, bytes: buf.length, sha256: sha(buf), construido_em: '2026-10-28T00:00:00Z', versao_layout: VERSAO_LAYOUT, ...extra });
  const storage = (arquivos) => {
    const pedidos = [];
    return {
      pedidos,
      fetch: async (url, init) => {
        pedidos.push({ url, auth: init?.headers?.Authorization });
        const nome = url.split('/lista-fria-base/')[1];
        const corpo = arquivos[nome];
        if (corpo === undefined) return new Response('{}', { status: 404 });
        if (corpo === 'ERRO') return new Response('x', { status: 500 });
        return new Response(corpo, { status: 200 });
      },
    };
  };
  const cfgDe = async (st) => ({ url: 'https://x.supabase.co/', chave: 'chave-de-servico', dir: await mkdtemp(path.join(tmpdir(), 'lf-base-')), fetch: st.fetch });
  const log = () => {};

  test('baixa, confere o sha256 e troca o arquivo; com o mesmo hash não baixa de novo', async () => {
    const parquet = Buffer.from('PAR1-conteudo-falso');
    const st = storage({ 'manifesto.json': JSON.stringify(manifestoDe(parquet)), [ARQUIVO_BASE]: parquet });
    const cfg = await cfgDe(st);
    try {
      const a = await sincronizarBase(cfg, log);
      assert.equal(a.trocou, true);
      assert.deepEqual(await readFile(a.arquivo), parquet);
      assert.ok(st.pedidos.every((p) => p.auth === 'Bearer chave-de-servico'));
      assert.ok(st.pedidos[0].url.startsWith('https://x.supabase.co/storage/v1/object/authenticated/lista-fria-base/'));
      const antes = st.pedidos.length;
      const b = await sincronizarBase(cfg, log);
      assert.equal(b.trocou, false);
      assert.equal(st.pedidos.length, antes + 1, 'só o manifesto foi pedido');
      assert.equal((await baseLocal(cfg.dir)).manifesto.mes, '2026-10');
    } finally { await rm(cfg.dir, { recursive: true, force: true }); }
  });

  test('arquivo que não confere com o manifesto é descartado e a base antiga fica', async () => {
    const velho = Buffer.from('PAR1-velho');
    const novo = Buffer.from('PAR1-novo');
    const st1 = storage({ 'manifesto.json': JSON.stringify(manifestoDe(velho)), [ARQUIVO_BASE]: velho });
    const cfg = await cfgDe(st1);
    try {
      await sincronizarBase(cfg, log);
      const st2 = storage({ 'manifesto.json': JSON.stringify(manifestoDe(novo, { mes: '2026-11' })), [ARQUIVO_BASE]: Buffer.from('corrompido') });
      const eventos = [];
      const r = await sincronizarBase({ ...cfg, fetch: st2.fetch }, (e) => eventos.push(e));
      assert.equal(r.manifesto.mes, '2026-10', 'continua na base boa');
      assert.deepEqual(await readFile(path.join(cfg.dir, ARQUIVO_BASE)), velho);
      assert.ok(eventos.includes('base_cnpj_sync_falhou'));
    } finally { await rm(cfg.dir, { recursive: true, force: true }); }
  });

  test('sem publicação (404), erro de rede e layout desconhecido não derrubam: devolvem o que há', async () => {
    const cfg = await cfgDe(storage({}));
    try {
      assert.equal(await sincronizarBase(cfg, log), null, '404 sem nada no disco = indisponível');
      assert.equal(await sincronizarBase({ ...cfg, fetch: storage({ 'manifesto.json': 'ERRO' }).fetch }, log), null);
      assert.equal(await sincronizarBase({ ...cfg, fetch: async () => { throw new Error('rede caiu'); } }, log), null);
      const buf = Buffer.from('PAR1-x');
      const futuro = storage({ 'manifesto.json': JSON.stringify(manifestoDe(buf, { versao_layout: VERSAO_LAYOUT + 1 })), [ARQUIVO_BASE]: buf });
      assert.equal(await sincronizarBase({ ...cfg, fetch: futuro.fetch }, log), null, 'layout de outra versão é recusado');
    } finally { await rm(cfg.dir, { recursive: true, force: true }); }
  });
});

// ── DuckDB de verdade ──────────────────────────────────────────────────────
let duck = null;
try {
  const req = createRequire(new URL('../../services/lista-fria-worker/package.json', import.meta.url));
  duck = await import(pathToFileURL(req.resolve('@duckdb/node-api')).href);
} catch { duck = null; }
const temDuck = duck !== null;

describe('SQL no DuckDB real', () => {
  const sqlMod = temDuck ? import('../../services/lista-fria-worker/src/consulta-duckdb.ts') : null;

  async function parquetDeTeste() {
    const dir = await mkdtemp(path.join(tmpdir(), 'lf-pq-'));
    const arquivo = path.join(dir, 'base.parquet').replaceAll('\\', '/');
    const i = await duck.DuckDBInstance.create(':memory:');
    const c = await i.connect();
    await c.run(`COPY (SELECT * FROM (VALUES
      ('00000000000191','ACME LTDA','ACME','4639701','Comércio atacadista','SP','SAO PAULO','CENTRO','RUA A 1','11999990000','a@acme.com','03',true,true,false),
      ('00000000000272','BETA LTDA',NULL,'4639701','Comércio atacadista','SP','SAO PAULO','MOEMA','RUA B 2','1133334444','contador@x.com','01',true,false,true),
      ('00000000000353','GAMA LTDA',NULL,'8630501','Medicina','SP','CAMPINAS',NULL,NULL,NULL,'g@gama.com','01',true,false,false),
      ('00000000000434','FILIAL LTDA',NULL,'4639701','Comércio','SP','SAO PAULO',NULL,NULL,'11988887777','f@f.com','01',false,true,false),
      ('00000000000515','OUTRO ESTADO',NULL,'4639701','Comércio','RJ','NITEROI',NULL,NULL,'21988887777','r@r.com','01',true,true,false)
    ) t(cnpj,razao,fantasia,cnae,cnae_desc,uf,municipio,bairro,endereco,tel,email,porte,matriz,celular,email_compartilhado))
    TO '${arquivo}' (FORMAT parquet)`);
    c.closeSync(); i.closeSync();
    return { dir, arquivo };
  }
  const f = (o) => ({ cnaes: ['4639'], uf: 'SP', contato: 'qualquer', ...o });

  test('UF, CNAE por prefixo, só matriz, e-mail de contador anulado, filtros de contato, cursor', { skip: temDuck ? false : 'DuckDB do worker não instalado' }, async () => {
    const { consultaDuckdb } = await sqlMod;
    const { dir, arquivo } = await parquetDeTeste();
    const q = await consultaDuckdb(arquivo);
    try {
      const ref = (rs) => rs.map((l) => l.cnpj.slice(-3));
      const qualquer = await q.buscar(f({}), null, 10);
      assert.deepEqual(ref(qualquer), ['191', '272'], 'sem filial e sem outro estado');
      assert.equal(qualquer[1].email, null, 'e-mail compartilhado vira nulo');
      assert.equal(qualquer[1].tel, '1133334444', 'mas o telefone fica');
      assert.deepEqual(ref(await q.buscar(f({ contato: 'email' }), null, 10)), ['191']);
      assert.deepEqual(ref(await q.buscar(f({ contato: 'telefone' }), null, 10)), ['191', '272']);
      assert.deepEqual(ref(await q.buscar(f({ contato: 'ambos' }), null, 10)), ['191']);
      assert.deepEqual(ref(await q.buscar(f({ cnaes: ['86'], municipio: 'CAMPINAS' }), null, 10)), ['353']);
      assert.deepEqual(ref(await q.buscar(f({ cnaes: ['86'], municipio: 'SAO PAULO' }), null, 10)), []);
      assert.deepEqual(ref(await q.buscar(f({ cnaes: ['8630', '4639'] }), null, 10)), ['191', '272', '353']);
      assert.deepEqual(ref(await q.buscar(f({}), '00000000000191', 10)), ['272'], 'cursor');
      assert.equal((await q.buscar(f({}), null, 1)).length, 1);
    } finally { q.fechar(); await rm(dir, { recursive: true, force: true }); }
  });

  test('nada do usuário vira SQL: aspas no município e CNAE fora do padrão', { skip: temDuck ? false : 'DuckDB do worker não instalado' }, async () => {
    const { consultaDuckdb, sqlDaBusca } = await sqlMod;
    const { dir, arquivo } = await parquetDeTeste();
    const q = await consultaDuckdb(arquivo);
    try {
      assert.deepEqual(await q.buscar(f({ municipio: "X' OR '1'='1" }), null, 10), [], 'município é parâmetro, não texto');
      assert.throws(() => sqlDaBusca(arquivo, f({ cnaes: ["46') OR 1=1 --"] }), null, 5), /CNAE inválido/);
      const { sql, valores } = sqlDaBusca(arquivo, f({ municipio: 'SAO PAULO' }), '123', 5);
      assert.ok(!sql.includes('SAO PAULO') && !sql.includes('123'), 'valores só por parâmetro');
      assert.deepEqual(valores, ['SP', 'SAO PAULO', '123', 5]);
    } finally { q.fechar(); await rm(dir, { recursive: true, force: true }); }
  });
});
