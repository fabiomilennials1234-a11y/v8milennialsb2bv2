/**
 * Cliente do gosom/google-maps-scraper (modo web, `-data-folder`).
 *
 * Contrato MEDIDO contra a imagem `gosom/google-maps-scraper` em 27/10/2026, não
 * só lido do spec (`/static/spec/spec.yaml`), porque os dois discordam:
 *
 *   - o spec descreve a resposta de `GET /api/v1/jobs/{id}` com chaves minúsculas;
 *     a real vem em MAIÚSCULAS (`ID`, `Name`, `Date`, `Status`, `Data`). `lerJob`
 *     lê sem diferenciar caixa, para sobreviver a qualquer dos dois;
 *   - `lang` é ISO 639-1 curto: `pt` vale, `pt-BR` volta 422 "invalid lang";
 *   - `max_time` vai em SEGUNDOS no POST e volta em nanossegundos em `Data`;
 *   - `Status`: `pending`, `working`, `ok`, `failed`;
 *   - `/download` devolve o CSV também com o job ainda em `working` (parcial), o
 *     que permite ingerir enquanto o gosom coleta;
 *   - o JSON do POST precisa ir em UTF-8 (nome de cidade com acento).
 *
 * O servidor do gosom NÃO tem autenticação: só pode ficar numa rede interna.
 */
import { emailsDe } from "./contatos.ts";

export interface GosomCfg {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Teto por chamada; o gosom fica lento enquanto raspa. */
  timeoutMs?: number;
}

export type StatusDoJob = "pending" | "working" | "ok" | "failed";

export interface NovoJob {
  nome: string;
  keywords: string[];
  /** 1 página ≈ 20 lugares por keyword. */
  depth: number;
  /** Segundos. */
  maxTimeS: number;
  email: boolean;
}

function http(cfg: GosomCfg): typeof fetch {
  return cfg.fetch ?? fetch;
}

async function chamar(cfg: GosomCfg, caminho: string, init: RequestInit = {}): Promise<Response> {
  return await http(cfg)(`${cfg.baseUrl.replace(/\/+$/, "")}${caminho}`, {
    ...init,
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000),
  });
}

export async function criarJob(cfg: GosomCfg, job: NovoJob): Promise<string> {
  const r = await chamar(cfg, "/api/v1/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      name: job.nome,
      keywords: job.keywords,
      lang: "pt",
      zoom: 15,
      depth: job.depth,
      email: job.email,
      max_time: job.maxTimeS,
    }),
  });
  const corpo = await r.text();
  if (r.status !== 201) throw new Error(`gosom recusou o job (${r.status}): ${corpo.slice(0, 200)}`);
  const id = pegar(JSON.parse(corpo), "id");
  if (typeof id !== "string" || !id) throw new Error("gosom não devolveu o id do job");
  return id;
}

export async function lerJob(cfg: GosomCfg, id: string): Promise<{ status: StatusDoJob | string } | null> {
  const r = await chamar(cfg, `/api/v1/jobs/${encodeURIComponent(id)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`gosom: ler job falhou (${r.status})`);
  const status = pegar(await r.json(), "status");
  return { status: typeof status === "string" ? status : "failed" };
}

/** CSV do job (parcial se ainda rodando). `null` se o arquivo ainda não existe. */
export async function baixarCsv(cfg: GosomCfg, id: string): Promise<string | null> {
  const r = await chamar(cfg, `/api/v1/jobs/${encodeURIComponent(id)}/download`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`gosom: baixar CSV falhou (${r.status})`);
  return await r.text();
}

export async function apagarJob(cfg: GosomCfg, id: string): Promise<void> {
  const r = await chamar(cfg, `/api/v1/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
  // 200 apagou; 404 já não existe; o resto o worker só registra, não trava por isso.
  if (!r.ok && r.status !== 404) throw new Error(`gosom: apagar job falhou (${r.status})`);
}

function pegar(obj: unknown, chave: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const alvo = chave.toLowerCase();
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k.toLowerCase() === alvo) return v;
  }
  return undefined;
}

// ── CSV ────────────────────────────────────────────────────────────────────

/** RFC 4180: aspas dobradas, campo com quebra de linha, CRLF ou LF. */
export function parseCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let aspas = false;
  const t = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          aspas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      aspas = true;
    } else if (c === ",") {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo);
      campo = "";
      if (linha.length > 1 || linha[0] !== "") linhas.push(linha);
      linha = [];
    } else {
      campo += c;
    }
  }
  // Última linha sem quebra final. Com aspas abertas é um CSV cortado no meio
  // (download parcial): descarta em vez de ingerir meia linha.
  if (!aspas && (campo !== "" || linha.length > 0)) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

export interface LinhaDoMaps {
  /** place_id; sem ele, um id estável derivado de título + endereço. */
  ref: string;
  titulo: string;
  categoria: string | null;
  endereco: string | null;
  bairro: string | null;
  telefone: string | null;
  site: string | null;
  emails: string[];
  /** Coluna `status` do gosom (ex.: negócio fechado). */
  situacao: string | null;
}

function nulo(s: string | undefined): string | null {
  const v = (s ?? "").trim();
  return v === "" ? null : v;
}

function bairroDe(completo: string | undefined): string | null {
  try {
    const o = JSON.parse(completo ?? "") as { borough?: unknown };
    return typeof o.borough === "string" && o.borough.trim() ? o.borough.trim() : null;
  } catch {
    return null;
  }
}

/** Hash curto e estável (FNV-1a 64 bits em BigInt) para quando não há place_id. */
export function idEstavel(titulo: string, endereco: string | null): string {
  let h = 0xcbf29ce484222325n;
  for (const ch of `${titulo}|${endereco ?? ""}`) {
    h ^= BigInt(ch.codePointAt(0) ?? 0);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `h_${h.toString(16)}`;
}

export function linhasDoCsv(texto: string): LinhaDoMaps[] {
  const tabela = parseCsv(texto);
  if (tabela.length < 2) return [];
  const cab = tabela[0].map((c) => c.trim().toLowerCase());
  const col = (nome: string) => cab.indexOf(nome);
  const iTitulo = col("title");
  if (iTitulo < 0) throw new Error("CSV do gosom sem a coluna title: o formato mudou");

  const out: LinhaDoMaps[] = [];
  for (const r of tabela.slice(1)) {
    // Linha cortada pelo download parcial: menos colunas que o cabeçalho.
    if (r.length < cab.length) continue;
    const get = (nome: string) => (col(nome) >= 0 ? r[col(nome)] : undefined);
    const titulo = nulo(r[iTitulo]);
    if (!titulo) continue;
    const endereco = nulo(get("address"));
    out.push({
      ref: nulo(get("place_id")) ?? nulo(get("cid")) ?? idEstavel(titulo, endereco),
      titulo,
      categoria: nulo(get("category")),
      endereco,
      bairro: bairroDe(get("complete_address")),
      telefone: nulo(get("phone")),
      site: nulo(get("website")),
      emails: emailsDe(get("emails")),
      situacao: nulo(get("status")),
    });
  }
  return out;
}
