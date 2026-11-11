// Os testes do edge rodam com supabase/functions/deno.test.json, não com o
// deno.json de deploy (ver o job "Edge Function Tests (Deno)" em
// .github/workflows/test.yml). A config de teste troca cada dependência que o
// deploy busca no esm.sh pelo pacote npm de versão exata, porque o esm.sh
// recompila a MESMA URL de versão exata (tslib@2.8.1 em 21/10/2026, zod@3.23.8
// em 26/10/2026) e o integrity check do lock reprovava o job conforme o POP do
// Cloudflare que o runner sorteava. O registro npm é imutável por versão.
//
// Este teste lê as dependências esm.sh do deno.json de DEPLOY e prova, na
// resolução do processo que está rodando, que nenhuma delas cai no esm.sh —
// nem pelo nome curto, nem pela URL (que ~280 arquivos importam direto) — e que
// URL, nome curto e import() dinâmico carregam o MESMO módulo. Rodado com o
// deno.json de deploy, ele reprova: é esse o sinal de que a config de teste não
// foi usada.
import { assert, assertEquals, assertNotEquals, assertStrictEquals } from "@std/assert";
import { createClient as viaUrl } from "https://esm.sh/@supabase/supabase-js@2";
import { createClient as viaNome } from "@supabase/supabase-js";

const importsDoDeploy: Record<string, string> = JSON.parse(
  await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
).imports;
const esmDoDeploy = Object.entries(importsDoDeploy).filter(([, alvo]) =>
  alvo.startsWith("https://esm.sh/")
);

Deno.test("import map de teste: nada que o deploy busca no esm.sh resolve para o esm.sh", () => {
  // Lista vazia faria o laço passar sem ter verificado nada. Se o deploy deixou
  // o esm.sh de vez, este teste e o deno.test.json perderam o objeto: revise os
  // dois juntos.
  assertNotEquals(
    esmDoDeploy.length,
    0,
    "o deno.json de deploy não tem mais dependência no esm.sh",
  );
  for (const [nome, url] of esmDoDeploy) {
    const porNome = import.meta.resolve(nome);
    const porUrl = import.meta.resolve(url);
    assert(!porNome.includes("esm.sh"), `"${nome}" ainda resolve para o esm.sh: ${porNome}`);
    assert(!porUrl.includes("esm.sh"), `${url} ainda resolve para o esm.sh: ${porUrl}`);
    assertEquals(porUrl, porNome, `${url} e "${nome}" resolvem para módulos diferentes`);
  }
});

Deno.test("import map de teste: URL, nome curto e import() dinâmico carregam o MESMO supabase-js", async () => {
  // O import() dinâmico é o caminho de _shared/reputation-signal.ts,
  // get-member-permissions, save-member-permissions e oraculo-comercial.
  const viaDinamico = (await import("https://esm.sh/@supabase/supabase-js@2")).createClient;
  assertStrictEquals(viaUrl, viaNome);
  assertStrictEquals(viaDinamico, viaNome);
});
