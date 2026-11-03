/**
 * Bairros de uma cidade para a busca no Maps, sem IA (ADR-0049).
 *
 * Uma consulta só ("Contabilidade em Florianópolis") devolve um punhado de lugares: o Maps responde à
 * consulta, não à cidade. Quem cobre a cidade é uma consulta por bairro. A fonte dos bairros é a PRÓPRIA
 * base de CNPJ que o worker já carrega (ADR-0043): cada estabelecimento tem `bairro`, então os bairros de
 * um município saem ordenados por quantidade de empresas, ou seja, por onde há comércio de fato. Sem API
 * externa, sem chave, sem cota; e o nome do bairro é o que o dono cadastrou, o mesmo que ele usa no Maps.
 *
 * Tudo aqui é puro, exceto a chamada a `ConsultaDeBairros`, que o chamador injeta.
 */

export interface LinhaDeBairro {
  uf: string;
  bairro: string;
  n: number;
}

export interface ConsultaDeBairros {
  /** Bairros do município (nome em MAIÚSCULAS e sem acento, como a base guarda), do maior para o menor. */
  bairros(uf: string | null, municipio: string): Promise<LinhaDeBairro[]>;
}

export type MotivoSemBairros = "cidade_invalida" | "cidade_ambigua" | "sem_dados";

export interface ResultadoDosBairros {
  /** Os `quantidade` bairros mais densos, prontos para a palavra-chave. */
  bairros: string[];
  /** Quantos bairros válidos a cidade tem na base. */
  total: number;
  motivo?: MotivoSemBairros;
}

const literal = (s: string): string => `'${s.replaceAll("'", "''")}'`;

const UFS = new Set(
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "),
);

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");

export interface CidadeSeparada {
  /** Como a base guarda: MAIÚSCULAS, sem acento. */
  municipio: string;
  uf: string | null;
}

/**
 * "Florianópolis - SC", "Florianópolis, SC", "Florianópolis/SC" ou só "Florianópolis".
 * Texto com caractere fora de letra, número, espaço, hífen, ponto, apóstrofo ou barra não é cidade.
 */
export function separarCidade(cidade: string): CidadeSeparada | null {
  const limpa = cidade.replace(/\s+/g, " ").trim();
  if (limpa.length < 2 || limpa.length > 80) return null;
  if (!/^[\p{L}\p{N} .'\-,/]+$/u.test(limpa)) return null;
  let nome = limpa;
  let uf: string | null = null;
  const m = /^(.*?)\s*[-,/]\s*([A-Za-z]{2})$/.exec(limpa);
  if (m && UFS.has(m[2].toUpperCase())) {
    nome = m[1];
    uf = m[2].toUpperCase();
  }
  const municipio = semAcento(nome).toUpperCase().replace(/\s+/g, " ").trim();
  return municipio.length >= 2 ? { municipio, uf } : null;
}

const LIGACOES = new Set(["da", "de", "do", "das", "dos", "e"]);

function capitalizar(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((p, i) => (i > 0 && LIGACOES.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

const NAO_E_BAIRRO = /^(SN|S\/N|S N|NAO INFORMADO|NAO CONSTA|NAO TEM|NENHUM|ZONA RURAL|RURAL|INTERIOR|SEM BAIRRO)$/;

/**
 * O campo é digitado pelo contador: "CENTRO", "CENTRO.", "Centro ", "BAIRRO CENTRO", "S/N", "QD 12".
 * Junta as variações do mesmo nome, descarta o que não é bairro e ordena por quantidade de empresas.
 */
export function limparBairros(linhas: readonly LinhaDeBairro[], municipio: string): Array<{ nome: string; n: number }> {
  const porNome = new Map<string, number>();
  for (const l of linhas) {
    const b = semAcento(String(l.bairro ?? ""))
      .toUpperCase()
      .replace(/\s+/g, " ")
      .replace(/^BAIRRO\s+/, "")
      .replace(/[.,;:\s]+$/g, "")
      .trim();
    if (b.length < 3 || b.length > 40) continue;
    if (/\d/.test(b) || NAO_E_BAIRRO.test(b) || b === municipio) continue;
    if (!/^[A-Z '\-/]+$/.test(b)) continue;
    porNome.set(b, (porNome.get(b) ?? 0) + Number(l.n || 0));
  }
  return [...porNome.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([nome, n]) => ({ nome: capitalizar(nome), n }));
}

/**
 * Quantos bairros vale consultar para o limite pedido. Cada consulta por bairro rende ~10 lugares novos
 * depois de deduplicar; menos que 4 não cobre uma cidade, mais que 29 estoura o teto de 30 palavras-chave
 * (a da cidade inteira vai na frente).
 */
export function bairrosParaLimite(limite: number): number {
  return Math.min(29, Math.max(4, Math.ceil(limite / 8)));
}

export async function bairrosDaCidade(
  consulta: ConsultaDeBairros,
  cidade: string,
  quantidade: number,
): Promise<ResultadoDosBairros> {
  const c = separarCidade(cidade);
  if (!c) return { bairros: [], total: 0, motivo: "cidade_invalida" };
  const linhas = await consulta.bairros(c.uf, c.municipio);
  // Sem UF, o mesmo nome pode ser de duas cidades: misturar bairros de uma com a outra é pior que não expandir.
  if (!c.uf && new Set(linhas.map((l) => l.uf)).size > 1) return { bairros: [], total: 0, motivo: "cidade_ambigua" };
  const limpos = limparBairros(linhas, c.municipio);
  if (limpos.length === 0) return { bairros: [], total: 0, motivo: "sem_dados" };
  return { bairros: limpos.slice(0, quantidade).map((b) => b.nome), total: limpos.length };
}

/**
 * Bairros de um município (e UF, quando se sabe) por quantidade de matrizes. O município vai por parâmetro,
 * já em MAIÚSCULAS e sem acento, como a base guarda. Teto de 300: cidade grande tem 400+ grafias de bairro,
 * e só os mais densos interessam.
 */
export function sqlDosBairros(arquivos: readonly string[], uf: string | null, municipio: string): { sql: string; valores: string[] } {
  const valores = [municipio];
  let onde = "municipio = $1 AND bairro IS NOT NULL AND matriz";
  if (uf) {
    valores.push(uf);
    onde += " AND uf = $2";
  }
  const sql = `
    SELECT uf, bairro, count(*)::INTEGER AS n
      FROM read_parquet([${arquivos.map(literal).join(", ")}])
     WHERE ${onde}
     GROUP BY uf, bairro
     ORDER BY n DESC
     LIMIT 300`;
  return { sql, valores };
}
