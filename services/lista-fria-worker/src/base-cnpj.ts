/**
 * Mantém no disco do worker a base enxuta de CNPJ (ADR-0043).
 *
 * O arquivo `cnpj-enxuto.parquet` (~0,4 GB) e o `manifesto.json` ficam no bucket privado
 * `lista-fria-base` do Storage, publicados pelo job mensal (services/lista-fria-base). O worker lê
 * com a chave de serviço, compara o hash do manifesto com o que já tem no disco e só baixa se mudou.
 * O arquivo novo entra por troca atômica (`.parte` -> nome final) depois de conferir o sha256:
 * uma busca em andamento nunca vê arquivo pela metade.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const BUCKET_BASE = "lista-fria-base";
export const ARQUIVO_BASE = "cnpj-enxuto.parquet";
const MANIFESTO = "manifesto.json";
/** Versão do layout das colunas que este worker sabe ler. Manifesto de outra versão é recusado. */
export const VERSAO_LAYOUT = 1;

export interface Manifesto {
  mes: string;
  linhas: number;
  bytes: number;
  sha256: string;
  construido_em: string;
  versao_layout: number;
}

export interface BaseCfg {
  url: string;
  chave: string;
  /** Pasta do disco onde a base fica (volume do container). */
  dir: string;
  fetch?: typeof fetch;
}

export interface BaseLocal {
  arquivo: string;
  manifesto: Manifesto;
  /** Baixou arquivo novo nesta chamada. */
  trocou: boolean;
}

const lerJson = async (caminho: string): Promise<Manifesto | null> => {
  try {
    return JSON.parse(await readFile(caminho, "utf8")) as Manifesto;
  } catch {
    return null;
  }
};

const sha256Do = async (caminho: string): Promise<string> => {
  const h = createHash("sha256");
  await pipeline(createReadStream(caminho), h);
  return h.digest("hex");
};

function manifestoValido(m: unknown): m is Manifesto {
  const x = m as Manifesto | null;
  return !!x && typeof x.sha256 === "string" && /^[0-9a-f]{64}$/.test(x.sha256) && typeof x.mes === "string"
    && typeof x.linhas === "number" && x.versao_layout === VERSAO_LAYOUT;
}

/** O que já está no disco e é utilizável, ou null. */
export async function baseLocal(dir: string): Promise<BaseLocal | null> {
  const arquivo = path.join(dir, ARQUIVO_BASE);
  const manifesto = await lerJson(path.join(dir, MANIFESTO));
  if (!existsSync(arquivo) || !manifestoValido(manifesto)) return null;
  return { arquivo, manifesto, trocou: false };
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
    const destino = path.join(cfg.dir, ARQUIVO_BASE);
    const parte = `${destino}.parte`;
    const d = await f(`${raiz}/${ARQUIVO_BASE}`, { headers: cab });
    if (!d.ok || !d.body) throw new Error(`parquet: HTTP ${d.status}`);
    await pipeline(Readable.fromWeb(d.body as never), createWriteStream(parte));
    const sha = await sha256Do(parte);
    if (sha !== remoto.sha256) {
      await rm(parte, { force: true });
      throw new Error("sha256 do parquet não confere com o manifesto");
    }
    await rename(parte, destino);
    await writeFile(path.join(cfg.dir, MANIFESTO), JSON.stringify(remoto));
    log("base_cnpj_atualizada", { mes: remoto.mes, linhas: remoto.linhas, bytes: remoto.bytes });
    return { arquivo: destino, manifesto: remoto, trocou: true };
  } catch (e) {
    log("base_cnpj_sync_falhou", { erro: String(e) });
    return local;
  }
}
