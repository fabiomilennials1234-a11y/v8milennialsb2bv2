import { ArrowRightLeft, Clock, MessageCircle, Zap } from "lucide-react";

/**
 * Geometria e dados das telas do Torque da abertura de segunda.
 *
 * Mora à parte de `telas.tsx` porque o lint do projeto (`react-refresh/only-export-components`)
 * não aceita constante nem função no mesmo arquivo que exporta componente: o fast refresh
 * recarregaria a página inteira a cada edição. Aqui só há coordenadas e dados, sem JSX.
 *
 * As coordenadas são FIXAS, em px de uma tela de 1200×700. É isso que deixa a cena apontar a
 * câmera, o cursor e o clarão de uma venda para um pixel exato; quem escala para a janela é a cena.
 */

export const TELA_L = 1200;
export const TELA_A = 700;

/** Geometria do funil, em px da tela. A cena depende disso para mirar. */
export const FUNIL = {
  colunaL: 208,
  gap: 12,
  /** x do canto esquerdo da 1ª coluna. */
  x0: 84,
  /** y do topo do 1º cartão (barra de topo 64 + respiro 16 + cabeçalho 36 + vão 10). */
  yCartao: 126,
  cartaoA: 112,
  /** Cartão + vão — a altura que cada cartão ocupa na coluna. */
  passoCartao: 122,
} as const;
export const PASSO_COLUNA = FUNIL.colunaL + FUNIL.gap;

/** Centro de um cartão na coluna `col` (0 = Novo … 4 = Vendido), linha `linha`. */
export function centroDoCartao(col: number, linha = 0): { x: number; y: number } {
  return {
    x: FUNIL.x0 + col * PASSO_COLUNA + FUNIL.colunaL / 2,
    y: FUNIL.yCartao + linha * FUNIL.passoCartao + FUNIL.cartaoA / 2,
  };
}

// ─── Cartões do funil ────────────────────────────────────────────────────────

export type Origem = "WhatsApp" | "Meta Ads" | "Instagram" | "Indicação" | "Site";
export interface CartaoDado {
  nome: string;
  empresa: string;
  origem: Origem;
  etiquetas: string[];
}

const ETIQUETA = {
  verde: "#22c55e",
  azul: "#3b82f6",
  ambar: "#f59e0b",
  rosa: "#ec4899",
} as const;

/** Banco de cartões para a cena sortear sem repetir nome na mesma coluna. */
export const CARTOES: CartaoDado[] = [
  { nome: "Marina Prado", empresa: "Padaria Estrela", origem: "WhatsApp", etiquetas: [ETIQUETA.verde, ETIQUETA.azul] },
  { nome: "Rafael Dorigo", empresa: "Auto Peças Dorigo", origem: "Meta Ads", etiquetas: [ETIQUETA.ambar] },
  { nome: "Camila Vértice", empresa: "Clínica Vértice", origem: "Indicação", etiquetas: [ETIQUETA.rosa, ETIQUETA.verde] },
  { nome: "Bruno Lume", empresa: "Studio Lume", origem: "Instagram", etiquetas: [ETIQUETA.azul] },
  { nome: "Helena Bela Vista", empresa: "Mercado Bela Vista", origem: "WhatsApp", etiquetas: [ETIQUETA.verde] },
  { nome: "Otávio Ribeiro", empresa: "Transp. Ribeiro", origem: "Site", etiquetas: [ETIQUETA.ambar, ETIQUETA.rosa] },
  { nome: "Paula Casa & Obra", empresa: "Casa & Obra", origem: "Meta Ads", etiquetas: [ETIQUETA.azul, ETIQUETA.ambar] },
  { nome: "Diego Altavista", empresa: "Altavista Móveis", origem: "Indicação", etiquetas: [ETIQUETA.verde, ETIQUETA.rosa] },
  { nome: "Sônia Tavares", empresa: "Tavares Contábil", origem: "WhatsApp", etiquetas: [ETIQUETA.azul] },
  { nome: "Léo Sampaio", empresa: "Sampaio Eletro", origem: "Instagram", etiquetas: [ETIQUETA.ambar] },
];

// ─── Painel ──────────────────────────────────────────────────────────────────

/** Área do gráfico, em px da tela — a cena aponta a câmera para o pico a partir daqui. */
export const GRAFICO = { x: 108, y: 262, l: 1048, a: 380 } as const;
/** Topo do cartão do gráfico na tela (64 de barra + 20 + KPIs 106 + 16). */
export const CARTAO_GRAFICO_Y = 206;

export function pontoDoGrafico(valores: readonly number[], i: number): { x: number; y: number } {
  const max = Math.max(...valores, 1);
  return {
    x: GRAFICO.x + ((i + 0.5) / 7) * GRAFICO.l,
    y: GRAFICO.y + GRAFICO.a - 18 - (valores[i] / max) * (GRAFICO.a - 70),
  };
}

/** Curva suave (Catmull-Rom → Bézier) por todos os pontos. */
export function curvaSuave(p: { x: number; y: number }[]): string {
  if (p.length < 2) return "";
  let d = `M${p[0].x.toFixed(1)},${p[0].y.toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

// ─── Automação (o construtor de fluxo) ───────────────────────────────────────

export const NO_WORKFLOW = { l: 190, a: 84 } as const;

/** Um fluxo de quatro passos, em linha — o desenho que a pulsação percorre. */
export const NOS_WORKFLOW = [
  { x: 110, y: 300, titulo: "Lead criado", sub: "Gatilho", Icone: Zap },
  { x: 390, y: 300, titulo: "Aguardar 5 min", sub: "Espera", Icone: Clock },
  { x: 670, y: 300, titulo: "Enviar WhatsApp", sub: "Ação", Icone: MessageCircle },
  { x: 950, y: 300, titulo: "Mover de etapa", sub: "Ação", Icone: ArrowRightLeft },
] as const;

export function centroDoNo(i: number): { x: number; y: number } {
  const n = NOS_WORKFLOW[i];
  return { x: n.x + NO_WORKFLOW.l / 2, y: n.y + NO_WORKFLOW.a / 2 };
}
