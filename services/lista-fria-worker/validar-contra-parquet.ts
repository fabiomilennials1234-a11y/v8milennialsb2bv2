/**
 * Validação MANUAL da fonte CNPJ contra o Parquet REAL (não roda no CI).
 *
 *   node services/lista-fria-worker/validar-contra-parquet.ts <arquivo.parquet> <cnaes,sep,virgula> <UF> [municipio] [creditos] [--contato=qualquer|email|telefone|ambos] [--mostrar]
 *   ex.: node services/lista-fria-worker/validar-contra-parquet.ts C:/dados/cnpj-enxuto.parquet 46 SP "SAO PAULO" 300
 *
 * Roda o executor de verdade, a consulta DuckDB de verdade e a checagem de MX pela rede (DNS). Só o
 * banco é em memória. Mostra o rendimento: quantos candidatos viraram contato, a qualidade de cada um
 * e quantos e-mails têm domínio que recebe mensagens. E-mail e telefone saem mascarados, a menos que
 * se peça `--mostrar` (são dados de terceiros).
 */
import type { Banco, ItemParaRegistrar, Progresso } from "./src/db.ts";
import { consultaDuckdb } from "./src/consulta-duckdb.ts";
import { CFG_PADRAO, executarBusca, type Ambiente } from "./src/executor.ts";
import { CFG_CNPJ_PADRAO, fonteCnpj, type ExigeContato } from "./src/fonte-cnpj.ts";
import { mxPelaRede } from "./src/validar.ts";

const args = process.argv.slice(2);
const mostrar = args.includes("--mostrar");
const contato = (args.find((a) => a.startsWith("--contato="))?.split("=")[1] ?? "qualquer") as ExigeContato;
const [arquivo, cnaes, uf, municipio, creditosArg] = args.filter((a) => !a.startsWith("--"));
if (!arquivo || !cnaes || !uf) {
  console.error("Uso: validar-contra-parquet.ts <arquivo.parquet> <cnaes> <UF> [municipio] [creditos]");
  process.exit(1);
}
const creditos = Number(creditosArg ?? "300");

const mascarar = (v: string | null | undefined): string => {
  if (!v) return "-";
  if (mostrar) return v;
  const [u, d] = v.split("@");
  return d ? `${u.slice(0, 1)}***@${d.slice(0, 1)}***${d.slice(d.lastIndexOf("."))}` : `${v.slice(0, 4)}*****${v.slice(-2)}`;
};

const registrados: ItemParaRegistrar[] = [];
let ultimo: Progresso | null = null;
let encerrado: [string, string | undefined] | null = null;
const banco: Banco = {
  reivindicar: async () => null,
  recuperarTravadas: async () => 0,
  progresso: async (_b, _w, p) => { ultimo = p; return "executando"; },
  registrar: async (_b, _w, itens) => {
    const cabem = Math.max(0, creditos - registrados.length);
    registrados.push(...itens.slice(0, cabem));
    return { aceitos: Math.min(cabem, itens.length), limite_atingido: registrados.length >= creditos, ativa: true };
  },
  encerrar: async (_b, _w, status, erro) => { encerrado = [status, erro]; },
};

const amb: Ambiente = {
  banco,
  gosom: { criar: async () => "", ler: async () => null, csv: async () => null, apagar: async () => {} },
  ia: null,
  site: async () => ({ emails: [], whatsapps: [], telefones: [] }),
  mx: mxPelaRede(),
  esperar: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 50))),
  agora: () => Date.now(),
  abortar: () => false,
  log: (e, d) => { if (e === "cnpj_varredura_fim" || e === "busca_iniciada") console.log(`  · ${e}`, d ? JSON.stringify(d) : ""); },
};

const busca = {
  id: "validacao", organization_id: "x", fonte: "cnpj" as const, nicho: null, cidade: null, instagram_handle: null,
  filtros: { cnaes: cnaes.split(","), uf, ...(municipio ? { municipio } : {}), contato },
  creditos_limite: creditos, creditos_usados: 0,
};

const consulta = await consultaDuckdb(arquivo);
const inicio = Date.now();
try {
  await executarBusca(busca, fonteCnpj(busca, consulta, CFG_CNPJ_PADRAO, amb.log), amb, { ...CFG_PADRAO, workerId: "validacao", pollMs: 1 });
} finally {
  consulta.fechar();
}

const por = (f: (r: ItemParaRegistrar) => boolean) => registrados.filter(f).length;
const pct = (n: number) => `${n} (${registrados.length ? Math.round((n / registrados.length) * 100) : 0}%)`;
console.log(`\nEncerrou como ${JSON.stringify(encerrado)} em ${Math.round((Date.now() - inicio) / 1000)}s.`);
console.log(`Candidatos lidos: ${ultimo?.encontrados}. Registrados (contatos): ${registrados.length} de ${creditos} créditos.`);
console.log(`Com e-mail: ${pct(por((r) => !!r.email))}. Com telefone: ${pct(por((r) => !!r.telefone))}. Com os dois: ${pct(por((r) => !!r.email && !!r.telefone))}.`);
console.log(`Qualidade -> verificado: ${pct(por((r) => r.qualidade === "verificado"))}; não verificado: ${pct(por((r) => r.qualidade === "nao_verificado"))}; e-mail inválido (sem MX): ${pct(por((r) => r.qualidade === "email_invalido"))}.`);
const dominios = new Map<string, number>();
for (const r of registrados) if (r.email) { const d = r.email.split("@")[1]; dominios.set(d, (dominios.get(d) ?? 0) + 1); }
const topo = [...dominios].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([d, n]) => `${d}=${n}`).join(", ");
console.log(`Domínios de e-mail mais comuns: ${topo || "-"}`);
console.log("Amostra:");
for (const r of registrados.slice(0, 8)) console.log(`  - ${r.nome.slice(0, 40)} | ${r.categoria?.slice(0, 30)} | tel=${mascarar(r.telefone)} | email=${mascarar(r.email)} | ${r.qualidade}`);
