// Lista Fria · Instagram (Apify) — mapeamento dos campos, cliente da API, plano de
// custo, fluxo pelo executor e as RPCs reais (PGlite).
//
// Os campos do Actor são os do README dele (build lido na API pública da Apify em
// 27/10/2026). Os testes usam esse contrato documentado; a validação contra a
// execução real exige APIFY_TOKEN (services/lista-fria-worker/validar-contra-apify.ts).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { candidatoDoItem, telefonesDaBio, ACTOR_PADRAO } from '../../services/lista-fria-worker/src/instagram.ts';
import { abortarExecucao, execucaoTerminou, iniciarExecucao, lerExecucao, lerItens } from '../../services/lista-fria-worker/src/apify.ts';
import { CFG_INSTAGRAM_PADRAO, cfgInstagramDaApify, fonteInstagram, planoDaBusca, tetoDeSeguidores } from '../../services/lista-fria-worker/src/fonte-instagram.ts';
import { CFG_PADRAO, executarBusca } from '../../services/lista-fria-worker/src/executor.ts';
import { U_LIBERADO, as, asWorker, asPostgres, one, val, criarBusca, comSaldo, setup } from './helpers/lista-fria-db.mjs';

// ── candidatoDoItem ────────────────────────────────────────────────────────
// Item de exemplo do README do Actor (modo enriched).
const EXEMPLO = {
  username: 'designstudio_co', full_name: 'Design Studio', is_verified: false, is_private: false, enrichment_status: 'success',
  public_email: 'hello@designstudio.co', biography_email: null, contact_phone_number: null, external_url: 'https://designstudio.co',
  bio_links: [{ title: 'Portfolio', url: 'https://designstudio.co/work' }], biography: 'Brand design for startups ✦ 200+ clients',
  category: 'Graphic Designer', is_business: true, follower_count: 12400, account_type: 2, country: 'United Kingdom',
  email_found: 'hello@designstudio.co', email_source: 'public_email', email_verified: 'not_requested',
};

describe('candidatoDoItem (campos do Actor)', () => {
  test('item do README: e-mail do perfil, site, categoria; sem telefone', () => {
    const c = candidatoDoItem(EXEMPLO);
    assert.deepEqual(c, {
      ref: 'designstudio_co', titulo: 'Design Studio', categoria: 'Graphic Designer', endereco: 'United Kingdom', bairro: null,
      telefone: null, site: 'https://designstudio.co', emails: ['hello@designstudio.co'], situacao: null, instagram: 'designstudio_co',
    });
  });

  test('telefone: botão de contato, WhatsApp de link e bio; o celular vence o fixo', () => {
    assert.equal(candidatoDoItem({ ...EXEMPLO, contact_phone_number: '+55 11 3081-9404', bio_links: [{ url: 'https://wa.me/5511993195517?text=oi' }] }).telefone, '5511993195517');
    assert.equal(candidatoDoItem({ ...EXEMPLO, contact_phone_number: '(11) 3081-9404' }).telefone, '551130819404');
    assert.equal(candidatoDoItem({ ...EXEMPLO, external_url: 'https://api.whatsapp.com/send?phone=5511993195517' }).telefone, '5511993195517');
    assert.equal(candidatoDoItem({ ...EXEMPLO, biography: 'Agende: (11) 99319-5517 | Rua X' }).telefone, '5511993195517');
  });

  test('public_phone_number (campo real do Actor) também vira telefone', () => {
    assert.equal(candidatoDoItem({ ...EXEMPLO, contact_phone_number: null, public_phone_number: '11993195517' }).telefone, '5511993195517');
    assert.equal(candidatoDoItem({ ...EXEMPLO, contact_phone_number: null, public_phone_number: '(11) 3081-9404' }).telefone, '551130819404');
    assert.equal(candidatoDoItem({ ...EXEMPLO, contact_phone_number: null, public_phone_number: '12345' }).telefone, null);
  });

  test('wa.me não é site; o primeiro link comum vira o site', () => {
    const c = candidatoDoItem({ ...EXEMPLO, external_url: 'https://wa.me/5511993195517', bio_links: [{ url: 'https://wa.me/5511993195517' }, { url: 'https://clinica.com.br/' }] });
    assert.equal(c.site, 'https://clinica.com.br/');
  });

  test('e-mails: perfil, bio, e o melhor das fontes; sem repetir e sem lixo', () => {
    const c = candidatoDoItem({ ...EXEMPLO, public_email: 'Contato@X.com.br', biography_email: 'contato@x.com.br', email_found: 'logo@2x.png', biography: 'escreva: vendas@x.com.br' });
    assert.deepEqual(c.emails, ['contato@x.com.br', 'vendas@x.com.br']);
  });

  test('conta privada pulada vem sem contato (vira "sem contato", não some)', () => {
    const c = candidatoDoItem({ username: 'ana', full_name: '', is_private: true, enrichment_status: 'skipped_private', public_email: null, contact_phone_number: null, bio_links: null });
    assert.equal(c.titulo, 'ana');
    assert.equal(c.telefone, null);
    assert.deepEqual(c.emails, []);
  });

  test('@ inválido ou ausente não entra (o banco recusaria o lote inteiro)', () => {
    for (const username of [undefined, null, '', 'dois nomes', 'a'.repeat(31), 'com/barra', "x'; drop"]) {
      assert.equal(candidatoDoItem({ ...EXEMPLO, username }), null, String(username));
    }
    assert.equal(candidatoDoItem({ ...EXEMPLO, username: 'Clinica.Odonto_1' }).ref, 'clinica.odonto_1');
    assert.equal(candidatoDoItem({ ...EXEMPLO, username: 'Clinica.Odonto_1' }).instagram, 'Clinica.Odonto_1');
  });

  test('campos com tipo inesperado não quebram', () => {
    const c = candidatoDoItem({ username: 'ok', bio_links: 'texto', public_email: 42, contact_phone_number: {}, external_url: ['x'], biography: 7 });
    assert.deepEqual(c.emails, []);
    assert.equal(c.telefone, null);
  });
});

describe('telefonesDaBio', () => {
  test('só número com separador; id, data e valor soltos não viram telefone', () => {
    assert.deepEqual(telefonesDaBio('Whats (11) 99319-5517 ou 11 3081-9404'), ['5511993195517', '551130819404']);
    assert.deepEqual(telefonesDaBio('desde 2019 | cnpj 12345678 | R$ 11999990000 | 99999999'), []);
    assert.deepEqual(telefonesDaBio(null), []);
  });
});

// ── cliente da Apify ───────────────────────────────────────────────────────
describe('cliente da Apify', () => {
  const resp = (status, corpo) => new Response(JSON.stringify(corpo), { status });

  test('iniciar: Bearer no header (token fora da URL), freio de custo e timeout na query, input no corpo', async () => {
    let visto;
    const r = await iniciarExecucao({ token: 'tok', fetch: async (url, init) => { visto = { url, init }; return resp(201, { data: { id: 'run1', defaultDatasetId: 'ds1' } }); } },
      'data-slayer~instagram-followers-scraper---no-login', { username: 'x', mode: 'enriched' }, { maxTotalChargeUsd: 11.05, timeoutS: 720.9 });
    assert.deepEqual(r, { runId: 'run1', datasetId: 'ds1' });
    const u = new URL(visto.url);
    assert.equal(u.origin + u.pathname, 'https://api.apify.com/v2/acts/data-slayer~instagram-followers-scraper---no-login/runs');
    assert.equal(u.searchParams.get('maxTotalChargeUsd'), '11.05');
    assert.equal(u.searchParams.get('timeout'), '720');
    assert.ok(!visto.url.includes('tok'), 'o token não pode ir na URL (vai para log)');
    assert.equal(visto.init.headers.Authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(visto.init.body), { username: 'x', mode: 'enriched' });
  });

  test('iniciar: erro da API e resposta sem id viram erro', async () => {
    await assert.rejects(iniciarExecucao({ token: 't', fetch: async () => resp(402, { error: { message: 'limite' } }) }, 'a~b', {}, { maxTotalChargeUsd: 1, timeoutS: 60 }), /402/);
    await assert.rejects(iniciarExecucao({ token: 't', fetch: async () => resp(201, { data: {} }) }, 'a~b', {}, { maxTotalChargeUsd: 1, timeoutS: 60 }), /id da execução/);
  });

  test('lerExecucao: status, gasto e 404', async () => {
    assert.deepEqual(await lerExecucao({ token: 't', fetch: async () => resp(200, { data: { status: 'RUNNING', usageTotalUsd: 0.42, statusMessage: 'ok' } }) }, 'r'), { status: 'RUNNING', gastoUsd: 0.42, statusMessage: 'ok' });
    assert.equal(await lerExecucao({ token: 't', fetch: async () => resp(404, {}) }, 'r'), null);
    assert.equal((await lerExecucao({ token: 't', fetch: async () => resp(200, { data: {} }) }, 'r')).status, 'FAILED', 'sem status = falha, nunca "rodando"');
  });

  test('execucaoTerminou: só os quatro terminais', () => {
    for (const s of ['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED']) assert.equal(execucaoTerminou(s), true, s);
    for (const s of ['READY', 'RUNNING', 'ABORTING', 'TIMING-OUT']) assert.equal(execucaoTerminou(s), false, s);
  });

  test('lerItens: offset/limit na query; 404 = vazio; resposta que não é lista = vazio', async () => {
    let url;
    assert.deepEqual(await lerItens({ token: 't', fetch: async (u) => { url = u; return new Response('[{"username":"a"}]', { status: 200 }); } }, 'ds', 100, 50), [{ username: 'a' }]);
    assert.equal(new URL(url).searchParams.get('offset'), '100');
    assert.equal(new URL(url).searchParams.get('limit'), '50');
    assert.deepEqual(await lerItens({ token: 't', fetch: async () => new Response('', { status: 404 }) }, 'ds', 0), []);
    assert.deepEqual(await lerItens({ token: 't', fetch: async () => new Response('{"erro":1}', { status: 200 }) }, 'ds', 0), []);
  });

  test('abortar tolera "já terminou" (400/404) e falha em erro de verdade', async () => {
    await abortarExecucao({ token: 't', fetch: async () => new Response('', { status: 400 }) }, 'r');
    await abortarExecucao({ token: 't', fetch: async () => new Response('', { status: 404 }) }, 'r');
    await assert.rejects(abortarExecucao({ token: 't', fetch: async () => new Response('', { status: 500 }) }, 'r'), /500/);
  });
});

// ── plano de custo ─────────────────────────────────────────────────────────
describe('planoDaBusca', () => {
  const cfg = { actorId: ACTOR_PADRAO, ...CFG_INSTAGRAM_PADRAO, maxSeguidores: 5_000 };
  test('o padrão real: o acesso sem login entrega ~50 seguidores por conta, então o plano não pede mais (medido)', () => {
    const p = planoDaBusca(100, { actorId: ACTOR_PADRAO, ...CFG_INSTAGRAM_PADRAO });
    assert.deepEqual(p, { maxItems: 50, maxPages: 1, maxTotalChargeUsd: 0.7, timeoutS: 1000 });
    assert.equal(CFG_INSTAGRAM_PADRAO.maxSeguidores, 50);
  });
  test('100 créditos: 800 contas, 16 páginas, prazo de 20 s por conta, freio de custo com folga de 15%', () => {
    assert.deepEqual(planoDaBusca(100, cfg), { maxItems: 800, maxPages: 16, maxTotalChargeUsd: 11.05, timeoutS: 16_000 });
  });
  test('piso: 1 crédito ainda processa uma página inteira', () => assert.deepEqual(planoDaBusca(1, cfg).maxItems, 50));
  test('teto: busca enorme é limitada em contas E em dólares', () => {
    const p = planoDaBusca(100_000, cfg);
    assert.equal(p.maxItems, 5_000);
    assert.equal(p.maxTotalChargeUsd, 25, 'US$ 25 por busca, mesmo que a conta pedisse US$ 69');
    assert.ok(p.timeoutS <= 6 * 3_600, 'o prazo tem teto de 6 h');
  });
  test('o freio nunca passa do teto configurado', () => {
    for (const c of [1, 10, 50, 100, 500, 5_000, 1e6]) assert.ok(planoDaBusca(c, { ...cfg, maxUsdPorBusca: 5 }).maxTotalChargeUsd <= 5);
  });
});

// ── fluxo (api falsa) ──────────────────────────────────────────────────────
function apiFalsa({ passos, itensPorPasso = null }) {
  // passos[i] = { status, itens: [...] } — `itens` é o dataset ACUMULADO nesse passo.
  const reg = { iniciou: null, abortou: 0, lidoOffsets: [] };
  let i = -1;
  const atual = () => passos[Math.min(Math.max(i, 0), passos.length - 1)];
  return {
    reg,
    avancar: () => { i++; },
    api: {
      iniciar: async (actor, input, opcoes) => { reg.iniciou = { actor, input, opcoes }; return { runId: 'run1', datasetId: 'ds1' }; },
      execucao: async () => ({ status: atual().status, gastoUsd: 0.5, statusMessage: null }),
      itens: async (ds, offset, limit) => { reg.lidoOffsets.push(offset); return atual().itens.slice(offset, offset + limit); },
      abortar: async () => { reg.abortou++; },
    },
  };
}

function ambiente({ banco, fa, abortarEm = Infinity }) {
  const logs = [];
  let relogio = 0;
  return {
    logs,
    amb: {
      banco, gosom: null, ia: null,
      site: async () => ({ emails: [], whatsapps: [], telefones: [] }),
      mx: async () => true,
      esperar: async () => { fa.avancar(); relogio += 5_000; },
      agora: () => relogio,
      abortar: () => false,
      log: (e, d) => logs.push([e, d]),
    },
  };
}

// `varrer`: null = banco antigo, sem a RPC (o worker segue sem cobrança por varredura). Passe uma função para
// simular o banco novo; `reg.varreduras` guarda o que o worker informou.
const bancoMemoria = ({ limiteAposItens = Infinity, varrer = null } = {}) => {
  const reg = { registrados: [], encerrar: [], progressos: [], varreduras: [] };
  return {
    reg,
    banco: {
      progresso: async (b, w, p) => { reg.progressos.push(p); return 'executando'; },
      registrar: async (b, w, itens) => {
        const cabem = Math.max(0, limiteAposItens - reg.registrados.length);
        reg.registrados.push(...itens.slice(0, cabem));
        return { aceitos: Math.min(cabem, itens.length), limite_atingido: reg.registrados.length >= limiteAposItens, ativa: true };
      },
      encerrar: async (b, w, s, e) => { reg.encerrar.push([s, e ?? null]); },
      varrer: async (b, w, varridos, custoUsd) => {
        reg.varreduras.push([varridos, custoUsd]);
        return varrer ? varrer(varridos, custoUsd) : null;
      },
      reivindicar: async () => null, recuperarTravadas: async () => 0,
    },
  };
};

const BUSCA_IG = { id: 'bi', organization_id: 'o', fonte: 'instagram', nicho: null, cidade: null, instagram_handle: 'clinicaodontovida', creditos_limite: 100, creditos_usados: 0 };
const CFG = { ...CFG_PADRAO, workerId: 'w1', pollMs: 5_000, lote: 50 };
// O padrão real limita a 50 seguidores (teto medido do acesso sem login). Aqui o teto é alto de propósito:
// os testes exercitam o dimensionamento do plano, não o limite do Instagram.
const cfgIg = { actorId: ACTOR_PADRAO, ...CFG_INSTAGRAM_PADRAO, maxSeguidores: 5_000 };
const perfil = (username, extra = {}) => ({ username, full_name: `Nome ${username}`, enrichment_status: 'success', ...extra });

describe('executarBusca com a fonte Instagram', () => {
  test('inicia o Actor com o @ certo e o plano de custo; ingere só o novo a cada volta; conclui sem abortar', async () => {
    const A = perfil('ana', { public_email: 'ana@bom.com.br' });
    const B = perfil('bia', { contact_phone_number: '(11) 99319-5517' });
    const C = perfil('caio');                                   // sem contato
    const D = perfil('dani', { enrichment_status: 'skipped_private' });
    const fa = apiFalsa({ passos: [
      { status: 'RUNNING', itens: [A, B] },
      { status: 'RUNNING', itens: [A, B, C] },
      { status: 'SUCCEEDED', itens: [A, B, C, D] },
    ] });
    const m = bancoMemoria();
    const { amb } = ambiente({ banco: m.banco, fa });
    await executarBusca(BUSCA_IG, fonteInstagram(BUSCA_IG, fa.api, cfgIg, amb.log), amb, CFG);

    assert.equal(fa.reg.iniciou.actor, 'data-slayer~instagram-followers-scraper---no-login');
    assert.deepEqual(fa.reg.iniciou.input, { username: 'clinicaodontovida', mode: 'enriched', maxPages: 16, maxItems: 800 });
    assert.equal(fa.reg.iniciou.opcoes.maxTotalChargeUsd, 11.05);
    assert.deepEqual(m.reg.registrados.map((r) => r.ref_externa), ['ana', 'bia'], 'só quem tem contato é cobrado');
    assert.equal(m.reg.registrados[0].instagram, 'ana');
    assert.equal(m.reg.registrados[0].email, 'ana@bom.com.br');
    assert.equal(m.reg.registrados[1].telefone, '5511993195517');
    assert.deepEqual(fa.reg.lidoOffsets, [0, 2, 3], 'lê o dataset por offset, sem reler o que já veio');
    assert.deepEqual(m.reg.encerrar, [['concluida', null]]);
    assert.equal(fa.reg.abortou, 0, 'execução já terminada não é abortada');
    const p = m.reg.progressos.at(-1);
    assert.equal(p.encontrados, 4);
    assert.equal(p.semContato, 2, 'o sem contato e a conta privada');
  });

  test('limite de créditos: aborta a execução na Apify (para de gastar) e encerra como parada', async () => {
    const itens = ['a', 'b', 'c', 'd'].map((u) => perfil(u, { public_email: `${u}@bom.com.br` }));
    const fa = apiFalsa({ passos: [{ status: 'RUNNING', itens }, { status: 'RUNNING', itens }] });
    const m = bancoMemoria({ limiteAposItens: 2 });
    const { amb } = ambiente({ banco: m.banco, fa });
    await executarBusca({ ...BUSCA_IG, creditos_limite: 2 }, fonteInstagram({ ...BUSCA_IG, creditos_limite: 2 }, fa.api, cfgIg, amb.log), amb, CFG);
    assert.deepEqual(m.reg.encerrar, [['parada', null]]);
    assert.equal(fa.reg.abortou, 1, 'ainda RUNNING: abortar é o que impede o gasto seguinte');
    assert.equal(m.reg.registrados.length, 2);
  });

  test('o usuário parou a busca: aborta a execução e não encerra (o banco já fechou)', async () => {
    const fa = apiFalsa({ passos: [{ status: 'RUNNING', itens: [perfil('a', { public_email: 'a@bom.com.br' })] }] });
    const m = bancoMemoria();
    m.banco.registrar = async () => ({ aceitos: 0, limite_atingido: false, ativa: false });
    const { amb } = ambiente({ banco: m.banco, fa });
    await executarBusca(BUSCA_IG, fonteInstagram(BUSCA_IG, fa.api, cfgIg, amb.log), amb, CFG);
    assert.deepEqual(m.reg.encerrar, []);
    assert.equal(fa.reg.abortou, 1);
  });

  test('Actor falhou: sem nenhum item a busca falha (devolve a reserva); com itens, conclui', async () => {
    const vazio = apiFalsa({ passos: [{ status: 'FAILED', itens: [] }] });
    const m1 = bancoMemoria();
    const a1 = ambiente({ banco: m1.banco, fa: vazio });
    await executarBusca(BUSCA_IG, fonteInstagram(BUSCA_IG, vazio.api, cfgIg, a1.amb.log), a1.amb, CFG);
    assert.deepEqual(m1.reg.encerrar, [['falhou', 'coletor_falhou']]);

    const parcial = apiFalsa({ passos: [{ status: 'TIMED-OUT', itens: [perfil('a', { public_email: 'a@bom.com.br' })] }] });
    const m2 = bancoMemoria();
    const a2 = ambiente({ banco: m2.banco, fa: parcial });
    await executarBusca(BUSCA_IG, fonteInstagram(BUSCA_IG, parcial.api, cfgIg, a2.amb.log), a2.amb, CFG);
    assert.deepEqual(m2.reg.encerrar, [['concluida', null]]);
  });

  test('erro ao iniciar (ex.: sem crédito na Apify): encerra como falhou com a mensagem', async () => {
    const m = bancoMemoria();
    const fa = apiFalsa({ passos: [{ status: 'RUNNING', itens: [] }] });
    fa.api.iniciar = async () => { throw new Error('apify iniciar (402): limite mensal'); };
    const { amb } = ambiente({ banco: m.banco, fa });
    await executarBusca(BUSCA_IG, fonteInstagram(BUSCA_IG, fa.api, cfgIg, amb.log), amb, CFG);
    assert.equal(m.reg.encerrar[0][0], 'falhou');
    assert.match(m.reg.encerrar[0][1], /402/);
  });

  test('busca sem @ falha cedo, sem chamar a Apify', async () => {
    const m = bancoMemoria();
    const fa = apiFalsa({ passos: [{ status: 'RUNNING', itens: [] }] });
    const { amb } = ambiente({ banco: m.banco, fa });
    await executarBusca({ ...BUSCA_IG, instagram_handle: null }, fonteInstagram({ ...BUSCA_IG, instagram_handle: null }, fa.api, cfgIg, amb.log), amb, CFG);
    assert.equal(fa.reg.iniciou, null);
    assert.equal(m.reg.encerrar[0][0], 'falhou');
  });
});

// ── contra as RPCs reais ───────────────────────────────────────────────────
function bancoPglite(db) {
  const q = async (sql, params = []) => { await asWorker(db); return (await db.query(sql, params)).rows; };
  return {
    reivindicar: async (w) => (await q('SELECT * FROM lista_fria_worker_reivindicar($1)', [w]))[0] ?? null,
    progresso: async (b, w, p) => Object.values((await q('SELECT lista_fria_worker_progresso($1,$2,$3,$4,$5,$6,$7,$8)', [b, w, p.etapa, Math.round(p.progresso), p.encontrados, p.comTelefone, p.comEmail, p.semContato]))[0])[0],
    registrar: async (b, w, itens) => Object.values((await q('SELECT lista_fria_worker_registrar($1,$2,$3::jsonb)', [b, w, JSON.stringify(itens)]))[0])[0],
    encerrar: async (b, w, s, e) => { await q('SELECT lista_fria_worker_encerrar($1,$2,$3,$4)', [b, w, s, e ?? null]); },
    varrer: async (b, w, v, c) => Object.values((await q('SELECT lista_fria_worker_varrer($1,$2,$3,$4)', [b, w, v, c]))[0])[0],
    recuperarTravadas: async () => 0,
  };
}

describe('Instagram contra as RPCs reais', () => {
  test('busca antiga por contato: o formato que o worker manda (inclusive a coluna `instagram`) é o que o banco aceita; já-é-lead não cobra; limite devolve sobra', async () => {
    const db = await setup();
    try {
      await comSaldo(db, 100, 'meta');
      await asPostgres(db);
      await db.exec(`INSERT INTO leads (organization_id, name, phone) VALUES ('b2ad1ffb-e136-4356-846b-9f210f902573', 'Já cliente', '5511993195517')`);
      await as(db, U_LIBERADO);
      const id = await criarBusca(db, 'instagram', { url: 'https://www.instagram.com/clinicaodontovida/?hl=pt' }, 3);
      // Busca ANTIGA, cobrada por contato (criada antes da migration de varredura): a reserva era o que o cliente pedia.
      await asPostgres(db);
      await db.exec(`UPDATE lista_fria_buscas SET cobranca = 'por_contato', creditos_limite = 3 WHERE id = '${id}'`);
      await db.exec(`UPDATE lista_fria_creditos SET delta = -3 WHERE busca_id = '${id}' AND motivo = 'reserva'`);
      await as(db, U_LIBERADO);

      const itens = [
        perfil('ana', { public_email: 'ana@bom.com.br', category: 'Dentista' }),
        perfil('bia', { contact_phone_number: '(11) 99319-5517' }),                        // mesmo número do lead existente
        perfil('Caio.Silva_1', { biography: 'Whats (11) 99319-5518', external_url: 'https://caio.com.br' }),
        perfil('duda', { public_email: 'duda@bom.com.br' }),
        perfil('edu', { public_email: 'edu@bom.com.br' }),                                  // passa do limite de 3
        perfil('fabi'),
      ];
      const fa = apiFalsa({ passos: [{ status: 'SUCCEEDED', itens }] });
      const banco = bancoPglite(db);
      const { amb } = ambiente({ banco, fa });
      const busca = await banco.reivindicar('w1');
      assert.equal(busca.id, id);
      assert.equal(busca.instagram_handle, 'clinicaodontovida');
      await executarBusca(busca, fonteInstagram(busca, fa.api, cfgIg, amb.log), amb, { ...CFG, workerId: 'w1' });
      assert.equal(fa.reg.iniciou.input.username, 'clinicaodontovida');

      await asPostgres(db);
      const b = await one(db, `SELECT status, creditos_usados, ja_leads, sem_contato FROM lista_fria_buscas WHERE id = '${id}'`);
      assert.equal(b.status, 'parada', 'limite de 3 créditos (busca antiga, por contato)');
      assert.equal(b.creditos_usados, 3);
      assert.equal(b.ja_leads, 1);
      const r = (await db.query(`SELECT ref_externa, nome, telefone, email, instagram, categoria, qualidade, ja_e_lead FROM lista_fria_resultados WHERE busca_id = '${id}' ORDER BY ref_externa`)).rows;
      assert.deepEqual(r.map((x) => x.ref_externa), ['ana', 'bia', 'caio.silva_1', 'duda']);
      assert.equal(r.find((x) => x.ref_externa === 'ana').instagram, 'ana');
      assert.equal(r.find((x) => x.ref_externa === 'caio.silva_1').instagram, 'Caio.Silva_1', 'o @ original, com a caixa do perfil');
      assert.equal(r.find((x) => x.ref_externa === 'caio.silva_1').telefone, '5511993195518', 'telefone da bio');
      assert.equal(r.find((x) => x.ref_externa === 'bia').ja_e_lead, true);
      assert.equal(r.find((x) => x.ref_externa === 'ana').categoria, 'Dentista');
      assert.equal(await val(db, `SELECT private.lista_fria_saldo_da_org('b2ad1ffb-e136-4356-846b-9f210f902573', 'meta')`), 97); // 100 - 3 contatos
    } finally { await db.close(); }
  });
});

// ── cobrança por varredura (ADR-0046) ──────────────────────────────────────
const BUSCA_VAR = { ...BUSCA_IG, creditos_limite: 50, cobranca: 'por_varredura', seguidores_por_credito: 1 };
// O banco novo: debita pelo total informado e avisa quando a reserva acaba.
const varrerReal = (limite) => (varridos) => ({ ativa: true, cobrando: true, creditos_usados: Math.min(varridos, limite), limite_atingido: varridos >= limite });

describe('cfgInstagramDaApify (a fiação do main)', () => {
  test('SEM variáveis, a busca de 50 seguidores ganha 1.000 s: em produção o prazo caía em 300 s e a Apify matava a execução (TIMED-OUT) com 30 a 37 itens', () => {
    const cfg = cfgInstagramDaApify({});
    assert.equal(cfg.segundosPorConta, 20);
    assert.equal(planoDaBusca(50, cfg, 50).timeoutS, 1000);
    assert.ok(planoDaBusca(50, cfg, 50).timeoutS >= 50 * 10 * 1.5, 'folga sobre os ~10 s por conta medidos');
  });
  test('o ambiente sobrescreve cada valor; lixo cai no padrão', () => {
    const cfg = cfgInstagramDaApify({ INSTAGRAM_SEGUNDOS_POR_CONTA: '30', INSTAGRAM_MAX_SEGUIDORES: '200', APIFY_MAX_USD_POR_BUSCA: '2', APIFY_INSTAGRAM_ACTOR: 'a~b' });
    assert.deepEqual([cfg.segundosPorConta, cfg.maxSeguidores, cfg.maxUsdPorBusca, cfg.actorId], [30, 200, 2, 'a~b']);
    assert.equal(cfgInstagramDaApify({ INSTAGRAM_SEGUNDOS_POR_CONTA: 'abc', INSTAGRAM_MAX_SEGUIDORES: '' }).segundosPorConta, 20);
    assert.equal(cfgInstagramDaApify({ INSTAGRAM_MAX_SEGUIDORES: '' }).maxSeguidores, 50);
  });
});

describe('tetoDeSeguidores', () => {
  test('por varredura o crédito é o seguidor; por contato não há teto duro', () => {
    assert.equal(tetoDeSeguidores(BUSCA_VAR), 50);
    assert.equal(tetoDeSeguidores({ ...BUSCA_VAR, seguidores_por_credito: 2 }), 100, 'preço futuro: 2 seguidores por crédito');
    assert.equal(tetoDeSeguidores({ ...BUSCA_VAR, seguidores_por_credito: undefined }), 50);
    assert.equal(tetoDeSeguidores(BUSCA_IG), Infinity);
    assert.equal(tetoDeSeguidores({ ...BUSCA_IG, cobranca: 'por_contato' }), Infinity);
  });
  test('o plano pede à Apify exatamente a reserva, e o freio de custo acompanha', () => {
    assert.deepEqual(planoDaBusca(50, cfgIg, 50), { maxItems: 50, maxPages: 1, maxTotalChargeUsd: 0.7, timeoutS: 1000 });
  });
});

describe('executarBusca com a fonte Instagram, cobrada por varredura', () => {
  test('informa ao banco o TOTAL varrido a cada volta, com o custo real, e fecha com a medição final', async () => {
    const A = perfil('ana', { public_email: 'ana@bom.com.br' });
    const B = perfil('bia');
    const C = perfil('caio', { contact_phone_number: '(11) 99319-5517' });
    const D = perfil('dani', { enrichment_status: 'skipped_private' });
    const fa = apiFalsa({ passos: [
      { status: 'RUNNING', itens: [A, B] },
      { status: 'RUNNING', itens: [A, B, C] },
      { status: 'SUCCEEDED', itens: [A, B, C, D] },
    ] });
    const m = bancoMemoria({ varrer: varrerReal(50) });
    const { amb } = ambiente({ banco: m.banco, fa });
    await executarBusca(BUSCA_VAR, fonteInstagram(BUSCA_VAR, fa.api, cfgIg, amb.log), amb, CFG);

    assert.deepEqual(m.reg.varreduras, [[2, 0.5], [3, 0.5], [4, 0.5], [4, 0.5]], 'total acumulado (não o delta) e, no fim, a medição final');
    assert.deepEqual(fa.reg.iniciou.input, { username: 'clinicaodontovida', mode: 'enriched', maxPages: 1, maxItems: 50 });
    assert.deepEqual(m.reg.registrados.map((r) => r.ref_externa), ['ana', 'caio'], 'o contato entra, mas não é ele que se cobra');
    assert.deepEqual(m.reg.encerrar, [['concluida', null]]);
    assert.equal(fa.reg.abortou, 0);
  });

  test('a reserva acaba: lê SÓ o que foi pago, aborta a execução na Apify e conclui (não é falha nem "parada")', async () => {
    const itens = Array.from({ length: 10 }, (_, n) => perfil(`u${n}`, { public_email: `u${n}@bom.com.br` }));
    const fa = apiFalsa({ passos: [{ status: 'RUNNING', itens }, { status: 'RUNNING', itens }] });
    const busca = { ...BUSCA_VAR, creditos_limite: 4 };
    const m = bancoMemoria({ varrer: varrerReal(4) });
    const { amb } = ambiente({ banco: m.banco, fa });
    await executarBusca(busca, fonteInstagram(busca, fa.api, cfgIg, amb.log), amb, CFG);

    assert.equal(m.reg.registrados.length, 4, 'os 6 itens a mais que a Apify já tinha NÃO entram: o cliente não pagou por eles');
    assert.deepEqual(fa.reg.lidoOffsets, [0], 'nem chega a pedir o que passa da reserva');
    assert.equal(fa.reg.abortou, 1, 'ainda RUNNING: abortar é o que para o gasto');
    assert.deepEqual(m.reg.encerrar, [['concluida', null]]);
    assert.equal(m.reg.varreduras.at(-1)[0], 4);
  });

  test('o banco diz "acabou" no meio do lote: o executor registra o lote inteiro antes de terminar', async () => {
    const itens = Array.from({ length: 3 }, (_, n) => perfil(`u${n}`, { public_email: `u${n}@bom.com.br` }));
    const fa = apiFalsa({ passos: [{ status: 'RUNNING', itens }] });
    const busca = { ...BUSCA_VAR, creditos_limite: 3 };
    const m = bancoMemoria({ varrer: varrerReal(3) });
    const { amb } = ambiente({ banco: m.banco, fa });
    await executarBusca(busca, fonteInstagram(busca, fa.api, cfgIg, amb.log), amb, CFG);
    assert.equal(m.reg.registrados.length, 3);
  });

  test('banco ANTIGO (RPC ausente): segue sem cobrança por varredura e termina normalmente', async () => {
    const fa = apiFalsa({ passos: [{ status: 'SUCCEEDED', itens: [perfil('ana', { public_email: 'ana@bom.com.br' })] }] });
    const m = bancoMemoria(); // varrer devolve null
    const { amb } = ambiente({ banco: m.banco, fa });
    await executarBusca(BUSCA_VAR, fonteInstagram(BUSCA_VAR, fa.api, cfgIg, amb.log), amb, CFG);
    assert.deepEqual(m.reg.encerrar, [['concluida', null]]);
    assert.equal(m.reg.registrados.length, 1);
  });

  test('o usuário parou a busca no meio: a varredura devolve ativa=false, o worker aborta e não encerra', async () => {
    const fa = apiFalsa({ passos: [{ status: 'RUNNING', itens: [perfil('a', { public_email: 'a@bom.com.br' })] }] });
    const m = bancoMemoria({ varrer: () => ({ ativa: false, cobrando: false, creditos_usados: 0, limite_atingido: false }) });
    const { amb } = ambiente({ banco: m.banco, fa });
    await executarBusca(BUSCA_VAR, fonteInstagram(BUSCA_VAR, fa.api, cfgIg, amb.log), amb, CFG);
    assert.deepEqual(m.reg.encerrar, []);
    assert.equal(fa.reg.abortou, 1);
    assert.deepEqual(m.reg.registrados, [], 'nada é registrado depois de parada');
  });

  test('busca ANTIGA por contato: continua informando varridos (auditoria) e o limite segue sendo o do banco por contato', async () => {
    const itens = ['a', 'b', 'c', 'd'].map((u) => perfil(u, { public_email: `${u}@bom.com.br` }));
    const fa = apiFalsa({ passos: [{ status: 'RUNNING', itens }, { status: 'RUNNING', itens }] });
    const m = bancoMemoria({ limiteAposItens: 2, varrer: () => ({ ativa: true, cobrando: false, creditos_usados: 0, limite_atingido: false }) });
    const { amb } = ambiente({ banco: m.banco, fa });
    const antiga = { ...BUSCA_IG, creditos_limite: 2 };
    await executarBusca(antiga, fonteInstagram(antiga, fa.api, cfgIg, amb.log), amb, CFG);
    assert.deepEqual(m.reg.encerrar, [['parada', null]]);
    assert.equal(m.reg.varreduras[0][0], 4, 'lê tudo (sem teto duro) e só audita');
  });

  test('falha ao medir o custo final não derruba o encerramento', async () => {
    const fa = apiFalsa({ passos: [{ status: 'SUCCEEDED', itens: [perfil('ana', { public_email: 'ana@bom.com.br' })] }] });
    const m = bancoMemoria({ varrer: varrerReal(50) });
    const original = m.banco.varrer;
    let chamadas = 0;
    m.banco.varrer = async (...a) => { if (++chamadas > 1) throw new Error('rede caiu'); return original(...a); };
    const { amb, logs } = ambiente({ banco: m.banco, fa });
    await executarBusca(BUSCA_VAR, fonteInstagram(BUSCA_VAR, fa.api, cfgIg, amb.log), amb, CFG);
    assert.deepEqual(m.reg.encerrar, [['concluida', null]]);
    assert.ok(logs.some(([e]) => e === 'medicao_falhou'));
  });
});

describe('Instagram por varredura contra as RPCs reais', () => {
  const perfis = [
    perfil('ana', { public_email: 'ana@bom.com.br', category: 'Dentista' }),
    perfil('bia', { contact_phone_number: '(11) 99319-5517' }), // mesmo número do lead existente
    perfil('Caio.Silva_1', { biography: 'Whats (11) 99319-5518' }),
    perfil('duda', { public_email: 'duda@bom.com.br' }),
    perfil('edu', { public_email: 'edu@bom.com.br' }),
    perfil('fabi'),
  ];
  const rodar = async (db, itens) => {
    await as(db, U_LIBERADO);
    const id = await criarBusca(db, 'instagram', { url: 'https://www.instagram.com/clinicaodontovida/' }, 3);
    const fa = apiFalsa({ passos: [{ status: 'SUCCEEDED', itens }] });
    const banco = bancoPglite(db);
    const { amb } = ambiente({ banco, fa });
    const busca = await banco.reivindicar('w1');
    assert.equal(busca.id, id);
    assert.deepEqual([busca.cobranca, busca.creditos_limite, busca.seguidores_por_credito], ['por_varredura', 50, 1], 'a fila entrega o modo e a reserva ao worker');
    await executarBusca(busca, fonteInstagram(busca, fa.api, cfgIg, amb.log), amb, { ...CFG, workerId: 'w1' });
    await asPostgres(db);
    return id;
  };
  const META = `SELECT private.lista_fria_saldo_da_org('b2ad1ffb-e136-4356-846b-9f210f902573', 'meta')`;

  test('6 seguidores: paga 6 créditos Meta; todos os contatos entram; a sobra volta; o custo real fica gravado', async () => {
    const db = await setup();
    try {
      await comSaldo(db, 100, 'meta');
      await asPostgres(db);
      await db.exec(`INSERT INTO leads (organization_id, name, phone) VALUES ('b2ad1ffb-e136-4356-846b-9f210f902573', 'Já cliente', '5511993195517')`);
      const id = await rodar(db, perfis);
      const b = await one(db, `SELECT status, creditos_usados, varridos, contatos_novos, ja_leads, (SELECT custo_usd::float FROM lista_fria_busca_custos WHERE busca_id = b.id) AS custo FROM lista_fria_buscas b WHERE id = '${id}'`);
      assert.deepEqual(b, { status: 'concluida', creditos_usados: 6, varridos: 6, contatos_novos: 4, ja_leads: 1, custo: 0.5 });
      const r = (await db.query(`SELECT ref_externa FROM lista_fria_resultados WHERE busca_id = '${id}' ORDER BY ref_externa`)).rows;
      assert.deepEqual(r.map((x) => x.ref_externa), ['ana', 'bia', 'caio.silva_1', 'duda', 'edu']);
      assert.equal(await val(db, META), 94, '100 - 6 seguidores varridos');
    } finally { await db.close(); }
  });

  test('6 seguidores e NENHUM contato: devolve metade (3) além da sobra', async () => {
    const db = await setup();
    try {
      await comSaldo(db, 100, 'meta');
      const id = await rodar(db, ['a', 'b', 'c', 'd', 'e', 'f'].map((u) => perfil(u)));
      const b = await one(db, `SELECT status, creditos_usados, varridos, contatos_novos FROM lista_fria_buscas WHERE id = '${id}'`);
      assert.deepEqual(b, { status: 'concluida', creditos_usados: 3, varridos: 6, contatos_novos: 0 });
      assert.equal(await val(db, `SELECT count(*)::int FROM lista_fria_resultados WHERE busca_id = '${id}'`), 0);
      assert.equal(await val(db, META), 97, '100 - 6 + 3');
    } finally { await db.close(); }
  });

  test('a Apify entrega 80 e a reserva é 50: o cliente paga 50, só 50 entram, e o resto não é lido', async () => {
    const db = await setup();
    try {
      await comSaldo(db, 100, 'meta');
      const muitos = Array.from({ length: 80 }, (_, n) => perfil(`u${n}`, { public_email: `u${n}@bom.com.br` }));
      const id = await rodar(db, muitos);
      const b = await one(db, `SELECT status, creditos_usados, varridos, contatos_novos FROM lista_fria_buscas WHERE id = '${id}'`);
      assert.deepEqual(b, { status: 'concluida', creditos_usados: 50, varridos: 50, contatos_novos: 50 });
      assert.equal(await val(db, META), 50);
    } finally { await db.close(); }
  });
});
