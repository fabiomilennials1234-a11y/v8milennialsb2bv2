// Lista Fria · o pulso do worker embrulha TODO método do banco (ADR-0046: `varrer` ficou de fora uma vez).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bancoPelaRede } from '../../services/lista-fria-worker/src/db.ts';
import { comPulso } from '../../services/lista-fria-worker/src/pulso.ts';

const banco = () => bancoPelaRede({ url: 'https://x.invalid', chaveDeServico: 'k', fetch: async () => new Response('null', { status: 200 }) });

test('o banco embrulhado tem exatamente os métodos do banco real (nenhum esquecido)', () => {
  const real = banco();
  const { banco: com } = comPulso(real);
  assert.deepEqual(Object.keys(com).sort(), Object.keys(real).sort());
  for (const m of ['reivindicar', 'progresso', 'registrar', 'encerrar', 'varrer', 'recuperarTravadas']) {
    assert.equal(typeof com[m], 'function', m);
  }
});

test('só renova o pulso quando o banco responde; erro do banco não renova', async () => {
  let t = 1_000;
  const falso = {
    varrer: async () => ({ ativa: true, cobrando: true, creditos_usados: 1, limite_atingido: false }),
    registrar: async () => { throw new Error('banco fora'); },
  };
  const { banco: com, ultimoContatoMs } = comPulso(falso, () => t);
  assert.equal(ultimoContatoMs(), 1_000);
  t = 5_000;
  assert.deepEqual(await com.varrer('b', 'w', 3, 0.1), { ativa: true, cobrando: true, creditos_usados: 1, limite_atingido: false });
  assert.equal(ultimoContatoMs(), 5_000, 'respondeu: renova');
  t = 9_000;
  await assert.rejects(com.registrar('b', 'w', []), /banco fora/);
  assert.equal(ultimoContatoMs(), 5_000, 'falhou: não renova');
});

test('a RPC ausente (banco antigo) vira null, e outro erro continua erro', async () => {
  const antigo = bancoPelaRede({ url: 'https://x.invalid', chaveDeServico: 'k', fetch: async () => new Response('{"code":"PGRST202"}', { status: 404 }) });
  assert.equal(await antigo.varrer('b', 'w', 3, 0.1), null);
  const quebrado = bancoPelaRede({ url: 'https://x.invalid', chaveDeServico: 'k', fetch: async () => new Response('boom', { status: 500 }) });
  await assert.rejects(quebrado.varrer('b', 'w', 3, 0.1), /500/);
});
