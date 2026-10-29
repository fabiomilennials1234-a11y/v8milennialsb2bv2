// Lista Fria · fonte CNPJ no worker (services/lista-fria-worker): filtros, paginação por cursor,
// deduplicação, fluxo completo pelo executor, sincronização da base e o SQL no DuckDB de verdade.
//
// Sem rede: banco, consulta, MX e Storage entram falsos. O teste com DuckDB real só roda onde a
// dependência do worker está instalada (cd services/lista-fria-worker && npm ci); no CI, pula.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import {
  CFG_CNPJ_PADRAO, candidatoDaLinha, filtrosDaBusca, fonteCnpj, municipioNormalizado, planoDaBuscaCnpj, tamanhoDoLote,
} from '../../services/lista-fria-worker/src/fonte-cnpj.ts';
import { CFG_PADRAO, executarBusca } from '../../services/lista-fria-worker/src/executor.ts';
import { VERSAO_LAYOUT, baseLocal, sincronizarBase } from '../../services/lista-fria-worker/src/base-cnpj.ts';

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

describe('tamanho do lote (ajustado ao saldo)', () => {
  test('sem saber o saldo, o teto; sabendo, só o que ele pede com folga, entre o piso e o teto', () => {
    assert.equal(tamanhoDoLote(undefined, CFG_CNPJ_PADRAO), 250);
    assert.equal(tamanhoDoLote(10, CFG_CNPJ_PADRAO), 20, '10 créditos × 2 = 20');
    assert.equal(tamanhoDoLote(3, CFG_CNPJ_PADRAO), 20, 'nunca abaixo do piso');
    assert.equal(tamanhoDoLote(0, CFG_CNPJ_PADRAO), 20);
    assert.equal(tamanhoDoLote(100, CFG_CNPJ_PADRAO), 200);
    assert.equal(tamanhoDoLote(125, CFG_CNPJ_PADRAO), 250);
    assert.equal(tamanhoDoLote(100_000, CFG_CNPJ_PADRAO), 250, 'nunca acima do teto');
    assert.equal(tamanhoDoLote(7.2, { ...CFG_CNPJ_PADRAO, folga: 3 }), 22, 'arredonda para cima');
  });

  test('o teto manda mesmo quando menor que o piso (configuração de teste)', () => {
    assert.equal(tamanhoDoLote(10, { ...CFG_CNPJ_PADRAO, pagina: 5 }), 5);
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

  test('lê só o que o saldo restante pede, e a página curta é medida contra o lote pedido (não contra o teto)', async () => {
    const consulta = consultaDe(Array.from({ length: 30 }, (_, i) => linha(i + 1)));
    const f = fonteCnpj(busca({ creditos_limite: 10 }), consulta, CFG_CNPJ_PADRAO, log);
    await f.iniciar();
    const a = await f.ler('b1', { restantes: 10 });
    assert.equal(consulta.chamadas[0].limite, 20);
    assert.equal(a.linhas.length, 20);
    assert.equal(a.terminou, false, '20 linhas de 20 pedidas: a base ainda tem mais');
    const b = await f.ler('b1', { restantes: 4 });
    assert.equal(consulta.chamadas[1].limite, 20, 'piso');
    assert.equal(b.linhas.length, 10, 'só sobravam 10 linhas na base');
    assert.equal(b.terminou, true, '10 de 20 pedidas: acabou o alvo');
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

  test('o executor informa os créditos que faltam a cada volta, e a busca de 10 créditos lê 20 linhas, não 250', async () => {
    const m = bancoMemoria(10);
    const b = busca({ creditos_limite: 10 });
    const limites = [];
    const todas = Array.from({ length: 500 }, (_, i) => linha(i + 1));
    const consultaRegistrando = { buscar: async (f, depois, limite) => { limites.push(limite); return todas.filter((l) => !depois || l.cnpj > depois).slice(0, limite); } };
    await executarBusca(b, fonteCnpj(b, consultaRegistrando, CFG_CNPJ_PADRAO, () => {}), ambiente(m.banco), { ...CFG_PADRAO, workerId: 'w', pollMs: 1 });
    assert.deepEqual(limites, [20], 'uma leitura de 20 linhas bastou para os 10 créditos');
    assert.equal(m.reg.registrados.length, 10);
    assert.deepEqual(m.reg.encerrar, [['parada', null]]);
    assert.ok(m.reg.progressos.at(-1).encontrados <= 20, 'analisou 20, não 243');
  });

  test('com perda de contatos, lê mais um lote, medido pelo que falta', async () => {
    const m = bancoMemoria(10);
    const b = busca({ creditos_limite: 10 });
    const limites = [];
    // As 20 primeiras linhas repartem 4 e-mails: o dedupe da fonte deixa 4 candidatos. As seguintes são todas boas.
    const todas = Array.from({ length: 200 }, (_, i) => linha(i + 1, i < 20 ? { email: `dono${i % 4}@x.com`, tel: `1190000${String(i % 4).padStart(4, '0')}` } : {}));
    const consultaRegistrando = { buscar: async (f, depois, limite) => { limites.push(limite); return todas.filter((l) => !depois || l.cnpj > depois).slice(0, limite); } };
    await executarBusca(b, fonteCnpj(b, consultaRegistrando, CFG_CNPJ_PADRAO, () => {}), ambiente(m.banco), { ...CFG_PADRAO, workerId: 'w', pollMs: 1 });
    assert.deepEqual(limites, [20, 20], 'faltavam 6 créditos depois da 1ª leitura: 6 × 2 = 12 fica abaixo do piso de 20, e o piso vale');
    assert.equal(m.reg.registrados.length, 10);
  });

  test('base vazia para o alvo conclui sem erro e sem cobrar', async () => {
    const m = bancoMemoria(10);
    const b = busca();
    await executarBusca(b, fonteCnpj(b, consulta([]), CFG_CNPJ_PADRAO, () => {}), ambiente(m.banco), { ...CFG_PADRAO, workerId: 'w', pollMs: 1 });
    assert.deepEqual(m.reg.registrados, []);
    assert.deepEqual(m.reg.encerrar, [['concluida', null]]);
  });
});

describe('sincronização da base em partes (Storage -> disco)', () => {
  const sha = (buf) => createHash('sha256').update(buf).digest('hex');
  /** Monta o manifesto v2 e o conteúdo das partes, como o construir.py publica. */
  const base = (conteudos, extra = {}) => {
    const arquivos = conteudos.map((c, i) => {
      const buf = Buffer.from(c);
      return { nome: `cnpj-enxuto-${String(i).padStart(3, '0')}-${sha(buf).slice(0, 12)}.parquet`, bytes: buf.length, sha256: sha(buf), linhas: 10, buf };
    });
    const conjunto = sha(Buffer.from(arquivos.map((a) => `${a.nome}:${a.sha256}`).join('\n')));
    const manifesto = { mes: '2026-10', linhas: 10 * arquivos.length, bytes: arquivos.reduce((t, a) => t + a.bytes, 0), sha256: conjunto,
      construido_em: '2026-10-28T00:00:00Z', versao_layout: VERSAO_LAYOUT, arquivos: arquivos.map(({ buf, ...a }) => a), ...extra };
    const objetos = { 'manifesto.json': JSON.stringify(manifesto) };
    for (const a of arquivos) objetos[a.nome] = a.buf;
    return { manifesto, objetos, nomes: arquivos.map((a) => a.nome) };
  };
  const storage = (objetos) => {
    const pedidos = [];
    return {
      pedidos,
      fetch: async (url, init) => {
        const nome = url.split('/lista-fria-base/')[1];
        pedidos.push({ nome, auth: init?.headers?.Authorization, url });
        const corpo = objetos[nome];
        if (corpo === undefined) return new Response('{}', { status: 404 });
        if (corpo === 'ERRO') return new Response('x', { status: 500 });
        return new Response(corpo, { status: 200 });
      },
    };
  };
  const cfgDe = async (st) => ({ url: 'https://x.supabase.co/', chave: 'chave-de-servico', dir: await mkdtemp(path.join(tmpdir(), 'lf-base-')), fetch: st.fetch });
  const log = () => {};
  const limpar = (cfg) => rm(cfg.dir, { recursive: true, force: true });

  test('baixa e confere cada parte, na ordem do manifesto; com o mesmo hash só pede o manifesto', async () => {
    const b = base(['parte-um', 'parte-dois', 'parte-tres']);
    const st = storage(b.objetos);
    const cfg = await cfgDe(st);
    try {
      const a = await sincronizarBase(cfg, log);
      assert.equal(a.trocou, true);
      assert.deepEqual(a.arquivos.map((x) => path.basename(x)), b.nomes, 'a ordem das partes é a da busca');
      assert.deepEqual(await readFile(a.arquivos[1]), Buffer.from('parte-dois'));
      assert.ok(st.pedidos.every((p) => p.auth === 'Bearer chave-de-servico'));
      assert.ok(st.pedidos[0].url.startsWith('https://x.supabase.co/storage/v1/object/authenticated/lista-fria-base/'));
      const antes = st.pedidos.length;
      const seg = await sincronizarBase(cfg, log);
      assert.equal(seg.trocou, false);
      assert.equal(st.pedidos.length, antes + 1, 'só o manifesto foi pedido');
      assert.equal((await baseLocal(cfg.dir)).manifesto.mes, '2026-10');
    } finally { await limpar(cfg); }
  });

  test('mês novo baixa só a parte que mudou e apaga as antigas depois', async () => {
    const v1 = base(['igual-a', 'igual-b', 'velha-c']);
    const cfg = await cfgDe(storage(v1.objetos));
    try {
      await sincronizarBase(cfg, log);
      const v2 = base(['igual-a', 'igual-b', 'nova-c'], { mes: '2026-11' });
      const st2 = storage(v2.objetos);
      const r = await sincronizarBase({ ...cfg, fetch: st2.fetch }, log);
      assert.equal(r.manifesto.mes, '2026-11');
      assert.deepEqual(st2.pedidos.map((p) => p.nome).filter((n) => n !== 'manifesto.json'), [v2.nomes[2]], 'só a parte nova');
      assert.deepEqual((await readdir(cfg.dir)).filter((n) => n.endsWith('.parquet')).sort(), [...v2.nomes].sort(), 'a velha saiu');
    } finally { await limpar(cfg); }
  });

  test('parte corrompida ou falha no meio: a base anterior continua inteira e utilizável', async () => {
    const v1 = base(['a-velha', 'b-velha']);
    const cfg = await cfgDe(storage(v1.objetos));
    try {
      await sincronizarBase(cfg, log);
      const v2 = base(['a-nova', 'b-nova'], { mes: '2026-11' });
      const eventos = [];
      const corrompida = { ...v2.objetos, [v2.nomes[1]]: Buffer.from('lixo') };
      const r1 = await sincronizarBase({ ...cfg, fetch: storage(corrompida).fetch }, (e) => eventos.push(e));
      assert.equal(r1.manifesto.mes, '2026-10', 'continua na base boa');
      assert.ok(eventos.includes('base_cnpj_sync_falhou'));
      const quebrada = { ...v2.objetos, [v2.nomes[1]]: 'ERRO' };
      const r2 = await sincronizarBase({ ...cfg, fetch: storage(quebrada).fetch }, log);
      assert.equal(r2.manifesto.mes, '2026-10');
      const local = await baseLocal(cfg.dir);
      assert.equal(local.manifesto.mes, '2026-10', 'o manifesto local não foi promovido');
      assert.ok(local.arquivos.every((x) => existsSync(x)), 'as partes antigas seguem no disco');
    } finally { await limpar(cfg); }
  });

  test('sem publicação (404), erro de rede, layout antigo e nome de parte perigoso não derrubam nem entram', async () => {
    const cfg = await cfgDe(storage({}));
    try {
      assert.equal(await sincronizarBase(cfg, log), null, '404 sem nada no disco = indisponível');
      assert.equal(await sincronizarBase({ ...cfg, fetch: storage({ 'manifesto.json': 'ERRO' }).fetch }, log), null);
      assert.equal(await sincronizarBase({ ...cfg, fetch: async () => { throw new Error('rede caiu'); } }, log), null);
      const antigo = base(['x'], { versao_layout: 1 });
      assert.equal(await sincronizarBase({ ...cfg, fetch: storage(antigo.objetos).fetch }, log), null, 'layout de outra versão é recusado');
      const b = base(['y']);
      const m = { ...b.manifesto, arquivos: [{ ...b.manifesto.arquivos[0], nome: '../../etc/passwd' }] };
      assert.equal(await sincronizarBase({ ...cfg, fetch: storage({ 'manifesto.json': JSON.stringify(m) }).fetch }, log), null, 'nome fora do padrão é recusado (path traversal)');
      assert.deepEqual(await readdir(cfg.dir).catch(() => []), []);
    } finally { await limpar(cfg); }
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
    const q = await consultaDuckdb([arquivo]);
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
    const q = await consultaDuckdb([arquivo]);
    try {
      assert.deepEqual(await q.buscar(f({ municipio: "X' OR '1'='1" }), null, 10), [], 'município é parâmetro, não texto');
      assert.throws(() => sqlDaBusca([arquivo], f({ cnaes: ["46') OR 1=1 --"] }), null, 5), /CNAE inválido/);
      const { sql, valores } = sqlDaBusca([arquivo], f({ municipio: 'SAO PAULO' }), '123', 5);
      assert.ok(!sql.includes('SAO PAULO') && !sql.includes('123'), 'valores só por parâmetro');
      assert.deepEqual(valores, ['SP', 'SAO PAULO', '123', 5]);
    } finally { q.fechar(); await rm(dir, { recursive: true, force: true }); }
  });
});
