/**
 * Executa UMA busca do Maps do começo ao fim.
 *
 * O gosom coleta; o worker lê o CSV PARCIAL a cada volta e ingere só o que é
 * novo (`ref` ainda não visto). Por isso "parar e ficar com o que achou" funciona:
 * o que já foi achado já está no banco, cobrado e importável. O banco é a fonte da
 * verdade do saldo: o worker nunca decide gasto, só pede `registrar` e obedece
 * `limite_atingido`.
 *
 * Tudo que toca o mundo (banco, gosom, IA, sites, DNS, relógio) entra por
 * `Ambiente`, então o fluxo inteiro roda em teste sem rede.
 */
import type { Banco, BuscaDaFila, ItemParaRegistrar, Progresso } from "./db.ts";
import { ehCelular, normalizarTelefoneBR, whatsappDoLink } from "./contatos.ts";
import type { ContatosDoSite } from "./site.ts";
import type { Expansao } from "./ia.ts";
import { linhasDoCsv, type LinhaDoMaps, type NovoJob } from "./gosom.ts";
import { qualidadeDoContato, type ResolverMx } from "./validar.ts";

export interface Ambiente {
  banco: Banco;
  gosom: {
    criar(job: NovoJob): Promise<string>;
    ler(id: string): Promise<{ status: string } | null>;
    csv(id: string): Promise<string | null>;
    apagar(id: string): Promise<void>;
  };
  ia: {
    expandir(nicho: string, cidade: string): Promise<Expansao>;
    aderentes(nicho: string, itens: Array<{ id: string; titulo: string; categoria: string | null }>): Promise<Map<string, boolean>>;
  } | null;
  site(url: string): Promise<ContatosDoSite>;
  mx: ResolverMx;
  esperar(ms: number): Promise<void>;
  agora(): number;
  /** SIGTERM: termina a busca ficando com o que já achou. */
  abortar(): boolean;
  log(evento: string, dados?: Record<string, unknown>): void;
}

export interface CfgDoExecutor {
  workerId: string;
  pollMs: number;
  /** Teto do `max_time` do gosom, em segundos. */
  maxTimeMaxS: number;
  /** Itens por chamada de `registrar`. */
  lote: number;
  concorrenciaSite: number;
}

export const CFG_PADRAO: Omit<CfgDoExecutor, "workerId"> = {
  pollMs: 5_000,
  maxTimeMaxS: 3_600,
  lote: 50,
  concorrenciaSite: 4,
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Buscas do Maps: o nicho (e as variantes) na cidade inteira primeiro, depois a
 * primeira variante em cada bairro. Máximo 30, sem repetir. Sem bairros (IA
 * desligada ou sem certeza), só nicho × cidade.
 */
export function montarKeywords(nicho: string, cidade: string, exp: Expansao | null): string[] {
  const limpa = (s: string) => s.replace(/\s+/g, " ").trim();
  const n = limpa(nicho);
  const c = limpa(cidade);
  const variantes = [n, ...(exp?.variantes ?? []).map(limpa)].filter(Boolean);
  const unicas = variantes.filter((v, i) => variantes.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);
  const saida: string[] = [];
  const add = (k: string) => {
    if (!saida.some((x) => x.toLowerCase() === k.toLowerCase())) saida.push(k);
  };
  for (const v of unicas) add(`${v} em ${c}`);
  for (const b of exp?.bairros ?? []) add(`${unicas[0]} em ${limpa(b)}, ${c}`);
  return saida.slice(0, 30);
}

const REDES_E_AGREGADORES = /(^|\.)(facebook|instagram|linkedin|tiktok|youtube|google|goo\.gl|linktr\.ee|bit\.ly|wa\.me|whatsapp)\./i;
const NEGOCIO_FECHADO = /permanent|definitiv|fechad|closed/i;

function deveLerSite(url: string | null): url is string {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    return !REDES_E_AGREGADORES.test(new URL(url).hostname + ".");
  } catch {
    return false;
  }
}

async function emPool<T>(itens: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const trabalhadores = Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (i < itens.length) await fn(itens[i++]);
  });
  await Promise.all(trabalhadores);
}

type Estado = "ok" | "limite" | "inativa";

export async function executarMaps(busca: BuscaDaFila, amb: Ambiente, cfg: CfgDoExecutor): Promise<void> {
  const nicho = busca.nicho ?? "";
  const cidade = busca.cidade ?? "";
  const limite = busca.creditos_limite;
  const inicio = amb.agora();
  const vistos = new Set<string>();
  const n = { encontrados: 0, comTelefone: 0, comEmail: 0, semContato: 0 };
  let registrados = 0;
  let jobId: string | null = null;

  const progresso = async (etapa: Progresso["etapa"], pctTempo: number): Promise<string> =>
    await amb.banco.progresso(busca.id, cfg.workerId, {
      etapa,
      progresso: Math.max(registrados / limite, pctTempo) * 95,
      ...n,
    });

  const apagar = async () => {
    if (!jobId) return;
    try {
      await amb.gosom.apagar(jobId);
    } catch (e) {
      amb.log("gosom_apagar_falhou", { busca: busca.id, erro: String(e) });
    }
  };

  async function processar(linhas: LinhaDoMaps[]): Promise<Estado> {
    const abertas = linhas.filter((l) => !NEGOCIO_FECHADO.test(l.situacao ?? ""));

    // 1. IA: o que não é do nicho sai antes de gastar leitura de site e crédito.
    let dosNicho = abertas;
    if (amb.ia && abertas.length > 0) {
      const veredito = new Map<string, boolean>();
      for (let i = 0; i < abertas.length; i += 40) {
        try {
          const parte = abertas.slice(i, i + 40);
          const r = await amb.ia.aderentes(nicho, parte.map((l) => ({ id: l.ref, titulo: l.titulo, categoria: l.categoria })));
          for (const [k, v] of r) veredito.set(k, v);
        } catch (e) {
          amb.log("ia_falhou_segue_sem", { busca: busca.id, erro: String(e) });
        }
      }
      dosNicho = abertas.filter((l) => veredito.get(l.ref) !== false);
    }

    // 2. Contato: o que o gosom trouxe + WhatsApp/e-mail do site quando falta.
    // Na ordem do CSV, não na ordem em que as leituras terminam: no limite de créditos,
    // quem entra tem de ser o primeiro achado, não o que o site respondeu mais rápido.
    const porPosicao: Array<ItemParaRegistrar | null> = new Array(dosNicho.length).fill(null);
    await emPool(dosNicho.map((l, posicao) => ({ l, posicao })), cfg.concorrenciaSite, async ({ l, posicao }) => {
      try {
        let tel = normalizarTelefoneBR(l.telefone);
        let wa = whatsappDoLink(l.site);
        const emails = [...l.emails];
        if (deveLerSite(l.site) && (emails.length === 0 || (!wa && !ehCelular(tel)))) {
          const c = await amb.site(l.site);
          for (const e of c.emails) if (!emails.includes(e)) emails.push(e);
          wa ??= c.whatsapps[0] ?? null;
          tel ??= c.telefones[0] ?? null;
        }
        // Um telefone só: o que dá para chamar no WhatsApp vale mais que o fixo.
        const telefone = wa ?? tel;
        const email = emails[0] ?? null;
        if (telefone) n.comTelefone++;
        if (email) n.comEmail++;
        if (!telefone && !email) {
          n.semContato++;
          return;
        }
        porPosicao[posicao] = {
          ref_externa: l.ref,
          nome: l.titulo,
          categoria: l.categoria,
          telefone,
          email,
          site: l.site && /^https?:\/\//i.test(l.site) && !whatsappDoLink(l.site) ? l.site : null,
          endereco: l.endereco,
          bairro: l.bairro,
          qualidade: await qualidadeDoContato({ telefone, email, celular: ehCelular(telefone) }, amb.mx),
        };
      } catch (e) {
        amb.log("linha_falhou", { busca: busca.id, ref: l.ref, erro: String(e) });
        n.semContato++;
      }
    });
    const itens = porPosicao.filter((x): x is ItemParaRegistrar => x !== null);

    // 3. Banco: cobra e para no limite.
    for (let i = 0; i < itens.length; i += cfg.lote) {
      const r = await amb.banco.registrar(busca.id, cfg.workerId, itens.slice(i, i + cfg.lote));
      if (!r.ativa) return "inativa";
      registrados += r.aceitos;
      if (r.limite_atingido) return "limite";
    }
    return "ok";
  }

  try {
    // Expansão (IA opcional): sem ela, nicho × cidade.
    let exp: Expansao | null = null;
    if (amb.ia) {
      try {
        exp = await amb.ia.expandir(nicho, cidade);
      } catch (e) {
        amb.log("ia_expandir_falhou_segue_sem", { busca: busca.id, erro: String(e) });
      }
    }
    const keywords = montarKeywords(nicho, cidade, exp);
    const depth = clamp(Math.ceil((limite * 2) / (keywords.length * 20)), 1, 20);
    const maxTimeS = clamp(keywords.length * depth * 45, 300, cfg.maxTimeMaxS);

    if ((await progresso("coletando", 0)) !== "executando") return;
    jobId = await amb.gosom.criar({ nome: `lf-${busca.id}`, keywords, depth, maxTimeS, email: true });
    amb.log("busca_iniciada", { busca: busca.id, jobId, keywords: keywords.length, depth, maxTimeS, limite });

    const prazo = inicio + (maxTimeS + 120) * 1000;
    for (;;) {
      await amb.esperar(cfg.pollMs);

      if (amb.abortar()) {
        await apagar();
        await amb.banco.encerrar(busca.id, cfg.workerId, "parada");
        return;
      }

      const job = await amb.gosom.ler(jobId);
      const terminou = job === null || job.status === "ok" || job.status === "failed";

      let csv: string | null = null;
      try {
        csv = await amb.gosom.csv(jobId);
      } catch (e) {
        // CSV parcial pode falhar enquanto o gosom escreve: tenta de novo na volta seguinte.
        amb.log("csv_falhou_tenta_de_novo", { busca: busca.id, erro: String(e) });
      }

      if (csv) {
        const novas = linhasDoCsv(csv).filter((l) => !vistos.has(l.ref));
        for (const l of novas) vistos.add(l.ref);
        n.encontrados = vistos.size;
        if (novas.length > 0) {
          const estado = await processar(novas);
          if (estado === "inativa") {
            // Parada ou cancelada pelo usuário no meio do lote: o banco já fechou a busca.
            await apagar();
            return;
          }
          if (estado === "limite") {
            await apagar();
            await progresso("validando", 1);
            await amb.banco.encerrar(busca.id, cfg.workerId, "parada");
            amb.log("busca_no_limite", { busca: busca.id, registrados });
            return;
          }
        }
      }

      const pctTempo = (amb.agora() - inicio) / (prazo - inicio);
      const status = await progresso(terminou ? "validando" : "coletando", pctTempo);
      if (status !== "executando") {
        await apagar();
        return;
      }

      if (terminou) {
        const sem = job?.status === "failed" && vistos.size === 0;
        await apagar();
        await amb.banco.encerrar(busca.id, cfg.workerId, sem ? "falhou" : "concluida", sem ? "gosom_falhou" : undefined);
        amb.log("busca_encerrada", { busca: busca.id, registrados, encontrados: vistos.size });
        return;
      }
      if (amb.agora() > prazo) {
        await apagar();
        const algo = vistos.size > 0;
        await amb.banco.encerrar(busca.id, cfg.workerId, algo ? "concluida" : "falhou", algo ? undefined : "tempo_esgotado");
        return;
      }
    }
  } catch (e) {
    amb.log("busca_falhou", { busca: busca.id, erro: String(e) });
    await apagar();
    try {
      await amb.banco.encerrar(busca.id, cfg.workerId, "falhou", String(e).slice(0, 300));
    } catch (e2) {
      amb.log("encerrar_falhou", { busca: busca.id, erro: String(e2) });
    }
  }
}
