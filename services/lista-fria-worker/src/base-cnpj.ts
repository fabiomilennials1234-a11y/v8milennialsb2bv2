/**
 * Mantém no disco do worker a base enxuta de CNPJ (ADR-0043).
 *
 * A base é um conjunto de PARTES Parquet de até 50 MB (o Storage do Supabase recusa arquivo acima de
 * 52 MB, limite do projeto inteiro) mais um `manifesto.json`, no bucket privado `lista-fria-base`,
 * publicados pelo job mensal (services/lista-fria-base). O nome de cada parte leva o hash do conteúdo:
 * arquivo com aquele nome nunca muda. Daí vêm as garantias deste módulo:
 *   - baixa só as partes que ainda não tem (mês novo troca quase todas; reexecução não baixa nada);
 *   - confere o sha256 de cada uma antes de aceitá-la (`.parte` -> nome final);
 *   - só escreve o manifesto local depois que TODAS as partes estão no disco, e só então apaga as
 *     antigas: uma falha no meio deixa a base anterior intacta e utilizável;
 *   - nunca mistura parte velha com parte nova, porque a consulta recebe a lista exata do manifesto.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const BUCKET_BASE = "lista-fria-base";
const MANIFESTO = "manifesto.json";
const PREFIXO_PARTE = "cnpj-enxuto-";
/** Versão do layout (colunas + formato do manifesto) que este worker sabe ler. */
export const VERSAO_LAYOUT = 2;

export interface ParteDaBase {
  nome: string;
  bytes: number;
  sha256: string;
  linhas: number;
}

export interface Manifesto {
  mes: string;
  linhas: number;
  bytes: number;
  /** Hash do conjunto: muda quando qualquer parte muda. */
  sha256: string;
  construido_em: string;
  versao_layout: number;
  arquivos: ParteDaBase[];
}

export interface BaseCfg {
  url: string;
  chave: string;
  /** Pasta do disco onde a base fica (volume do container). */
  dir: string;
  fetch?: typeof fetch;
}

export interface BaseLocal {
  /** Caminhos completos das partes, na ordem do manifesto (a ordem é a da busca). */
  arquivos: string[];
  manifesto: Manifesto;
  /** Baixou alguma parte nesta chamada. */
  trocou: boolean;
}

const SHA = /^[0-9a-f]{64}$/;
const NOME_PARTE = /^cnpj-enxuto-\d{3}-[0-9a-f]{12}\.parquet$/;

function manifestoValido(m: unknown): m is Manifesto {
  const x = m as Manifesto | null;
  return (
    !!x &&
    typeof x.sha256 === "string" && SHA.test(x.sha256) &&
    typeof x.mes === "string" &&
    typeof x.linhas === "number" &&
    x.versao_layout === VERSAO_LAYOUT &&
    Array.isArray(x.arquivos) && x.arquivos.length > 0 &&
    x.arquivos.every((a) => a && NOME_PARTE.test(a.nome) && SHA.test(a.sha256) && a.nome.includes(a.sha256.slice(0, 12)) && typeof a.bytes === "number")
  );
}

const lerManifestoLocal = async (dir: string): Promise<Manifesto | null> => {
  try {
    const m: unknown = JSON.parse(await readFile(path.join(dir, MANIFESTO), "utf8"));
    return manifestoValido(m) ? m : null;
  } catch {
    return null;
  }
};

const sha256Do = async (caminho: string): Promise<string> => {
  const h = createHash("sha256");
  await pipeline(createReadStream(caminho), h);
  return h.digest("hex");
};

/** O que já está no disco e é utilizável (manifesto válido e TODAS as partes presentes), ou null. */
export async function baseLocal(dir: string): Promise<BaseLocal | null> {
  const manifesto = await lerManifestoLocal(dir);
  if (!manifesto) return null;
  const arquivos = manifesto.arquivos.map((a) => path.join(dir, a.nome));
  if (!arquivos.every((a) => existsSync(a))) return null;
  return { arquivos, manifesto, trocou: false };
}

/**
 * Traz a base do Storage se estiver mais nova. Falha de rede NÃO derruba o worker: devolve a base que
 * já está no disco (ou null, e a busca de CNPJ fecha como indisponível).
 */
export async function sincronizarBase(cfg: BaseCfg, log: (e: string, d?: Record<string, unknown>) => void): Promise<BaseLocal | null> {
  const f = cfg.fetch ?? fetch;
  const raiz = `${cfg.url.replace(/\/+$/, "")}/storage/v1/object/authenticated/${BUCKET_BASE}`;
  const cab = { Authorization: `Bearer ${cfg.chave}`, apikey: cfg.chave };
  const local = await baseLocal(cfg.dir);
  try {
    const r = await f(`${raiz}/${MANIFESTO}`, { headers: cab });
    if (r.status === 404 || r.status === 400) {
      log("base_cnpj_sem_publicacao", { status: r.status });
      return local;
    }
    if (!r.ok) throw new Error(`manifesto: HTTP ${r.status}`);
    const remoto: unknown = await r.json();
    if (!manifestoValido(remoto)) {
      log("base_cnpj_manifesto_recusado", { motivo: "formato ou versao_layout" });
      return local;
    }
    if (local && local.manifesto.sha256 === remoto.sha256) return local;

    await mkdir(cfg.dir, { recursive: true });
    let baixadas = 0;
    for (const parte of remoto.arquivos) {
      const destino = path.join(cfg.dir, parte.nome);
      if (existsSync(destino)) continue;
      const tmp = `${destino}.parte`;
      const d = await f(`${raiz}/${parte.nome}`, { headers: cab });
      if (!d.ok || !d.body) throw new Error(`${parte.nome}: HTTP ${d.status}`);
      await pipeline(Readable.fromWeb(d.body as never), createWriteStream(tmp));
      if ((await sha256Do(tmp)) !== parte.sha256) {
        await rm(tmp, { force: true });
        throw new Error(`${parte.nome}: sha256 não confere com o manifesto`);
      }
      await rename(tmp, destino);
      baixadas++;
    }
    // Todas as partes estão no disco e conferidas: só agora a base nova passa a valer.
    await writeFile(path.join(cfg.dir, MANIFESTO), JSON.stringify(remoto));
    const manter = new Set(remoto.arquivos.map((a) => a.nome));
    for (const nome of await readdir(cfg.dir)) {
      if (nome.startsWith(PREFIXO_PARTE) && !manter.has(nome)) await rm(path.join(cfg.dir, nome), { force: true });
    }
    log("base_cnpj_atualizada", { mes: remoto.mes, linhas: remoto.linhas, bytes: remoto.bytes, partes: remoto.arquivos.length, baixadas });
    return { arquivos: remoto.arquivos.map((a) => path.join(cfg.dir, a.nome)), manifesto: remoto, trocou: true };
  } catch (e) {
    log("base_cnpj_sync_falhou", { erro: String(e) });
    return local;
  }
}
