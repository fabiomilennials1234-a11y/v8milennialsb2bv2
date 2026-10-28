// Lista Fria · Instagram com LOGIN REAL (services/instagram-coletor) — o cliente do worker, o
// plano de prazo e o contrato JSON de ponta a ponta contra o serviço Python de verdade.
//
// O serviço roda com um cliente de Instagram FALSO (tests/servidor_de_teste.py): nada aqui fala
// com o Instagram. O que se trava é a fronteira worker <-> coletor.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';

import { coletorApi } from '../../services/lista-fria-worker/src/coletor-instagram.ts';
import { CFG_INSTAGRAM_PADRAO, CFG_INSTAGRAM_SESSAO_PADRAO, fonteInstagram, planoDaBusca } from '../../services/lista-fria-worker/src/fonte-instagram.ts';
import { CFG_PADRAO, executarBusca } from '../../services/lista-fria-worker/src/executor.ts';

const resp = (status, corpo) => new Response(corpo === null ? null : JSON.stringify(corpo), { status });

describe('cliente do coletor (fetch falso)', () => {
  test('iniciar: handle e máximo no corpo, Bearer no header; o dataset é o próprio job', async () => {
    let v;
    const api = coletorApi({ baseUrl: 'http://coletor:8090/', segredo: 's3', fetch: async (url, init) => { v = { url, init }; return resp(201, { id: 'abc' }); } });
    const r = await api.iniciar('ignorado', { username: 'clinica', mode: 'enriched', maxItems: 80 }, { maxTotalChargeUsd: 1, timeoutS: 60 });
    assert.deepEqual(r, { runId: 'abc', datasetId: 'abc' });
    assert.equal(v.url, 'http://coletor:8090/v1/jobs');
    assert.deepEqual(JSON.parse(v.init.body), { handle: 'clinica', max_seguidores: 80 });
    assert.equal(v.init.headers.Authorization, 'Bearer s3');
  });

  test('sem segredo configurado não manda Authorization; recusa vira erro', async () => {
    let h;
    const api = coletorApi({ baseUrl: 'http://c', fetch: async (u, init) => { h = init.headers; return resp(422, { erro: 'handle inválido' }); } });
    await assert.rejects(api.iniciar('x', { username: 'a b', maxItems: 5 }, { maxTotalChargeUsd: 1, timeoutS: 60 }), /422.*handle inválido/);
    assert.equal(h.Authorization, undefined);
  });

  test('execucao: status nos nomes da Apify, mensagem, 404 = null, status ausente = FAILED', async () => {
    assert.deepEqual(await coletorApi({ baseUrl: 'http://c', fetch: async () => resp(200, { status: 'FAILED', mensagem: 'checkpoint', total: 3 }) }).execucao('j'), { status: 'FAILED', gastoUsd: null, statusMessage: 'checkpoint' });
    assert.equal(await coletorApi({ baseUrl: 'http://c', fetch: async () => resp(404, {}) }).execucao('j'), null);
    assert.equal((await coletorApi({ baseUrl: 'http://c', fetch: async () => resp(200, {}) }).execucao('j')).status, 'FAILED');
  });

  test('itens por offset/limit; abortar tolera 404', async () => {
    let url;
    assert.deepEqual(await coletorApi({ baseUrl: 'http://c', fetch: async (u) => { url = u; return resp(200, [{ username: 'a' }]); } }).itens('j', 10, 5), [{ username: 'a' }]);
    assert.equal(new URL(url).searchParams.get('offset'), '10');
    assert.deepEqual(await coletorApi({ baseUrl: 'http://c', fetch: async () => resp(404, {}) }).itens('j', 0, 5), []);
    await coletorApi({ baseUrl: 'http://c', fetch: async () => resp(404, {}) }).abortar('j');
    await assert.rejects(coletorApi({ baseUrl: 'http://c', fetch: async () => resp(500, {}) }).abortar('j'), /500/);
  });
});

describe('plano de prazo do coletor com login real', () => {
  const cfg = { actorId: 'coletor', ...CFG_INSTAGRAM_SESSAO_PADRAO };
  test('o prazo é o ritmo da conta: contas × segundos, com piso e teto', () => {
    assert.equal(planoDaBusca(100, cfg).maxItems, 800);
    assert.equal(planoDaBusca(100, cfg).timeoutS, 7_200, '800 contas × 9 s');
    assert.equal(planoDaBusca(1, cfg).timeoutS, 450, '50 contas × 9 s');
    assert.equal(planoDaBusca(100_000, { ...cfg, maxSeguidores: 100_000 }).timeoutS, 6 * 3_600, 'teto de 6 h');
  });
  test('sem custo em dólar a configuração padrão do coletor não promete freio de gasto', () => {
    assert.equal(CFG_INSTAGRAM_SESSAO_PADRAO.precoPorSeguidorUsd, 0);
  });
  test('o plano da Apify não mudou', () => assert.equal(planoDaBusca(100, { actorId: 'a', ...CFG_INSTAGRAM_PADRAO }).timeoutS, 720));
});

// ── o serviço Python de verdade ────────────────────────────────────────────
function acharPython() {
  for (const cmd of [process.env.LF_PYTHON, 'python3', 'python']) {
    if (!cmd) continue;
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && /Python 3\.(9|1\d)/.test(`${r.stdout}${r.stderr}`)) return cmd;
  }
  return null;
}

const bancoMemoria = () => {
  const reg = { registrados: [], encerrar: [], progressos: [] };
  return {
    reg,
    banco: {
      progresso: async (b, w, p) => { reg.progressos.push(p); return 'executando'; },
      registrar: async (b, w, itens) => { reg.registrados.push(...itens); return { aceitos: itens.length, limite_atingido: false, ativa: true }; },
      encerrar: async (b, w, s, e) => { reg.encerrar.push([s, e ?? null]); },
      reivindicar: async () => null, recuperarTravadas: async () => 0,
    },
  };
};

describe('worker contra o serviço Python (contrato JSON de ponta a ponta)', () => {
  const py = acharPython();

  async function subir(t) {
    const proc = spawn(py, ['-m', 'tests.servidor_de_teste'], { cwd: new URL('../../services/instagram-coletor/', import.meta.url), stdio: ['pipe', 'pipe', 'inherit'] });
    t.after(() => { proc.stdin.end(); proc.kill(); });
    return await new Promise((resolve, reject) => {
      let buf = '';
      proc.stdout.on('data', (d) => { buf += d; const m = buf.match(/PORT (\d+)/); if (m) resolve(Number(m[1])); });
      proc.on('exit', (c) => reject(new Error(`serviço Python saiu: ${c}`)));
      setTimeout(() => reject(new Error('serviço Python não subiu')), 15_000);
    });
  }

  test('segredo errado é recusado (401)', { skip: py ? false : 'python 3.9+ não encontrado' }, async (t) => {
    const porta = await subir(t);
    const api = coletorApi({ baseUrl: `http://127.0.0.1:${porta}`, segredo: 'errado' });
    await assert.rejects(api.iniciar('x', { username: 'alvo', maxItems: 5 }, { maxTotalChargeUsd: 1, timeoutS: 60 }), /401/);
  });

  test('busca de Instagram: o worker lê o que o coletor entrega, na ordem, e cobra só quem tem contato', { skip: py ? false : 'python 3.9+ não encontrado' }, async (t) => {
    const porta = await subir(t);
    const api = coletorApi({ baseUrl: `http://127.0.0.1:${porta}`, segredo: 'segredo-de-teste' });
    const m = bancoMemoria();
    const logs = [];
    const amb = {
      banco: m.banco, gosom: null, ia: null,
      site: async () => ({ emails: [], whatsapps: [], telefones: [] }),
      mx: async () => true,
      esperar: async () => { await new Promise((r) => setTimeout(r, 30)); },
      agora: () => Date.now(), abortar: () => false, log: (e, d) => logs.push([e, d]),
    };
    const busca = { id: 'bi', organization_id: 'o', fonte: 'instagram', nicho: null, cidade: null, instagram_handle: 'clinicaodontovida', creditos_limite: 10, creditos_usados: 0 };
    await executarBusca(busca, fonteInstagram(busca, api, { actorId: 'coletor', ...CFG_INSTAGRAM_SESSAO_PADRAO }, amb.log), amb, { ...CFG_PADRAO, workerId: 'w1', pollMs: 30 });

    assert.deepEqual(m.reg.encerrar, [['concluida', null]]);
    assert.deepEqual(m.reg.registrados.map((r) => r.ref_externa), ['ana.dentista', 'caio.zap'], 'a privada e a sem contato não são cobradas, na ordem da lista');
    const ana = m.reg.registrados[0];
    assert.equal(ana.email, 'ana@clinica.com.br');
    assert.equal(ana.instagram, 'Ana.Dentista', 'o @ com a caixa do perfil');
    assert.equal(ana.categoria, 'Dentista');
    assert.equal(ana.site, 'https://clinica.com.br');
    assert.equal(m.reg.registrados[1].telefone, '5511993195517', 'telefone do botão de contato, normalizado');
    const p = m.reg.progressos.at(-1);
    assert.equal(p.encontrados, 4);
    assert.equal(p.semContato, 2, 'a privada e a sem contato');
  });

  test('parar a busca aborta o job no coletor', { skip: py ? false : 'python 3.9+ não encontrado' }, async (t) => {
    const porta = await subir(t);
    const api = coletorApi({ baseUrl: `http://127.0.0.1:${porta}`, segredo: 'segredo-de-teste' });
    const { runId } = await api.iniciar('x', { username: 'alvo', maxItems: 800 }, { maxTotalChargeUsd: 1, timeoutS: 60 });
    await api.abortar(runId);
    // O job do servidor de teste é instantâneo: já terminou, e abortar um job terminado é inofensivo.
    for (let i = 0; i < 50; i++) {
      const e = await api.execucao(runId);
      if (e.status !== 'RUNNING') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.notEqual((await api.execucao(runId)).status, 'RUNNING');
    assert.equal(await api.execucao('0'.repeat(32)), null, 'job desconhecido = null (o worker conclui com o que já ingeriu)');
  });
});
