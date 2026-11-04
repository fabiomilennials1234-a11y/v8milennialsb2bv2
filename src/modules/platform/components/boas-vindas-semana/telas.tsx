import type { CSSProperties, ReactNode } from "react";
import { motion } from "framer-motion";
import { BarChart3, Bot, Building2, LayoutDashboard, MessageCircle, Search, Settings, Users } from "lucide-react";
import torqueIcon from "@/assets/torque-icon.png";
import {
  CARTAO_GRAFICO_Y,
  CARTOES,
  FUNIL,
  GRAFICO,
  NOS_WORKFLOW,
  NO_WORKFLOW,
  TELA_A,
  TELA_L,
  curvaSuave,
  pontoDoGrafico,
  type CartaoDado,
  type Origem,
} from "./telas-geometria";

/**
 * Telas do Torque, redesenhadas como cenário da abertura de segunda.
 *
 * Não são as telas reais: o cartão do funil, o painel e a conversa verdadeiros
 * são interativos e buscam dado no banco, o que não cabe numa abertura que
 * precisa tocar igual para todo mundo e não pode falhar. Aqui só há a anatomia
 * (a mesma do `KanbanCard` real: barras de etiqueta, nome, empresa, origem e o
 * robô da IA) com o mesmo vocabulário visual, em coordenadas FIXAS de 1200×700.
 * Ter coordenadas fixas é o que deixa a cena apontar a câmera, o cursor e o
 * clarão de uma venda para um pixel exato. Quem escala para a janela é a cena.
 *
 * Nenhuma delas importa Supabase, hooks de dado ou roteador.
 */


// ─── Cartão do funil ─────────────────────────────────────────────────────────


const CORES_ORIGEM: Record<Origem, string> = {
  WhatsApp: "border-emerald-500/40 text-emerald-400",
  "Meta Ads": "border-blue-500/40 text-blue-400",
  Instagram: "border-pink-500/40 text-pink-400",
  Indicação: "border-amber-500/40 text-amber-400",
  Site: "border-violet-500/40 text-violet-400",
};

export function CartaoLead({
  dado,
  className = "",
  style,
}: {
  dado: CartaoDado;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`w-full overflow-hidden rounded-lg border border-border bg-card p-3 shadow-sm ${className}`}
      style={{ height: FUNIL.cartaoA, ...style }}
    >
      <div className="mb-2 flex gap-1">
        {dado.etiquetas.slice(0, 3).map((cor) => (
          <div key={cor} className="h-1.5 max-w-[56px] flex-1 rounded-full" style={{ backgroundColor: cor }} />
        ))}
      </div>
      <p className="truncate text-sm font-medium text-foreground">{dado.nome}</p>
      <div className="mt-1 flex items-center gap-1 text-muted-foreground">
        <Building2 className="h-3 w-3 shrink-0" />
        <span className="truncate text-xs">{dado.empresa}</span>
      </div>
      <div className="mt-2.5 flex items-center justify-between">
        <span className={`rounded-md border px-1.5 py-0.5 text-[11px] ${CORES_ORIGEM[dado.origem]}`}>
          {dado.origem}
        </span>
        <span className="flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5 text-primary" />
          <span className="relative h-3.5 w-6 rounded-full bg-primary">
            <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-primary-foreground" />
          </span>
        </span>
      </div>
    </div>
  );
}


// ─── Moldura (barra lateral + cabeçalho) ─────────────────────────────────────

const ICONES = [LayoutDashboard, Users, MessageCircle, BarChart3, Settings] as const;

function Moldura({
  titulo,
  ativo,
  children,
  sobre,
}: {
  titulo: string;
  /** Índice do ícone aceso na barra lateral. */
  ativo: number;
  children: ReactNode;
  /** Camada por cima de tudo, em coordenadas da tela. */
  sobre?: ReactNode;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-border/80 bg-background text-foreground shadow-[0_50px_140px_-30px_rgba(0,0,0,0.95)] ring-1 ring-white/[0.06]"
      style={{ width: TELA_L, height: TELA_A }}
    >
      <div className="absolute inset-y-0 left-0 flex w-16 flex-col items-center gap-5 border-r border-border/70 bg-card/60 py-5">
        <img src={torqueIcon} alt="" className="h-7 w-7 object-contain" />
        <div className="mt-3 flex flex-col gap-3">
          {ICONES.map((Icone, i) => (
            <span
              key={i}
              className={
                i === ativo
                  ? "flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary"
                  : "flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground/60"
              }
            >
              <Icone className="h-[18px] w-[18px]" />
            </span>
          ))}
        </div>
      </div>
      <div className="absolute inset-y-0 left-16 right-0 flex flex-col">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-border/60 px-5">
          <p className="text-base font-semibold tracking-tight">{titulo}</p>
          <span className="flex h-8 w-52 items-center gap-2 rounded-md border border-border/70 bg-card/50 px-2.5 text-xs text-muted-foreground/70">
            <Search className="h-3.5 w-3.5" />
            Buscar
          </span>
        </div>
        {children}
      </div>
      {sobre}
    </div>
  );
}

// ─── Funil ───────────────────────────────────────────────────────────────────

export type ColunaId = "novo" | "atendimento" | "proposta" | "negociacao" | "vendido";

const COLUNAS: { id: ColunaId; titulo: string; fixos: number[] }[] = [
  { id: "novo", titulo: "Novo", fixos: [8, 9] },
  { id: "atendimento", titulo: "Atendimento", fixos: [0, 3, 6] },
  { id: "proposta", titulo: "Proposta", fixos: [2, 5] },
  { id: "negociacao", titulo: "Negociação", fixos: [4] },
  { id: "vendido", titulo: "Vendido", fixos: [7] },
];

/**
 * O funil. A cena entra por `topo` (cartões que chegam, em fluxo, empurrando os
 * fixos para baixo), `contagem` (o número do cabeçalho, para poder contar) e
 * `destaque` (a coluna que ganha o clarão).
 */
export function TelaFunil({
  topo,
  contagem,
  destaque,
  sobre,
}: {
  topo?: Partial<Record<ColunaId, ReactNode>>;
  contagem?: Partial<Record<ColunaId, ReactNode>>;
  destaque?: ColunaId;
  sobre?: ReactNode;
}) {
  return (
    <Moldura titulo="Funil de Vendas" ativo={1} sobre={sobre}>
      <div className="flex flex-1 gap-3 px-5 pb-0 pt-4" style={{ columnGap: FUNIL.gap }}>
        {COLUNAS.map((c) => {
          const aceso = destaque === c.id;
          return (
            <div
              key={c.id}
              style={{ width: FUNIL.colunaL }}
              className={
                aceso
                  ? "flex shrink-0 flex-col rounded-xl bg-primary/[0.05] ring-1 ring-primary/50 shadow-[0_0_60px_-10px_hsl(var(--primary)/0.55)]"
                  : "flex shrink-0 flex-col rounded-xl"
              }
            >
              <div className="flex h-9 shrink-0 items-center justify-between px-1">
                <span className="text-sm font-semibold">{c.titulo}</span>
                <span className="min-w-6 rounded-md bg-secondary px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {contagem?.[c.id] ?? c.fixos.length}
                </span>
              </div>
              <div className="mt-2.5 flex flex-col" style={{ rowGap: 10 }}>
                {topo?.[c.id]}
                {c.fixos.map((i) => (
                  <CartaoLead key={i} dado={CARTOES[i]} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Moldura>
  );
}

// ─── Painel ──────────────────────────────────────────────────────────────────


const DIAS_CURTOS = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"] as const;

function Kpi({ rotulo, valor, delta }: { rotulo: string; valor: string; delta: string }) {
  return (
    <div className="flex-1 rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{valor}</p>
      <p className="mt-1 text-xs font-medium text-success">{delta}</p>
    </div>
  );
}

export function TelaDashboard({ sobre }: { sobre?: ReactNode }) {
  return (
    <Moldura titulo="Visão geral" ativo={0} sobre={sobre}>
      <div className="flex gap-4 px-6 pt-5">
        <Kpi rotulo="Receita" valor="R$ 218.450" delta="↑ 12,4% sobre a semana anterior" />
        <Kpi rotulo="Vendas" valor="63" delta="↑ 8,6% sobre a semana anterior" />
        <Kpi rotulo="Leads" valor="1.284" delta="↑ 12,0% sobre a semana anterior" />
      </div>
      <div className="relative mx-6 mb-6 mt-4 flex-1 rounded-xl border border-border bg-card">
        <p className="px-5 pt-4 text-sm font-semibold">Receita por dia</p>
        {/* Linhas de grade e eixo: fixas; a curva vem por `sobre`, em coordenadas da tela. */}
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="absolute left-5 right-5 border-t border-dashed border-border/60"
            style={{ top: GRAFICO.y + 52 - CARTAO_GRAFICO_Y + (i * (GRAFICO.a - 70)) / 3 }}
          />
        ))}
        <div className="absolute inset-x-5 bottom-3 grid grid-cols-7 text-center text-[11px] tracking-[0.16em] text-muted-foreground/60">
          {DIAS_CURTOS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
      </div>
    </Moldura>
  );
}

/** A curva da receita: se desenha, ganha área, pontos e o brilho no pico. */
export function GraficoReceita({
  valores,
  atraso,
  duracao,
  ease,
}: {
  valores: readonly number[];
  atraso: number;
  duracao: number;
  ease: [number, number, number, number];
}) {
  const pontos = valores.map((_, i) => pontoDoGrafico(valores, i));
  const linha = curvaSuave(pontos);
  const base = GRAFICO.y + GRAFICO.a - 18;
  const area = `${linha} L${pontos[pontos.length - 1].x.toFixed(1)},${base} L${pontos[0].x.toFixed(1)},${base} Z`;
  const max = Math.max(...valores);
  const pico = valores.indexOf(max);
  return (
    <svg viewBox={`0 0 ${TELA_L} ${TELA_A}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="area-receita" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.32" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path
        d={area}
        fill="url(#area-receita)"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: duracao * 0.6, delay: atraso + duracao * 0.5, ease: "easeOut" }}
      />
      <motion.path
        d={linha}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: duracao, delay: atraso, ease }}
        style={{ filter: "drop-shadow(0 0 10px hsl(var(--primary) / 0.8))" }}
      />
      {pontos.map((p, i) => (
        <motion.circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={i === pico ? 9 : 5}
          fill={i === pico ? "hsl(var(--primary))" : "hsl(var(--background))"}
          stroke="hsl(var(--primary))"
          strokeWidth={3}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{
            type: "spring",
            stiffness: 420,
            damping: 14,
            delay: atraso + duracao * ((i + 0.5) / 7) * 0.9,
          }}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        />
      ))}
    </svg>
  );
}

// ─── Automação (o construtor de fluxo) ───────────────────────────────────────


/**
 * O construtor de automação. O título da barra é o NOME da automação que mais
 * rodou na org — é a tela dela, não uma tela de exemplo.
 */
export function TelaWorkflow({ nomeDaAutomacao, sobre }: { nomeDaAutomacao: string; sobre?: ReactNode }) {
  return (
    <Moldura
      titulo={nomeDaAutomacao}
      ativo={4}
      sobre={
        <>
          <svg viewBox={`0 0 ${TELA_L} ${TELA_A}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
            {NOS_WORKFLOW.slice(0, -1).map((n, i) => {
              const y = n.y + NO_WORKFLOW.a / 2;
              const x1 = n.x + NO_WORKFLOW.l;
              const x2 = NOS_WORKFLOW[i + 1].x;
              return (
                <g key={n.titulo}>
                  <line x1={x1} y1={y} x2={x2 - 8} y2={y} stroke="hsl(var(--border))" strokeWidth={2.5} />
                  <polygon points={`${x2},${y} ${x2 - 11},${y - 6} ${x2 - 11},${y + 6}`} fill="hsl(var(--muted-foreground))" opacity={0.7} />
                </g>
              );
            })}
          </svg>
          {NOS_WORKFLOW.map(({ x, y, titulo, sub, Icone }) => (
            <div
              key={titulo}
              className="absolute flex items-center gap-3 rounded-xl border border-border bg-card px-4 shadow-sm"
              style={{ left: x, top: y, width: NO_WORKFLOW.l, height: NO_WORKFLOW.a }}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Icone className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{titulo}</span>
                <span className="block text-xs text-muted-foreground">{sub}</span>
              </span>
            </div>
          ))}
          {sobre}
        </>
      }
    >
      {/* A grade pontilhada do canvas do construtor. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage: "radial-gradient(hsl(var(--border)) 1.2px, transparent 1.2px)",
          backgroundSize: "26px 26px",
        }}
      />
    </Moldura>
  );
}

// ─── Conversa ────────────────────────────────────────────────────────────────

const CONTATOS = [
  { n: "Padaria Estrela", m: "Pode fechar!", h: "14:02", a: true },
  { n: "Clínica Vértice", m: "Recebi a proposta, obrigada", h: "13:40" },
  { n: "Studio Lume", m: "Qual o prazo de entrega?", h: "12:18" },
  { n: "Mercado Bela Vista", m: "Fechado, pode mandar o contrato", h: "ontem" },
] as const;

export function TelaConversa() {
  return (
    <Moldura titulo="Conversas" ativo={2}>
      <div className="flex flex-1 overflow-hidden">
        <div className="w-[330px] shrink-0 border-r border-border/60">
          {CONTATOS.map((c) => (
            <div
              key={c.n}
              className={
                "a" in c && c.a
                  ? "flex items-center gap-3 border-b border-border/50 bg-primary/[0.06] px-4 py-3.5"
                  : "flex items-center gap-3 border-b border-border/50 px-4 py-3.5"
              }
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
                {c.n[0]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between">
                  <span className="truncate text-sm font-semibold">{c.n}</span>
                  <span className="text-[11px] text-muted-foreground">{c.h}</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">{c.m}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="flex flex-1 flex-col justify-end gap-3 p-6">
          <p className="max-w-[60%] self-start rounded-2xl rounded-bl-md bg-muted px-4 py-2.5 text-sm">
            Oi! Vi o orçamento. Consigo fechar hoje?
          </p>
          <p className="max-w-[60%] self-end rounded-2xl rounded-br-md bg-primary/90 px-4 py-2.5 text-sm text-primary-foreground">
            Consegue sim. Te mando o contrato agora.
          </p>
          <p className="max-w-[60%] self-start rounded-2xl rounded-bl-md bg-muted px-4 py-2.5 text-sm">Pode fechar!</p>
          <p className="max-w-[60%] self-end rounded-2xl rounded-br-md bg-primary/90 px-4 py-2.5 text-sm text-primary-foreground">
            Pedido confirmado.
          </p>
        </div>
      </div>
    </Moldura>
  );
}
