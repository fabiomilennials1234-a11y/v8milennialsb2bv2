/**
 * Validação MANUAL do worker contra um gosom de verdade (não roda no CI).
 *
 *   docker run -d -p 8080:8080 -v ./gmapsdata:/gmapsdata gosom/google-maps-scraper -data-folder /gmapsdata
 *   node services/lista-fria-worker/validar-contra-gosom.ts "dentista" "Pinheiros, São Paulo - SP" 8
 *
 * Usa o executor de verdade, o cliente do gosom de verdade, a leitura de sites com
 * proteção contra SSRF e o DNS de verdade. Só o banco é em memória (imprime o que
 * iria para `lista_fria_worker_registrar`). Raspa o Google Maps: use busca pequena.
 */
import { CFG_PADRAO, executarMaps, type Ambiente } from "./src/executor.ts";
import type { Banco, ItemParaRegistrar } from "./src/db.ts";
import { apagarJob, baixarCsv, criarJob, lerJob } from "./src/gosom.ts";
import { lerSite } from "./src/site.ts";
import { mxPelaRede } from "./src/validar.ts";

const [nicho = "dentista", cidade = "Pinheiros, São Paulo - SP", limiteArg = "8"] = process.argv.slice(2);
const limite = Number(limiteArg);
const gosom = { baseUrl: process.env.GOSOM_URL ?? "http://localhost:8080" };

const registrados: ItemParaRegistrar[] = [];
let encerrado: [string, string | undefined] | null = null;
let ultimoProgresso: unknown = null;

const banco: Banco = {
  reivindicar: async () => null,
  recuperarTravadas: async () => 0,
  progresso: async (_b, _w, p) => {
    ultimoProgresso = p;
    console.log(`  · progresso ${Math.round(p.progresso)}% etapa=${p.etapa} achados=${p.encontrados} tel=${p.comTelefone} email=${p.comEmail} sem=${p.semContato}`);
    return "executando";
  },
  registrar: async (_b, _w, itens) => {
    const cabem = Math.max(0, limite - registrados.length);
    registrados.push(...itens.slice(0, cabem));
    return { aceitos: Math.min(cabem, itens.length), limite_atingido: registrados.length >= limite, ativa: true };
  },
  encerrar: async (_b, _w, status, erro) => {
    encerrado = [status, erro];
  },
};

const amb: Ambiente = {
  banco,
  gosom: {
    criar: async (j) => {
      console.log(`  · gosom criar keywords=${JSON.stringify(j.keywords)} depth=${j.depth} max_time=${j.maxTimeS}s`);
      return criarJob(gosom, j);
    },
    ler: (id) => lerJob(gosom, id),
    csv: (id) => baixarCsv(gosom, id),
    apagar: (id) => apagarJob(gosom, id),
  },
  ia: null,
  site: (u) => lerSite(u),
  mx: mxPelaRede(),
  esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
  agora: () => Date.now(),
  abortar: () => false,
  log: (e, d) => console.log(`  · ${e}`, d ? JSON.stringify(d) : ""),
};

const inicio = Date.now();
console.log(`Busca: "${nicho}" em "${cidade}", limite ${limite} créditos`);
await executarMaps(
  { id: "validacao", organization_id: "x", fonte: "maps", nicho, cidade, instagram_handle: null, creditos_limite: limite, creditos_usados: 0 },
  amb,
  { ...CFG_PADRAO, workerId: "validacao", pollMs: 5_000, maxTimeMaxS: 600 },
);

console.log(`\nEncerrou como ${JSON.stringify(encerrado)} em ${Math.round((Date.now() - inicio) / 1000)}s. ${registrados.length} contatos registrados:`);
for (const r of registrados) {
  console.log(`  - ${r.nome} | tel=${r.telefone ?? "-"} | email=${r.email ?? "-"} | ${r.qualidade} | bairro=${r.bairro ?? "-"} | site=${r.site ?? "-"}`);
}
console.log("último progresso:", JSON.stringify(ultimoProgresso));
