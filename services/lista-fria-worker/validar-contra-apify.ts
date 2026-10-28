/**
 * Validação MANUAL do adaptador do Instagram contra a Apify de verdade (não roda no CI).
 *
 *   APIFY_TOKEN=apify_api_... node services/lista-fria-worker/validar-contra-apify.ts <conta> [creditos]
 *
 * Use uma conta PÚBLICA pequena ou média (poucos milhares de seguidores). Com 5
 * créditos o plano processa 50 contas (uma página): custo de uns US$ 0,60 no plano FREE.
 *
 * Roda o executor de verdade, o cliente da Apify de verdade e a leitura de sites
 * com proteção SSRF. Só o banco é em memória (imprime o que iria para
 * `lista_fria_worker_registrar`). Mostra o que o Actor realmente devolveu, para
 * conferir os nomes de campo do README contra a saída real, e o gasto.
 */
import { abortarExecucao, iniciarExecucao, lerExecucao, lerItens, type ApifyCfg } from "./src/apify.ts";
import type { Banco, ItemParaRegistrar } from "./src/db.ts";
import { CFG_PADRAO, executarBusca, type Ambiente } from "./src/executor.ts";
import { CFG_INSTAGRAM_PADRAO, fonteInstagram, planoDaBusca, type ApifyApi } from "./src/fonte-instagram.ts";
import { ACTOR_PADRAO, candidatoDoItem } from "./src/instagram.ts";
import { lerSite } from "./src/site.ts";
import { mxPelaRede } from "./src/validar.ts";

const token = process.env.APIFY_TOKEN;
if (!token) {
  console.error("Defina APIFY_TOKEN (Apify Console > Settings > API & Integrations).");
  process.exit(1);
}
const [conta, creditosArg = "5"] = process.argv.slice(2);
if (!conta) {
  console.error("Uso: node validar-contra-apify.ts <conta> [creditos]");
  process.exit(1);
}
const creditos = Number(creditosArg);
const ac: ApifyCfg = { token };
const cfgIg = { actorId: process.env.APIFY_INSTAGRAM_ACTOR || ACTOR_PADRAO, ...CFG_INSTAGRAM_PADRAO };

const brutos: Array<Record<string, unknown>> = [];
const api: ApifyApi = {
  iniciar: (a, i, o) => iniciarExecucao(ac, a, i, o),
  execucao: (id) => lerExecucao(ac, id),
  itens: async (ds, off, lim) => {
    const itens = await lerItens(ac, ds, off, lim);
    brutos.push(...itens);
    return itens;
  },
  abortar: (id) => abortarExecucao(ac, id),
};

const registrados: ItemParaRegistrar[] = [];
let encerrado: [string, string | undefined] | null = null;
const banco: Banco = {
  reivindicar: async () => null,
  recuperarTravadas: async () => 0,
  progresso: async (_b, _w, p) => {
    console.log(`  · progresso ${Math.round(p.progresso)}% etapa=${p.etapa} achados=${p.encontrados} tel=${p.comTelefone} email=${p.comEmail} sem=${p.semContato}`);
    return "executando";
  },
  registrar: async (_b, _w, itens) => {
    const cabem = Math.max(0, creditos - registrados.length);
    registrados.push(...itens.slice(0, cabem));
    return { aceitos: Math.min(cabem, itens.length), limite_atingido: registrados.length >= creditos, ativa: true };
  },
  encerrar: async (_b, _w, status, erro) => {
    encerrado = [status, erro];
  },
};

const amb: Ambiente = {
  banco,
  gosom: { criar: async () => "", ler: async () => null, csv: async () => null, apagar: async () => {} },
  ia: null,
  site: (u) => lerSite(u),
  mx: mxPelaRede(),
  esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
  agora: () => Date.now(),
  abortar: () => false,
  log: (e, d) => console.log(`  · ${e}`, d ? JSON.stringify(d) : ""),
};

const busca = { id: "validacao", organization_id: "x", fonte: "instagram" as const, nicho: null, cidade: null, instagram_handle: conta.replace(/^@/, ""), creditos_limite: creditos, creditos_usados: 0 };
console.log(`Conta @${busca.instagram_handle}, ${creditos} créditos, plano:`, JSON.stringify(planoDaBusca(creditos, cfgIg)));
const inicio = Date.now();
await executarBusca(busca, fonteInstagram(busca, api, cfgIg, amb.log), amb, { ...CFG_PADRAO, workerId: "validacao", pollMs: 5_000 });

console.log(`\nEncerrou como ${JSON.stringify(encerrado)} em ${Math.round((Date.now() - inicio) / 1000)}s.`);
console.log(`Itens brutos do Actor: ${brutos.length}. Campos vistos no 1º item:`, brutos[0] ? Object.keys(brutos[0]).join(", ") : "(nenhum)");
const esperados = ["username", "full_name", "is_private", "enrichment_status", "public_email", "biography_email", "contact_phone_number", "external_url", "bio_links", "biography", "category"];
const faltando = esperados.filter((c) => brutos[0] && !(c in brutos[0]));
console.log(faltando.length ? `ATENÇÃO: campos do README que NÃO vieram: ${faltando.join(", ")}` : "Todos os campos esperados do README vieram.");
const mapeados = brutos.map((i) => candidatoDoItem(i)).filter(Boolean);
console.log(`Mapeados: ${mapeados.length}/${brutos.length}. Com e-mail: ${mapeados.filter((c) => c!.emails.length).length}. Com telefone: ${mapeados.filter((c) => c!.telefone).length}.`);
console.log(`${registrados.length} contatos registrados:`);
for (const r of registrados) console.log(`  - @${r.instagram} | ${r.nome} | tel=${r.telefone ?? "-"} | email=${r.email ?? "-"} | ${r.qualidade} | site=${r.site ?? "-"}`);
