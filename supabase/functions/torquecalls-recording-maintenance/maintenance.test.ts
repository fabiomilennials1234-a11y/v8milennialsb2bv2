/**
 * O expurgo de 90 dias e o reenfileiramento da busca, como unidade
 * (Gravação S4, #1360 do PRD #1356).
 *
 * O QUE ESTES TESTES PROVAM — e o que deliberadamente NÃO provam
 * -------------------------------------------------------------
 * A POLÍTICA (quem venceu, quantas tentativas, com que espaçamento) mora no
 * banco e é provada em `supabase/tests/voip_recording_retention_test.sql`, com
 * pgTAP, contra as funções de verdade. Repeti-la aqui produziria duas cópias da
 * mesma regra divergindo em três meses.
 *
 * O que sobra para este arquivo é o que só existe do lado de fora do banco: a
 * ORDEM entre apagar e confirmar, e o fato de que o apagar é de verdade.
 *
 * SOBRE OS DUBLÊS — O DE ARMAZENAMENTO É UM ÍNDICE, NÃO UM CONTADOR
 * ----------------------------------------------------------------
 * Esta base já pagou o preço de dublê que aceita tudo: um que ignorava a lista
 * de colunas do `select` deixou passar mutante que quebrava todo o atendimento.
 * Aqui o dublê do armazenamento MANTÉM UM CONJUNTO de objetos, e o dublê do
 * banco RECUSA a confirmação enquanto o caminho ainda estiver nesse conjunto —
 * exatamente como `fn_voip_recording_purged` faz contra `storage.objects`.
 *
 * É isso que faz o mutante que mais importa morrer aqui também: tire a chamada
 * a `remove` de `runPurge` e o objeto continua no índice, a confirmação é
 * recusada, e `purged` fica em zero. Um dublê que só contasse chamadas ficaria
 * verde com o áudio intacto no bucket.
 */

import { assert, assertEquals } from "@std/assert";
import {
  RECORDING_BUCKET,
  type RecordingFetchArgs,
  type RecordingOutcome,
} from "../_shared/voip/recording.ts";
import {
  asMaintenanceStore,
  type MaintenanceStore,
  type PurgeCandidate,
  type RecordingIngest,
  runPurge,
  runRetryQueue,
} from "./maintenance.ts";

const ORG = "6030520a-2ca7-477d-be89-55758e2cd808";
const SID = "tc-sessao-1";
const CALL_A = "11111111-2222-3333-4444-555555555551";
const CALL_B = "11111111-2222-3333-4444-555555555552";
const TC_A = "0E65AD6F1122334455667788990011F1";
const path = (call: string) => `${ORG}/${call}.opus`;

// ─── dublês ─────────────────────────────────────────────────────────────────

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

interface FakeOpts {
  /** Vencidas que o banco vai apontar. */
  candidates?: PurgeCandidate[];
  /** Reivindicadas da fila de busca. */
  claims?: Array<Record<string, unknown>>;
  /** Objetos já no armazenamento, por caminho. */
  objects?: string[];
  /** Força erro no `remove`. */
  removeError?: { message: string };
  /**
   * O `remove` responde SEM erro e o objeto continua no índice.
   *
   * Não é hipótese de laboratório: é o que se vê quando o storage responde 200
   * sobre um caminho que ele não apagou. Sem este cenário, o contador
   * `refused` nunca é exercido — e foi medido: o mutante que aceita QUALQUER
   * desfecho da confirmação sobrevivia à suíte até este dublê existir.
   */
  removeLies?: boolean;
  /** Força erro na listagem de vencidas. */
  listError?: { message: string };
}

function fakeStore(opts: FakeOpts = {}) {
  // O ÍNDICE do armazenamento. É ele que decide se a confirmação passa —
  // exatamente como `storage.objects` decide no banco de verdade.
  const objects = new Set(opts.objects ?? []);
  const rpcs: RpcCall[] = [];
  const removeCalls: string[][] = [];
  const uploads: Array<{ bucket: string; path: string; bytes: number }> = [];
  /** Ordem global das operações, para provar apaga-antes-de-confirmar. */
  const timeline: string[] = [];

  const db: MaintenanceStore = {
    storage: {
      from(bucket: string) {
        return {
          upload(p: string, body: ArrayBuffer | Uint8Array | Blob) {
            uploads.push({
              bucket,
              path: p,
              bytes: body instanceof Uint8Array ? body.byteLength : -1,
            });
            objects.add(p);
            timeline.push(`upload:${p}`);
            return Promise.resolve({ error: null });
          },
          remove(paths: string[]) {
            removeCalls.push(paths);
            timeline.push(`remove:${paths.join(",")}`);
            if (opts.removeError) {
              return Promise.resolve({ data: null, error: opts.removeError });
            }
            if (opts.removeLies) {
              // Responde sucesso e não apaga. O índice continua com o objeto, e
              // é ele que a confirmação vai olhar.
              return Promise.resolve({
                data: paths.map((name) => ({ name })),
                error: null,
              });
            }
            // A Storage API tira o objeto do índice E os bytes. O dublê faz a
            // única metade que um teste consegue observar, e devolve só o que
            // realmente existia — como a de verdade faz.
            const gone = paths.filter((p) => objects.delete(p));
            return Promise.resolve({ data: gone.map((name) => ({ name })), error: null });
          },
        };
      },
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      timeline.push(`rpc:${fn}`);

      if (fn === "fn_voip_recording_purge_candidates") {
        if (opts.listError) return Promise.resolve({ data: null, error: opts.listError });
        return Promise.resolve({ data: opts.candidates ?? [], error: null });
      }

      if (fn === "fn_voip_recording_purged") {
        const callId = String(args.p_call_id);
        const p = path(callId);
        // A BARREIRA, espelhada do banco: enquanto o objeto estiver no índice,
        // o CRM não aceita esquecer o endereço.
        if (objects.has(p)) {
          return Promise.resolve({ data: "object_still_present", error: null });
        }
        return Promise.resolve({ data: "purged", error: null });
      }

      if (fn === "fn_voip_recording_retry_claim") {
        return Promise.resolve({ data: opts.claims ?? [], error: null });
      }

      if (fn === "fn_voip_recording_stored") {
        return Promise.resolve({ data: "stored", error: null });
      }

      return Promise.resolve({ data: null, error: null });
    },
  };

  return { db, objects, rpcs, removeCalls, uploads, timeline };
}

/**
 * Dublê da BUSCA. Guarda os argumentos exatos que recebeu — que é o que esta
 * camada pode errar — e devolve o desfecho combinado, na ordem.
 *
 * A busca de verdade é provada em `_shared/voip/recording.test.ts`, com
 * assinador Ed25519 e `fetch` dublado. Ela não pode ser exercida daqui: instalar
 * a chave de brinquedo exige ler `TORQUECALLS_SIGNING_SK`, e
 * `scripts/test-voip-choke.sh` proíbe isso fora de `_shared/voip/` — de
 * propósito, para que não baste batizar o vazamento de "teste" (ADR-0024 §4).
 * A partição é o desenho, não um contorno.
 */
function fakeIngest(desfechos: RecordingOutcome[]) {
  const seen: RecordingFetchArgs[] = [];
  let i = 0;
  const fn: RecordingIngest = (_db, args) => {
    seen.push({ ...args });
    return Promise.resolve(desfechos[Math.min(i++, desfechos.length - 1)]);
  };
  return { fn, seen };
}

/**
 * `logRuntime` abre cliente e sai para a rede. Sem `SUPABASE_URL` ele desiste
 * em silêncio, que é o que se quer num teste de unidade.
 */
function muteRuntimeLogs<T>(run: () => Promise<T>): Promise<T> {
  const fetchReal = globalThis.fetch;
  const urlReal = Deno.env.get("SUPABASE_URL");
  Deno.env.delete("SUPABASE_URL");
  globalThis.fetch = (() => Promise.resolve(new Response("[]", { status: 201 }))) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = fetchReal;
    if (urlReal === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", urlReal);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. O EXPURGO APAGA DE VERDADE
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("o expurgo tira o OBJETO do armazenamento, não só a referência", async () => {
  const store = fakeStore({
    candidates: [{ call_id: CALL_A, organization_id: ORG, object_path: path(CALL_A) }],
    objects: [path(CALL_A)],
  });

  const report = await muteRuntimeLogs(() => runPurge(store.db));

  // A asserção que mata o mutante: o objeto SAIU do índice do armazenamento.
  assert(
    !store.objects.has(path(CALL_A)),
    "o objeto continua no armazenamento — o expurgo apagou só a referência",
  );
  assertEquals(report.objects_removed, 1);
  assertEquals(report.purged, 1);
  assertEquals(report.refused, 0);
});

Deno.test("o `remove` vai para o bucket certo e com o caminho que o banco apontou", () => {
  // Um `remove` que ignorasse o caminho apagaria o objeto de outro tenant, ou
  // nenhum — e o relatório continuaria dizendo que expurgou.
  const store = fakeStore({
    candidates: [{ call_id: CALL_A, organization_id: ORG, object_path: path(CALL_A) }],
    objects: [path(CALL_A)],
  });
  return muteRuntimeLogs(() => runPurge(store.db)).then(() => {
    assertEquals(store.removeCalls.length, 1);
    assertEquals(store.removeCalls[0], [path(CALL_A)]);
    assertEquals(RECORDING_BUCKET, "call-recordings");
  });
});

Deno.test("apaga ANTES de confirmar — a ordem que impede o órfão invisível", async () => {
  const store = fakeStore({
    candidates: [{ call_id: CALL_A, organization_id: ORG, object_path: path(CALL_A) }],
    objects: [path(CALL_A)],
  });

  await muteRuntimeLogs(() => runPurge(store.db));

  const iRemove = store.timeline.findIndex((e) => e.startsWith("remove:"));
  const iConfirm = store.timeline.findIndex((e) => e === "rpc:fn_voip_recording_purged");
  assert(iRemove >= 0, "não houve remove");
  assert(iConfirm >= 0, "não houve confirmação");
  assert(
    iRemove < iConfirm,
    "confirmou antes de apagar — o áudio ficaria no bucket com o CRM achando que não está",
  );
});

Deno.test("confirmação recusada NÃO conta como expurgo", async () => {
  // Simula o mutante por dentro: o objeto continua no índice quando a
  // confirmação chega. O banco recusa, e o relatório tem que dizer isso em vez
  // de declarar sucesso.
  const store = fakeStore({
    candidates: [{ call_id: CALL_A, organization_id: ORG, object_path: path(CALL_A) }],
    objects: [path(CALL_A)],
    removeError: { message: "storage fora do ar" },
  });

  const report = await muteRuntimeLogs(() => runPurge(store.db));

  assert(store.objects.has(path(CALL_A)), "o objeto deveria ter sobrevivido ao erro");
  assertEquals(report.purged, 0, "declarou expurgo sobre áudio que continua no bucket");
  assertEquals(report.batch_failures, 1);
});

Deno.test("`remove` que mente NÃO vira expurgo — o banco recusa e o relatório acusa", async () => {
  // O armazenamento responde 200 sobre um caminho que continua no índice. A
  // confirmação devolve `object_still_present`, e é a ÚNICA coisa que separa
  // "apagou" de "achou que apagou". Aceitar qualquer desfecho aqui declararia
  // 90 dias cumpridos sobre áudio que continua no bucket.
  const store = fakeStore({
    candidates: [{ call_id: CALL_A, organization_id: ORG, object_path: path(CALL_A) }],
    objects: [path(CALL_A)],
    removeLies: true,
  });

  const report = await muteRuntimeLogs(() => runPurge(store.db));

  assert(store.objects.has(path(CALL_A)), "o dublê deveria ter mantido o objeto");
  assertEquals(report.purged, 0, "declarou expurgo sobre áudio que continua no bucket");
  assertEquals(report.refused, 1, "a recusa do banco não foi contada");
});

Deno.test("dry-run lista e não apaga nada", async () => {
  const store = fakeStore({
    candidates: [{ call_id: CALL_A, organization_id: ORG, object_path: path(CALL_A) }],
    objects: [path(CALL_A)],
  });

  const report = await muteRuntimeLogs(() => runPurge(store.db, { dryRun: true }));

  assertEquals(report.candidates, 1);
  assertEquals(report.purged, 0);
  assertEquals(store.removeCalls.length, 0);
  assert(store.objects.has(path(CALL_A)), "o ensaio apagou áudio de verdade");
});

Deno.test("sem vencidas, nada é chamado além da listagem", async () => {
  const store = fakeStore({ candidates: [] });
  const report = await muteRuntimeLogs(() => runPurge(store.db));
  assertEquals(report.candidates, 0);
  assertEquals(store.removeCalls.length, 0);
  assertEquals(
    store.rpcs.filter((c) => c.fn === "fn_voip_recording_purged").length,
    0,
    "confirmou expurgo sem ter apagado coisa nenhuma",
  );
});

Deno.test("listagem que falha não vira expurgo às cegas", async () => {
  const store = fakeStore({ listError: { message: "banco fora" } });
  const report = await muteRuntimeLogs(() => runPurge(store.db));
  assertEquals(report.candidates, 0);
  assertEquals(store.removeCalls.length, 0);
});

Deno.test("a política dos 90 dias não é escolhida aqui", async () => {
  // O teto do lote é desta camada; a RETENÇÃO não é. Se um dia alguém passar
  // `p_older_than_days` daqui, a política terá migrado para onde a suíte pgTAP
  // não a alcança — e é isso que esta asserção impede.
  const store = fakeStore({ candidates: [] });
  await muteRuntimeLogs(() => runPurge(store.db));
  const chamada = store.rpcs.find((c) => c.fn === "fn_voip_recording_purge_candidates");
  assert(chamada, "não listou vencidas");
  assertEquals(Object.keys(chamada.args).sort(), ["p_limit"]);
});

Deno.test("o lote é fatiado e todos os objetos somem", async () => {
  // 120 vencidas, lote de 50: três chamadas, e nenhum objeto sobra. Um laço com
  // fatiamento errado deixaria a cauda para trás e o relatório não acusaria.
  const ids = Array.from(
    { length: 120 },
    (_, i) => `11111111-2222-3333-4444-${String(i).padStart(12, "0")}`,
  );
  const store = fakeStore({
    candidates: ids.map((id) => ({
      call_id: id,
      organization_id: ORG,
      object_path: path(id),
    })),
    objects: ids.map(path),
  });

  const report = await muteRuntimeLogs(() => runPurge(store.db));

  assertEquals(store.removeCalls.length, 3);
  assertEquals(report.purged, 120);
  assertEquals(store.objects.size, 0, "sobrou áudio no armazenamento");
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. O REENFILEIRAMENTO
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("a reivindicação vira busca com EXATAMENTE os campos da linha", async () => {
  // O risco concreto desta camada: trocar `call_id` por `tc_call_id`. O GET
  // iria para a rota errada na VPS e o objeto para debaixo do nome errado no
  // bucket — e nada acusaria, porque as duas são strings opacas.
  const store = fakeStore({
    claims: [{
      call_id: CALL_A,
      tc_call_id: TC_A,
      tc_session_id: SID,
      organization_id: ORG,
      refetch_count: 1,
    }],
  });
  const ingest = fakeIngest([{ ok: true, path: path(CALL_A), bytes: 9 }]);

  const report = await muteRuntimeLogs(() =>
    runRetryQueue(store.db, {}, { ingest: ingest.fn })
  );

  assertEquals(report.claimed, 1);
  assertEquals(report.recovered, 1);
  assertEquals(ingest.seen.length, 1);
  assertEquals(ingest.seen[0], {
    callId: CALL_A,
    tcCallId: TC_A,
    sessionId: SID,
    organizationId: ORG,
  });
});

Deno.test("busca reenfileirada que falha de novo conta como falha, não como sucesso", async () => {
  // A DECLARAÇÃO da falha no banco (`fn_voip_recording_fetch_failed`, e não
  // `fn_voip_recording_failed`) é responsabilidade de `runRecordingIngest` e
  // está provada em `_shared/voip/recording.test.ts`, onde o assinador de
  // verdade pode ser instalado. Aqui prova-se o que é DESTA camada: a fila não
  // confunde falha com sucesso, e segue.
  const store = fakeStore({
    claims: [{
      call_id: CALL_A,
      tc_call_id: TC_A,
      tc_session_id: SID,
      organization_id: ORG,
      refetch_count: 3,
    }],
  });
  const ingest = fakeIngest([{ ok: false, reason: "vps_http_503" }]);

  const report = await muteRuntimeLogs(() =>
    runRetryQueue(store.db, {}, { ingest: ingest.fn })
  );

  assertEquals(report.recovered, 0);
  assertEquals(report.failed, 1);
});

Deno.test("uma retentativa que falha não impede as outras da mesma rodada", async () => {
  const store = fakeStore({
    claims: [
      {
        call_id: CALL_A,
        tc_call_id: TC_A,
        tc_session_id: SID,
        organization_id: ORG,
        refetch_count: 1,
      },
      {
        call_id: CALL_B,
        tc_call_id: "0E65AD6F1122334455667788990011F2",
        tc_session_id: SID,
        organization_id: ORG,
        refetch_count: 1,
      },
    ],
  });
  const ingest = fakeIngest([
    { ok: false, reason: "vps_unreachable" },
    { ok: true, path: path(CALL_B), bytes: 9 },
  ]);

  const report = await muteRuntimeLogs(() =>
    runRetryQueue(store.db, {}, { ingest: ingest.fn })
  );

  assertEquals(report.claimed, 2);
  assertEquals(report.recovered, 1);
  assertEquals(report.failed, 1);
  assertEquals(ingest.seen.map((a) => a.callId), [CALL_A, CALL_B]);
});

Deno.test("dry-run NÃO reivindica — ensaio não gasta ficha", async () => {
  const store = fakeStore({
    claims: [{
      call_id: CALL_A,
      tc_call_id: TC_A,
      tc_session_id: SID,
      organization_id: ORG,
      refetch_count: 0,
    }],
  });

  const report = await muteRuntimeLogs(() => runRetryQueue(store.db, { dryRun: true }));

  assertEquals(report.claimed, 0);
  assertEquals(
    store.rpcs.filter((c) => c.fn === "fn_voip_recording_retry_claim").length,
    0,
    "o ensaio reivindicou, e cada reivindicação queima uma das quatro tentativas",
  );
});

Deno.test("fila vazia não vai à VPS", async () => {
  const store = fakeStore({ claims: [] });
  const ingest = fakeIngest([{ ok: true, path: path(CALL_A), bytes: 9 }]);
  const report = await muteRuntimeLogs(() =>
    runRetryQueue(store.db, {}, { ingest: ingest.fn })
  );
  assertEquals(report.claimed, 0);
  assertEquals(ingest.seen.length, 0);
});

Deno.test("o teto e o espaçamento não são decididos aqui", async () => {
  // Só `p_limit` viaja. Um `p_max_attempts` ou um `p_backoff_minutes` daqui
  // significaria política fora do alcance da suíte pgTAP, que é onde ela é
  // provada — e duas fontes para a mesma regra é como elas divergem.
  const store = fakeStore({ claims: [] });
  await muteRuntimeLogs(() => runRetryQueue(store.db));
  const claim = store.rpcs.find((c) => c.fn === "fn_voip_recording_retry_claim");
  assert(claim, "não reivindicou");
  assertEquals(Object.keys(claim.args).sort(), ["p_limit"]);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. O ADAPTADOR
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("asMaintenanceStore preserva as operações que o módulo usa", () => {
  const cru = {
    storage: { from: () => ({ upload: () => {}, remove: () => {} }) },
    rpc: () => {},
  };
  const adaptado = asMaintenanceStore(cru);
  assertEquals(typeof adaptado.storage.from, "function");
  assertEquals(typeof adaptado.rpc, "function");
});
