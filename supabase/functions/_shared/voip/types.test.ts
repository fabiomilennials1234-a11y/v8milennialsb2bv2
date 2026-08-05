/**
 * Barreira de TIPO do choke. Este arquivo não testa comportamento — ele existe
 * para NÃO COMPILAR se a fronteira de tenant voltar a ser um parâmetro solto.
 *
 * O mecanismo: cada `@ts-expect-error` abaixo exige que a linha seguinte seja um
 * erro de tipo. Se alguém afrouxar a assinatura de `authorizeCallAndMint` ou
 * exportar um jeito de fabricar `Caller`, a linha para de errar e o
 * `@ts-expect-error` vira "unused" — o que é erro por si só. A checagem roda em
 * `scripts/test-voip-choke.sh` (`deno check`), porque `deno task test` usa
 * `--no-check` e engoliria tudo isto.
 */

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authorizeCallAndMint } from "./call-plane.ts";
import type { Caller } from "./caller.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const db: SupabaseClient;
declare const realCaller: Caller;

// Nunca chamada: o valor destas linhas é o que o compilador diz sobre elas.
async function _typeBarriers() {
  // ---------------------------------------------------------------------
  // 1. `Caller` é opaco. Um objeto com os campos certos NÃO é um Caller —
  //    só `resolveCaller()` produz um. Sem isto, qualquer função poderia
  //    afirmar "sou da org X" e o resto do desenho não valeria nada.
  // ---------------------------------------------------------------------
  // @ts-expect-error objeto literal não satisfaz a marca de Caller
  const forged: Caller = {
    orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    userId: "11111111-1111-1111-1111-111111111111",
    teamMemberId: null,
    role: "admin",
    isMaster: false,
    isGestor: false,
  };
  void forged;

  // ---------------------------------------------------------------------
  // 2. Não existe `orgId` nem `operatorUserId` nos argumentos. A org vem do
  //    Caller ou não vem.
  // ---------------------------------------------------------------------
  await authorizeCallAndMint(realCaller, {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: "c1111111-1111-1111-1111-111111111111",
    // @ts-expect-error org não atravessa por parâmetro
    orgId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  });

  // ---------------------------------------------------------------------
  // 3. O número de destino também não. Ele é derivado do lead no servidor —
  //    com telefone no corpo, "lead legítimo + número arbitrário" discaria
  //    para qualquer lugar e driblaria o teto por destino.
  // ---------------------------------------------------------------------
  await authorizeCallAndMint(realCaller, {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    direction: "outbound",
    leadId: "c1111111-1111-1111-1111-111111111111",
    // @ts-expect-error o telefone não entra pelo corpo
    peerPhone: "554899999999",
  });

  // ---------------------------------------------------------------------
  // 4. Direção é fechada.
  // ---------------------------------------------------------------------
  await authorizeCallAndMint(realCaller, {
    supabaseAdmin: db,
    tcSessionId: "tc-sess",
    // @ts-expect-error só outbound e inbound existem
    direction: "conference",
  });
}
void _typeBarriers;

Deno.test("barreiras de tipo do choke (a asserção real é o `deno check`)", () => {
  assert(typeof authorizeCallAndMint === "function");
});
