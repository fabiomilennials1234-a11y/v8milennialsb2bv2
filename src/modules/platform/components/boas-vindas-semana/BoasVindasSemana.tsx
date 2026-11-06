import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useReducedMotion, type TargetAndTransition, type Transition } from "framer-motion";
import { Crown } from "lucide-react";
import {
  cronograma,
  nomeDoMes,
  planejarCenas,
  saudacaoBrt,
  type CenaId,
  type ResumoSemana,
} from "../../lib/boas-vindas-semana";
import { CartaoLead, GraficoReceita, TelaConversa, TelaDashboard, TelaFunil, TelaWorkflow } from "./telas";
import {
  CARTOES,
  FUNIL,
  NOS_WORKFLOW,
  NO_WORKFLOW,
  PASSO_COLUNA,
  TELA_A,
  TELA_L,
  centroDoCartao,
  centroDoNo,
  pontoDoGrafico,
} from "./telas-geometria";

/**
 * BoasVindasSemana — a abertura de segunda-feira.
 *
 * Aparece uma vez por usuário por semana (BRT), no primeiro acesso da
 * segunda. Esta peça é só a apresentação: não sabe quando tocar e não lê dado
 * de lugar nenhum. Quem decide é o gatilho; quem entrega o `resumo` é a query.
 *
 * Toca sozinha em `DURACAO_MS` (42 s) e se encerra sozinha. "Pular" e Esc
 * saem a qualquer momento, porque 42 s sem saída seria uma catraca.
 *
 * DIREÇÃO. Até oito cenas, e nenhuma se parece com a anterior no movimento.
 * Não há uma câmera que passeia: cada passagem é um corte pensado.
 *
 *   1. Impacto       SEGUNDA. entra letra a letra e a câmera MERGULHA no ponto final.
 *   2. Leads         o funil do Torque em 3D, cartões caindo, empurrão lento de câmera.
 *   3. Vendas        varre para o lado; um cartão é arrastado até Vendido, soco de câmera.
 *   4. Receita       sobe de baixo; a curva se desenha e a câmera mergulha no pico.
 *   5. Automações    íris que abre; uma centelha percorre o fluxo da automação que mais rodou.
 *   6. Movimentação  emerge torta; cartões cruzam o funil e o nome de quem mais os moveu pousa.
 *   7. Ranking       gira para dentro; o pódio do mês, com a sua posição.
 *   8. Fecho         a câmera RECUA de um detalhe e revela a parede de telas.
 *
 * As cenas 5 a 7 são do Torque e OPCIONAIS: a org que não tem automação, ou
 * cuja consulta falhou, simplesmente não ganha aquela cena, e as demais se
 * redistribuem (ver `cronograma`). Com todas, são exatamente 42 s.
 *
 * Nada é linear: tudo é expo, back ou spring. As únicas coisas que andam em
 * velocidade constante são o relógio e a barra de progresso do topo.
 *
 * `prefers-reduced-motion`: sem 3D, sem zoom, sem contagem. As mesmas cenas e
 * a mesma duração, em texto e fade.
 */

const FADE_SAIDA_MS = 600;

// O contrato com o banco mora em `lib/boas-vindas-semana`; aqui só se reexporta
// para a página de visualização não precisar conhecer o caminho da lib.
export type { ResumoSemana };

interface Props {
  nome: string;
  resumo: ResumoSemana;
  /** Chamado uma única vez, quando a peça termina (sozinha ou por "Pular"). */
  onConcluir: () => void;
}

const DIAS_LONGOS = [
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
  "domingo",
] as const;

// ─── Curvas ──────────────────────────────────────────────────────────────────

type Curva = [number, number, number, number];
const EXPO_OUT: Curva = [0.16, 1, 0.3, 1];
const EXPO_IN: Curva = [0.7, 0, 0.84, 0];
const EXPO_INOUT: Curva = [0.87, 0, 0.13, 1];
const SINE_INOUT: Curva = [0.37, 0, 0.63, 1];

const MOLA: Transition = { type: "spring", stiffness: 320, damping: 17 };

// ─── Formatação ──────────────────────────────────────────────────────────────

const inteiro = new Intl.NumberFormat("pt-BR");
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, signDisplay: "exceptZero" });
const pctSimples = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function variacao(atual: number, anterior: number | undefined): number | null {
  if (!anterior || anterior <= 0) return null;
  return ((atual - anterior) / anterior) * 100;
}

function indiceDoMaior(valores: readonly number[]): number {
  let melhor = 0;
  valores.forEach((v, i) => {
    if (v > valores[melhor]) melhor = i;
  });
  return melhor;
}

// ─── Peças soltas ────────────────────────────────────────────────────────────

/** Conta de 0 até `valor`, desacelerando no fim — um contador que freia, não que desliza. */
function Contador({
  valor,
  formatar = (n) => inteiro.format(n),
  atraso,
  duracao = 2,
}: {
  valor: number;
  formatar?: (n: number) => string;
  atraso: number;
  duracao?: number;
}) {
  const [atual, setAtual] = useState(0);
  useEffect(() => {
    const controle = animate(0, valor, {
      duration: duracao,
      delay: atraso,
      ease: EXPO_OUT,
      onUpdate: (n) => setAtual(n),
    });
    return () => controle.stop();
  }, [valor, atraso, duracao]);
  return <>{formatar(Math.round(atual))}</>;
}

/** Linha que sobe de uma máscara — títulos. */
function Revela({
  children,
  atraso,
  className = "",
}: {
  children: ReactNode;
  atraso: number;
  className?: string;
}) {
  return (
    <span className="block overflow-hidden pb-[0.12em]">
      <motion.span
        initial={{ y: "112%", rotate: 3 }}
        animate={{ y: 0, rotate: 0 }}
        transition={{ duration: 1, ease: EXPO_OUT, delay: atraso }}
        className={`block origin-bottom-left ${className}`}
      >
        {children}
      </motion.span>
    </span>
  );
}

const TITULO = "font-semibold leading-[0.96] tracking-[-0.04em] text-[clamp(2.6rem,8.4vw,7.4rem)]";
const NUMERO = "font-semibold leading-[0.88] tracking-[-0.05em] tabular-nums text-[clamp(3.6rem,11vw,9.6rem)]";
const ROTULO = "text-base font-medium text-muted-foreground sm:text-xl";

/** Texto sobre a tela, com um véu à esquerda para a leitura sobreviver à imagem. */
function Legenda({ children, atraso = 0 }: { children: ReactNode; atraso?: number }) {
  return (
    <>
      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: atraso }}
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[72%] bg-gradient-to-r from-background via-background/85 to-transparent"
      />
      <div className="absolute left-6 top-[12%] z-20 max-w-[88%] sm:left-12">{children}</div>
    </>
  );
}

function Variacao({ atual, anterior, atraso }: { atual: number; anterior?: number; atraso: number }) {
  const v = variacao(atual, anterior);
  if (v === null) return null;
  const subiu = v >= 0;
  return (
    <motion.p
      initial={{ opacity: 0, y: 14, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...MOLA, delay: atraso }}
      className="mt-5 origin-left text-base text-muted-foreground sm:text-xl"
    >
      <span className={subiu ? "font-semibold text-success" : "font-semibold text-destructive"}>
        {subiu ? "↑" : "↓"} {pct.format(v)}%
      </span>{" "}
      sobre a semana anterior
    </motion.p>
  );
}

/** Estouro de fagulhas e anel num ponto da tela (coordenadas de 1200×700). */
function Estouro({ x, y, atraso, n = 22, raio = 170 }: { x: number; y: number; atraso: number; n?: number; raio?: number }) {
  return (
    <div className="pointer-events-none absolute z-50" style={{ left: x, top: y }} aria-hidden>
      <motion.span
        initial={{ scale: 0.1, opacity: 0 }}
        animate={{ scale: [0.1, 3.2], opacity: [0.9, 0] }}
        transition={{ duration: 0.9, delay: atraso, ease: EXPO_OUT }}
        className="absolute -left-16 -top-16 h-32 w-32 rounded-full border-2 border-primary"
      />
      {Array.from({ length: n }, (_, i) => {
        const ang = (i / n) * Math.PI * 2 + (i % 2) * 0.22;
        const dist = raio * (0.55 + ((Math.sin(i * 12.9898) + 1) / 2) * 0.7);
        const tam = 5 + ((i * 7) % 6);
        return (
          <motion.span
            key={i}
            initial={{ x: 0, y: 0, opacity: 0, scale: 1 }}
            animate={{ x: Math.cos(ang) * dist, y: Math.sin(ang) * dist + 30, opacity: [1, 1, 0], scale: [1, 1, 0.2] }}
            transition={{
              x: { duration: 1.1, delay: atraso, ease: EXPO_OUT },
              y: { duration: 1.1, delay: atraso, ease: EXPO_OUT },
              opacity: { duration: 1.1, delay: atraso, times: [0, 0.5, 1] },
              scale: { duration: 1.1, delay: atraso, times: [0, 0.5, 1] },
            }}
            className="absolute rounded-full bg-primary shadow-[0_0_14px_3px_hsl(var(--primary)/0.8)]"
            style={{ width: tam, height: tam, left: -tam / 2, top: -tam / 2 }}
          />
        );
      })}
    </div>
  );
}

/** Cursor do mouse, andando por pontos da tela, com pausa para o clique. */
function Cursor({
  pontos,
  tempos,
  atraso,
  duracao,
}: {
  pontos: { x: number; y: number }[];
  tempos: number[];
  atraso: number;
  duracao: number;
}) {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 z-[60]"
      initial={{ x: pontos[0].x, y: pontos[0].y, opacity: 0 }}
      animate={{ x: pontos.map((p) => p.x), y: pontos.map((p) => p.y), opacity: [0, 1, 1, 1, 1, 0] }}
      transition={{
        x: { duration: duracao, delay: atraso, times: tempos, ease: SINE_INOUT },
        y: { duration: duracao, delay: atraso, times: tempos, ease: SINE_INOUT },
        opacity: { duration: duracao, delay: atraso, times: tempos },
      }}
    >
      <svg width="30" height="30" viewBox="0 0 24 24" className="drop-shadow-[0_4px_8px_rgba(0,0,0,0.7)]">
        <path d="M4 2l16 9-7 2-3 7z" fill="white" stroke="black" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </motion.div>
  );
}

/** A tela do Torque numa caixa que a câmera move em 3D. `esc` encaixa os 1200×700 na janela. */
function Palco({
  esc,
  origem,
  initial,
  animar,
  transition,
  topo = "58%",
  esq = "50%",
  children,
}: {
  esc: number;
  origem: string;
  initial: TargetAndTransition;
  animar: TargetAndTransition;
  transition: Transition;
  /** Onde fica o centro da tela, em % da janela. A legenda ocupa o canto superior esquerdo: empurrar a tela para a direita e para baixo a libera. */
  topo?: string;
  esq?: string;
  children: ReactNode;
}) {
  const l = TELA_L * esc;
  const a = TELA_A * esc;
  return (
    <div
      className="absolute"
      style={{ left: esq, top: topo, width: l, height: a, marginLeft: -l / 2, marginTop: -a / 2, perspective: 1700 }}
    >
      <motion.div
        initial={initial}
        animate={animar}
        transition={transition}
        style={{ width: l, height: a, transformOrigin: origem }}
      >
        <div style={{ width: TELA_L, height: TELA_A, transform: `scale(${esc})`, transformOrigin: "0 0" }}>{children}</div>
      </motion.div>
    </div>
  );
}

function useEscala(): number {
  const calcular = () => Math.min((window.innerWidth * 0.92) / TELA_L, (window.innerHeight * 0.68) / TELA_A);
  const [esc, setEsc] = useState(calcular);
  useEffect(() => {
    const aoRedimensionar = () => setEsc(calcular());
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, []);
  return esc;
}

interface CenaProps {
  esc: number;
  nome: string;
  saudacao: string;
  resumo: ResumoSemana;
}

// ─── 1 · Impacto ─────────────────────────────────────────────────────────────

function CenaImpacto({ saudacao, nome }: CenaProps) {
  const letras = "SEGUNDA".split("");
  return (
    <motion.div
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      className="absolute inset-0 flex flex-col items-start justify-center px-6 sm:px-12"
      style={{ zIndex: 80 }}
    >
      {/* O horizonte: um risco de luz atravessa a tela e some quando o mergulho começa. */}
      <motion.span
        aria-hidden
        initial={{ scaleX: 0, opacity: 1 }}
        animate={{ scaleX: 1, opacity: [1, 1, 0] }}
        transition={{
          scaleX: { duration: 0.9, delay: 0.1, ease: EXPO_OUT },
          opacity: { duration: 3.3, times: [0, 0.65, 1] },
        }}
        style={{ originX: 0 }}
        className="absolute left-0 right-0 top-[63%] h-px bg-primary shadow-[0_0_24px_4px_hsl(var(--primary)/0.8)]"
      />

      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: [0, 1, 1, 0], y: 0 }}
        transition={{ duration: 3.4, delay: 0.5, times: [0, 0.12, 0.7, 1] }}
        className="mb-4 text-base text-muted-foreground sm:text-2xl"
      >
        {saudacao}, {nome}.
      </motion.p>

      {/* Câmera: segura o título e mergulha no ponto final (a origem é o canto do "."). */}
      <motion.h1
        initial={{ scale: 1, opacity: 1 }}
        animate={{ scale: [1, 1, 30], opacity: [1, 1, 1, 0] }}
        transition={{
          scale: { duration: 4.1, times: [0, 0.56, 1], ease: [SINE_INOUT, EXPO_IN] },
          opacity: { duration: 4.1, times: [0, 0.56, 0.9, 1] },
        }}
        style={{ transformOrigin: "97% 84%" }}
        className="flex items-end font-semibold leading-[0.82] tracking-[-0.055em] text-[clamp(3rem,15.5vw,15rem)]"
      >
        {letras.map((l, i) => (
          <span key={i} className="overflow-hidden pb-[0.06em]">
            <motion.span
              initial={{ y: "115%", rotate: 10, scale: 1.25 }}
              animate={{ y: 0, rotate: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 340, damping: 21, delay: 0.3 + i * 0.07 }}
              className="inline-block origin-bottom-left"
            >
              {l}
            </motion.span>
          </span>
        ))}
        <motion.span
          initial={{ scale: 0, y: -40 }}
          animate={{ scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 520, damping: 13, delay: 0.3 + letras.length * 0.07 + 0.08 }}
          className="inline-block text-primary [text-shadow:0_0_60px_hsl(var(--primary)/0.9)]"
        >
          .
        </motion.span>
      </motion.h1>
    </motion.div>
  );
}

// ─── 2 · Leads ───────────────────────────────────────────────────────────────

function CenaLeads({ esc, resumo }: CenaProps) {
  const quedas = [0, 1, 2, 3, 4, 5, 6];
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.72 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ x: "-118%", filter: "blur(18px)", transition: { duration: 0.7, ease: EXPO_IN } }}
      transition={{ duration: 1, ease: EXPO_OUT }}
      className="absolute inset-0"
      style={{ zIndex: 10 }}
    >
      <Palco
        esc={esc}
        esq="60%"
        topo="68%"
        origem="27% 24%"
        initial={{ y: 200, rotateX: 42, rotateY: -32, rotateZ: -5, scale: 0.7, opacity: 0 }}
        animar={{
          y: [200, 0, -14, -40],
          rotateX: [42, 14, 11, 6],
          rotateY: [-32, -17, -12, -5],
          rotateZ: [-5, -1.5, -0.8, 0],
          scale: [0.7, 1, 1.1, 1.42],
          opacity: [0, 1, 1, 1],
        }}
        transition={{ duration: 5.6, times: [0, 0.2, 0.55, 1], ease: [EXPO_OUT, SINE_INOUT, EXPO_INOUT] }}
      >
        <TelaFunil
          destaque="novo"
          contagem={{
            novo: <Contador valor={resumo.leads} atraso={1.1} duracao={2.6} />,
          }}
          topo={{
            novo: quedas.map((i) => (
              <motion.div
                key={i}
                initial={{ height: 0, marginBottom: -10 }}
                animate={{ height: FUNIL.cartaoA, marginBottom: 0 }}
                transition={{ delay: 1.0 + i * 0.3, duration: 0.45, ease: EXPO_OUT }}
              >
                <motion.div
                  initial={{ y: -240, rotate: i % 2 ? -7 : 7, opacity: 0 }}
                  animate={{ y: 0, rotate: 0, opacity: 1 }}
                  transition={{ ...MOLA, delay: 1.0 + i * 0.3, opacity: { duration: 0.15, delay: 1.0 + i * 0.3 } }}
                >
                  <CartaoLead dado={CARTOES[i]} />
                </motion.div>
              </motion.div>
            )),
          }}
        />
      </Palco>

      <Legenda>
        <motion.p
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: EXPO_OUT, delay: 0.4 }}
          className={ROTULO}
        >
          Leads novos
        </motion.p>
        <p className={`mt-2 ${NUMERO}`}>
          <Contador valor={resumo.leads} atraso={1.0} duracao={2.6} />
        </p>
        <Variacao atual={resumo.leads} anterior={resumo.anterior?.leads} atraso={3.2} />
      </Legenda>
    </motion.div>
  );
}

// ─── 3 · Vendas ──────────────────────────────────────────────────────────────

function CenaVendas({ esc, resumo }: CenaProps) {
  const ticket = resumo.vendas > 0 ? resumo.receita / resumo.vendas : 0;
  // Todos os instantes abaixo são relativos ao início da cena, em segundos.
  const T_CURSOR = 1.0;
  const D_CURSOR = 3.4;
  /** O soltar: 60% do percurso do cursor. */
  const T_SOLTA = T_CURSOR + D_CURSOR * 0.6;
  const origem = centroDoCartao(3);
  const destino = centroDoCartao(4);

  return (
    <motion.div
      initial={{ x: "118%", filter: "blur(18px)" }}
      animate={{ x: 0, filter: "blur(0px)" }}
      exit={{ y: "-110%", scale: 0.9, transition: { duration: 0.7, ease: EXPO_IN } }}
      transition={{ duration: 0.95, ease: EXPO_OUT }}
      className="absolute inset-0"
      style={{ zIndex: 20 }}
    >
      <Palco
        esc={esc}
        origem="78% 28%"
        initial={{ rotateY: 22, rotateX: 10, rotateZ: 3, scale: 1.3 }}
        animar={{
          rotateY: [22, 13, 13, 9],
          rotateX: [10, 7, 7, 4],
          rotateZ: [3, 0, 0, 0],
          scale: [1.3, 1.6, 1.6, 1.78],
          // O soco: câmera estala quando o cartão cai e treme até assentar.
          x: [0, 0, 0, -14, 10, -6, 3, 0],
        }}
        transition={{
          rotateY: { duration: 5.3, times: [0, 0.18, 0.56, 1], ease: [EXPO_OUT, SINE_INOUT, SINE_INOUT] },
          rotateX: { duration: 5.3, times: [0, 0.18, 0.56, 1], ease: [EXPO_OUT, SINE_INOUT, SINE_INOUT] },
          rotateZ: { duration: 5.3, times: [0, 0.18, 0.56, 1], ease: [EXPO_OUT, SINE_INOUT, SINE_INOUT] },
          scale: { duration: 5.3, times: [0, 0.18, 0.56, 1], ease: [EXPO_OUT, EXPO_OUT, SINE_INOUT] },
          x: { duration: 0.9, delay: T_SOLTA, times: [0, 0.01, 0.01, 0.2, 0.45, 0.65, 0.85, 1], ease: "easeOut" },
        }}
      >
        <TelaFunil
          destaque="vendido"
          contagem={{ vendido: <Contador valor={resumo.vendas} atraso={T_SOLTA} duracao={2.2} /> }}
          topo={{
            negociacao: (
              <motion.div
                initial={{ height: FUNIL.cartaoA, marginBottom: 0 }}
                animate={{ height: 0, marginBottom: -10 }}
                transition={{ delay: T_SOLTA + 0.1, duration: 0.5, ease: EXPO_OUT }}
                className="relative z-40"
              >
                <motion.div
                  initial={{ x: 0, y: 0, rotate: 0, scale: 1 }}
                  animate={{
                    x: [0, 0, PASSO_COLUNA, PASSO_COLUNA, PASSO_COLUNA],
                    y: [0, 0, -26, 0, 0],
                    rotate: [0, 0, 6, -1.5, 0],
                    scale: [1, 1, 1.1, 0.96, 1],
                  }}
                  transition={{
                    duration: D_CURSOR * 0.3 + 0.6,
                    delay: T_CURSOR + D_CURSOR * 0.3,
                    times: [0, 0.01, 0.78, 0.9, 1],
                    ease: SINE_INOUT,
                  }}
                  style={{ filter: "drop-shadow(0 18px 24px rgba(0,0,0,0.6))" }}
                >
                  <CartaoLead dado={CARTOES[1]} className="ring-1 ring-primary/70" />
                </motion.div>
              </motion.div>
            ),
            vendido: (
              <motion.div
                initial={{ opacity: 1 }}
                animate={{ opacity: 0 }}
                transition={{ delay: T_SOLTA, duration: 0.2 }}
                className="rounded-lg border-2 border-dashed border-primary/60"
                style={{ height: FUNIL.cartaoA }}
              />
            ),
          }}
          sobre={
            <>
              <Cursor
                atraso={T_CURSOR}
                duracao={D_CURSOR}
                tempos={[0, 0.22, 0.3, 0.6, 0.68, 1]}
                pontos={[
                  { x: 930, y: 380 },
                  { x: origem.x + 12, y: origem.y - 6 },
                  { x: origem.x + 12, y: origem.y - 6 },
                  { x: destino.x + 12, y: destino.y - 6 },
                  { x: destino.x + 12, y: destino.y - 6 },
                  { x: 1150, y: 420 },
                ]}
              />
              <Estouro x={destino.x} y={destino.y} atraso={T_SOLTA} />
              {/* O valor sobe do cartão que acabou de fechar. */}
              <motion.p
                initial={{ opacity: 0, y: 0 }}
                animate={{ opacity: [0, 1, 1, 0], y: [0, -30, -70, -110] }}
                transition={{ duration: 2.1, delay: T_SOLTA + 0.15, times: [0, 0.2, 0.7, 1], ease: EXPO_OUT }}
                className="pointer-events-none absolute z-50 whitespace-nowrap text-2xl font-semibold text-success [text-shadow:0_0_24px_hsl(var(--success)/0.7)]"
                style={{ left: destino.x - 70, top: destino.y - 50 }}
              >
                + {brl.format(ticket)}
              </motion.p>
            </>
          }
        />
      </Palco>

      <Legenda>
        <motion.p
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: EXPO_OUT, delay: 0.5 }}
          className={ROTULO}
        >
          Vendas fechadas
        </motion.p>
        <p className={`mt-2 ${NUMERO}`}>
          <Contador valor={resumo.vendas} atraso={0.8} duracao={2.4} />
        </p>
        <Variacao atual={resumo.vendas} anterior={resumo.anterior?.vendas} atraso={T_SOLTA + 1.6} />
      </Legenda>
    </motion.div>
  );
}

// ─── 4 · Receita ─────────────────────────────────────────────────────────────

function CenaReceita({ esc, resumo }: CenaProps) {
  const valores = resumo.porDia.receita;
  const pico = indiceDoMaior(valores);
  const p = pontoDoGrafico(valores, pico);
  const origem = `${(p.x / TELA_L) * 100}% ${(p.y / TELA_A) * 100}%`;

  return (
    <motion.div
      initial={{ y: "112%" }}
      animate={{ y: 0 }}
      exit={{ scale: 1.7, opacity: 0, filter: "blur(16px)", transition: { duration: 0.7, ease: EXPO_IN } }}
      transition={{ duration: 1, ease: EXPO_OUT }}
      className="absolute inset-0"
      style={{ zIndex: 30 }}
    >
      <Palco
        esc={esc}
        topo="67%"
        origem={origem}
        initial={{ rotateX: 24, rotateY: 8, scale: 0.9 }}
        animar={{
          rotateX: [24, 4, 4, 0, 0, 5],
          rotateY: [8, -4, -4, 0, 0, -3],
          // Vista aberta → mergulho no pico → recuo.
          scale: [0.9, 1.04, 1.04, 2.7, 2.7, 1.18],
        }}
        transition={{
          duration: 6.0,
          times: [0, 0.16, 0.5, 0.66, 0.84, 1],
          ease: [EXPO_OUT, SINE_INOUT, EXPO_INOUT, SINE_INOUT, EXPO_INOUT],
        }}
      >
        <TelaDashboard
          sobre={
            <>
              <GraficoReceita valores={valores} atraso={1.0} duracao={2.2} ease={EXPO_INOUT} />
              {/* Etiqueta do pico: chega junto do mergulho. */}
              <motion.div
                initial={{ opacity: 0, y: 14, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ ...MOLA, delay: 3.9 }}
                className="absolute z-50 whitespace-nowrap rounded-lg border border-primary/60 bg-card px-3.5 py-2 shadow-[0_0_40px_-6px_hsl(var(--primary)/0.7)]"
                style={{ left: p.x + 18, top: p.y - 64 }}
              >
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{DIAS_LONGOS[pico]}</p>
                <p className="text-lg font-semibold tabular-nums text-primary">{brl.format(valores[pico])}</p>
              </motion.div>
            </>
          }
        />
      </Palco>

      {/* A legenda sai de cena para a câmera poder mergulhar. */}
      <motion.div
        initial={{ opacity: 1 }}
        animate={{ opacity: [1, 1, 0] }}
        transition={{ duration: 3.4, times: [0, 0.82, 1] }}
      >
        <Legenda>
          <motion.p
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, ease: EXPO_OUT, delay: 0.5 }}
            className={ROTULO}
          >
            Receita
          </motion.p>
          <p className={`mt-2 ${NUMERO}`}>
            <Contador valor={resumo.receita} formatar={(n) => brl.format(n)} atraso={0.9} duracao={2.4} />
          </p>
          <Variacao atual={resumo.receita} anterior={resumo.anterior?.receita} atraso={2.5} />
        </Legenda>
      </motion.div>
    </motion.div>
  );
}

// ─── 5 · Automações ──────────────────────────────────────────────────────────

/** Uma centelha percorre o fluxo, acendendo cada passo, e repete — é a automação rodando. */
function Pulsos({ atraso }: { atraso: number }) {
  const centros = NOS_WORKFLOW.map((_, i) => centroDoNo(i));
  const passo = 0.5;
  const trecho = passo * (centros.length - 1);
  const passada = trecho + 0.4;
  const voltas = 3;
  return (
    <>
      {NOS_WORKFLOW.map((n, i) => (
        <motion.span
          key={n.titulo}
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 0.7, delay: atraso + i * passo, repeat: voltas - 1, repeatDelay: passada - 0.7 }}
          className="absolute rounded-2xl ring-2 ring-primary shadow-[0_0_44px_8px_hsl(var(--primary)/0.55)]"
          style={{ left: n.x - 5, top: n.y - 5, width: NO_WORKFLOW.l + 10, height: NO_WORKFLOW.a + 10 }}
        />
      ))}
      <motion.span
        aria-hidden
        initial={{ x: centros[0].x, y: centros[0].y, opacity: 0 }}
        animate={{ x: centros.map((c) => c.x), y: centros.map((c) => c.y), opacity: [0, 1, 1, 1] }}
        transition={{
          duration: trecho,
          delay: atraso,
          repeat: voltas - 1,
          repeatDelay: passada - trecho,
          ease: SINE_INOUT,
        }}
        className="absolute left-0 top-0 z-40 -ml-[7px] -mt-[7px] h-3.5 w-3.5 rounded-full bg-primary shadow-[0_0_24px_7px_hsl(var(--primary)/0.9)]"
      />
    </>
  );
}

function CenaAutomacoes({ esc, resumo }: CenaProps) {
  const a = resumo.automacoes!;
  return (
    <motion.div
      // Entra por uma íris que abre — a receita saiu mergulhando para a frente, e esta cena é o que há do outro lado.
      initial={{ clipPath: "circle(0% at 50% 58%)" }}
      animate={{ clipPath: "circle(150% at 50% 58%)" }}
      exit={{ x: "118%", rotate: 5, filter: "blur(18px)", transition: { duration: 0.7, ease: EXPO_IN } }}
      transition={{ duration: 1.15, ease: EXPO_OUT }}
      className="absolute inset-0"
      style={{ zIndex: 40 }}
    >
      <Palco
        esc={esc}
        esq="58%"
        topo="68%"
        origem="50% 48%"
        initial={{ rotateX: 32, rotateZ: -9, scale: 0.78, opacity: 0 }}
        animar={{ rotateX: [32, 12, 7], rotateZ: [-9, -2, 0], scale: [0.78, 1.0, 1.22], opacity: [0, 1, 1] }}
        transition={{ duration: 4.8, times: [0, 0.22, 1], ease: [EXPO_OUT, SINE_INOUT] }}
      >
        <TelaWorkflow nomeDaAutomacao={a.top?.nome ?? "Automações"} sobre={<Pulsos atraso={1.0} />} />
      </Palco>

      <Legenda>
        <motion.p
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: EXPO_OUT, delay: 0.5 }}
          className={ROTULO}
        >
          Execuções de automação
        </motion.p>
        <p className={`mt-2 ${NUMERO}`}>
          <Contador valor={a.execucoes} atraso={0.9} duracao={2.4} />
        </p>
        <Variacao atual={a.execucoes} anterior={a.anterior} atraso={2.9} />
        {a.top && (
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...MOLA, delay: 3.2 }}
            className="mt-4 max-w-[28rem] text-base text-muted-foreground sm:text-lg"
          >
            A que mais rodou: <span className="font-semibold text-foreground">{a.top.nome}</span>, {inteiro.format(a.top.execucoes)}{" "}
            {a.top.execucoes === 1 ? "vez" : "vezes"}
          </motion.p>
        )}
      </Legenda>
    </motion.div>
  );
}

// ─── 6 · Movimentação ────────────────────────────────────────────────────────

const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

/** Cartões cruzam as faixas do funil em arco, sem parar: é um vendedor movendo lead. */
function CartoesEmVoo() {
  const faixas = [12, 30, 48, 66, 84];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {faixas.map((f) => (
        <span key={f} className="absolute inset-y-0 w-px bg-foreground/[0.06]" style={{ left: `${f}%` }} />
      ))}
      {Array.from({ length: 15 }, (_, i) => {
        const de = i % 4;
        const topo = 14 + ((i * 37) % 62);
        const atraso = 0.5 + (i % 5) * 0.28 + Math.floor(i / 5) * 0.55;
        return (
          <motion.div
            key={i}
            initial={{ left: `${faixas[de]}%`, opacity: 0 }}
            animate={{ left: [`${faixas[de]}%`, `${faixas[de + 1]}%`], opacity: [0, 0.8, 0.8, 0] }}
            transition={{
              left: { duration: 1.5, delay: atraso, ease: EXPO_INOUT, repeat: Infinity, repeatDelay: 1.1 },
              opacity: { duration: 1.5, delay: atraso, times: [0, 0.15, 0.8, 1], repeat: Infinity, repeatDelay: 1.1 },
            }}
            className="absolute w-[208px] origin-top-left"
            style={{ top: `${topo}%`, transform: "scale(0.6) translateX(-50%)" }}
          >
            <motion.div
              animate={{ y: [0, -64, 0], rotate: [-5, 4, 0] }}
              transition={{ duration: 1.5, delay: atraso, ease: SINE_INOUT, repeat: Infinity, repeatDelay: 1.1 }}
            >
              <CartaoLead dado={CARTOES[i % CARTOES.length]} />
            </motion.div>
          </motion.div>
        );
      })}
    </div>
  );
}

function CenaMovimentacao({ resumo }: CenaProps) {
  const m = resumo.movimentacao!;
  const topo = m.top;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6, rotate: -7 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      exit={{ scale: 0.5, opacity: 0, filter: "blur(10px)", transition: { duration: 0.7, ease: EXPO_IN } }}
      transition={{ duration: 1.1, ease: EXPO_OUT }}
      className="absolute inset-0"
      style={{ zIndex: 50 }}
    >
      <CartoesEmVoo />
      <div aria-hidden className="absolute inset-y-0 left-0 w-[78%] bg-gradient-to-r from-background via-background/90 to-transparent" />

      <div className="absolute left-6 top-[14%] z-20 sm:left-12">
        <motion.p
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: EXPO_OUT, delay: 0.4 }}
          className={ROTULO}
        >
          Quem mais movimentou leads
        </motion.p>

        <div className="mt-5 flex items-center gap-5 sm:gap-7">
          <motion.span
            initial={{ scale: 0, rotate: -40 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 15, delay: 0.7 }}
            className="flex h-[clamp(4.5rem,11vw,9rem)] w-[clamp(4.5rem,11vw,9rem)] shrink-0 items-center justify-center rounded-full bg-primary text-[clamp(1.6rem,4vw,3.4rem)] font-semibold text-primary-foreground shadow-[0_0_80px_-6px_hsl(var(--primary)/0.8)]"
          >
            {iniciais(topo.nome)}
          </motion.span>
          <h2 className={TITULO}>
            <Revela atraso={0.9}>{topo.nome}</Revela>
          </h2>
        </div>

        <p className={`mt-6 ${NUMERO}`}>
          <Contador valor={topo.movimentos} atraso={1.3} duracao={2.2} />
        </p>
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...MOLA, delay: 2.0 }}
          className="mt-3 text-base text-muted-foreground sm:text-xl"
        >
          {topo.movimentos === 1 ? "lead movido" : "leads movidos"} de etapa
          {m.total > topo.movimentos && (
            <>
              {" "}
              · de {inteiro.format(m.total)} no time todo
            </>
          )}
        </motion.p>
        {topo.voce && (
          <motion.p
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ ...MOLA, delay: 2.6 }}
            className="mt-5 origin-left text-2xl font-semibold text-primary sm:text-4xl [text-shadow:0_0_40px_hsl(var(--primary)/0.7)]"
          >
            Foi você.
          </motion.p>
        )}
      </div>
    </motion.div>
  );
}

// ─── 7 · Ranking do mês ──────────────────────────────────────────────────────

function CenaRanking({ resumo }: CenaProps) {
  const r = resumo.ranking!;
  const mes = nomeDoMes(r.mes, r.ano);
  const maximo = Math.max(...r.top.map((t) => t.valor), 1);
  const voceFora = r.voce && !r.top.some((t) => t.voce);
  return (
    <motion.div
      initial={{ opacity: 0, rotateY: -38, x: "26%", transformPerspective: 1400 }}
      animate={{ opacity: 1, rotateY: 0, x: 0 }}
      exit={{ scale: 2.2, opacity: 0, filter: "blur(16px)", transition: { duration: 0.7, ease: EXPO_IN } }}
      transition={{ duration: 1.2, ease: EXPO_OUT }}
      className="absolute inset-0"
      style={{ zIndex: 60 }}
    >
      {/* O número do 1º lugar, enorme e quase invisível, atrás de tudo. */}
      <motion.span
        aria-hidden
        initial={{ opacity: 0, scale: 1.4 }}
        animate={{ opacity: 0.07, scale: 1 }}
        transition={{ duration: 1.8, ease: EXPO_OUT, delay: 0.2 }}
        className="pointer-events-none absolute -right-[4%] top-[2%] select-none text-[clamp(18rem,52vw,48rem)] font-semibold leading-none tracking-[-0.06em] text-primary"
      >
        1
      </motion.span>

      <div className="absolute inset-x-6 top-[12%] z-20 sm:inset-x-12">
        <motion.p
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: EXPO_OUT, delay: 0.4 }}
          className={ROTULO}
        >
          {r.corrente ? `Ranking de ${mes}, até agora` : `Ranking de ${mes}, fechado`}
        </motion.p>

        <div className="mt-6 flex max-w-3xl flex-col gap-3 sm:gap-4">
          {r.top.map((t, i) => (
            <motion.div
              key={t.posicao}
              initial={{ x: "55%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ ...MOLA, delay: 0.7 + i * 0.3 }}
              className={
                t.voce
                  ? "flex items-center gap-4 rounded-2xl bg-primary/[0.09] p-3 ring-1 ring-primary/60 sm:gap-6 sm:p-4"
                  : "flex items-center gap-4 p-3 sm:gap-6 sm:p-4"
              }
            >
              <span
                className={
                  i === 0
                    ? "w-[0.8em] text-center text-[clamp(2.6rem,8vw,6rem)] font-semibold leading-none tabular-nums text-primary"
                    : "w-[0.8em] text-center text-[clamp(2.6rem,8vw,6rem)] font-semibold leading-none tabular-nums text-muted-foreground/55"
                }
              >
                {t.posicao}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="flex min-w-0 items-center gap-2 text-xl font-semibold sm:text-3xl">
                    {i === 0 && <Crown className="h-5 w-5 shrink-0 text-primary sm:h-7 sm:w-7" />}
                    <span className="truncate">{t.nome}</span>
                    {t.voce && <span className="shrink-0 text-sm font-medium text-primary sm:text-base">você</span>}
                  </p>
                  <p className="shrink-0 text-lg font-semibold tabular-nums sm:text-3xl">
                    <Contador valor={t.valor} formatar={(n) => brl.format(n)} atraso={0.9 + i * 0.3} duracao={1.8} />
                  </p>
                </div>
                <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-foreground/10">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: t.valor / maximo }}
                    transition={{ duration: 1.5, ease: EXPO_OUT, delay: 1.0 + i * 0.3 }}
                    style={{ originX: 0 }}
                    className={i === 0 ? "h-full bg-primary" : "h-full bg-foreground/40"}
                  />
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {t.vendas} {t.vendas === 1 ? "venda" : "vendas"}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        {voceFora && r.voce && (
          <motion.p
            initial={{ opacity: 0, y: 18, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ ...MOLA, delay: 2.2 }}
            className="mt-6 max-w-3xl origin-left px-3 text-base text-muted-foreground sm:px-4 sm:text-xl"
          >
            Você está em <span className="font-semibold text-primary">{r.voce.posicao}º</span> de {r.pessoas}
            {" · "}
            {brl.format(r.voce.valor)}
          </motion.p>
        )}
      </div>
    </motion.div>
  );
}

// ─── 8 · Fecho: o resumo de tudo ─────────────────────────────────────────────

/** "↑ 12,4% sobre a semana anterior" — some quando não há base de comparação. */
function SubVariacao({ atual, anterior }: { atual: number; anterior?: number }) {
  const v = variacao(atual, anterior);
  if (v === null) return null;
  return (
    <span className="block">
      <span className={v >= 0 ? "font-semibold text-success" : "font-semibold text-destructive"}>
        {v >= 0 ? "↑" : "↓"} {pct.format(v)}%
      </span>{" "}
      sobre a anterior
    </span>
  );
}

interface Tile {
  chave: string;
  rotulo: string;
  valor: string;
  sub?: ReactNode;
  destaque?: boolean;
}

/**
 * Tudo o que a abertura mostrou, em ordem, num só lugar. O último quadro é este:
 * quem só olhou o final sai sabendo o essencial, e quem viu tudo reconhece.
 * Cada bloco opcional entra só se a org o tem — o painel acompanha as cenas.
 */
function tilesDoResumo(resumo: ResumoSemana): Tile[] {
  // O painel nunca mostra dado de uma cena que não tocou: a fonte é o MESMO plano que escolheu as cenas.
  const cenas = new Set(planejarCenas(resumo));
  const pico = indiceDoMaior(resumo.porDia.vendas);
  const conversao = resumo.leads > 0 ? (resumo.vendas / resumo.leads) * 100 : 0;
  const ticket = resumo.vendas > 0 ? resumo.receita / resumo.vendas : 0;
  const tiles: Tile[] = [];

  if (cenas.has("leads")) {
    tiles.push({
      chave: "leads",
      rotulo: "Leads novos",
      valor: inteiro.format(resumo.leads),
      sub: <SubVariacao atual={resumo.leads} anterior={resumo.anterior?.leads} />,
    });
  }
  if (cenas.has("vendas")) {
    tiles.push({
      chave: "vendas",
      rotulo: "Vendas fechadas",
      valor: inteiro.format(resumo.vendas),
      sub: <SubVariacao atual={resumo.vendas} anterior={resumo.anterior?.vendas} />,
    });
  }
  if (cenas.has("receita")) {
    tiles.push({
      chave: "receita",
      rotulo: "Receita",
      valor: brl.format(resumo.receita),
      sub: <SubVariacao atual={resumo.receita} anterior={resumo.anterior?.receita} />,
      destaque: true,
    });
  }

  const a = resumo.automacoes;
  if (a && cenas.has("automacoes")) {
    tiles.push({
      chave: "automacoes",
      rotulo: "Execuções de automação",
      valor: inteiro.format(a.execucoes),
      sub: (
        <>
          <SubVariacao atual={a.execucoes} anterior={a.anterior} />
          {a.top && (
            <span className="block truncate">
              {a.top.nome} · {inteiro.format(a.top.execucoes)}×
            </span>
          )}
        </>
      ),
    });
  }

  const m = resumo.movimentacao;
  if (m && cenas.has("movimentacao")) {
    tiles.push({
      chave: "movimentacao",
      rotulo: "Quem mais movimentou leads",
      valor: m.top.voce ? "Você" : m.top.nome,
      sub: `${inteiro.format(m.top.movimentos)} ${m.top.movimentos === 1 ? "lead movido" : "leads movidos"}`,
      destaque: m.top.voce,
    });
  }

  const r = resumo.ranking;
  if (r && cenas.has("ranking")) {
    const primeiro = r.top[0];
    tiles.push({
      chave: "ranking",
      rotulo: `Ranking de ${nomeDoMes(r.mes, r.ano)}${r.corrente ? ", até agora" : ""}`,
      valor: `1º ${primeiro.nome}`,
      sub: (
        <>
          <span className="block truncate">{brl.format(primeiro.valor)}</span>
          {r.voce && (
            <span className="block text-primary">
              você em {r.voce.posicao}º de {r.pessoas}
            </span>
          )}
        </>
      ),
      destaque: Boolean(r.voce) || r.top.some((t) => t.voce),
    });
  }

  // Os três derivados só fazem sentido com venda (e ticket, com receita; conversão, com lead).
  if (cenas.has("vendas")) {
    tiles.push({
      chave: "melhor-dia",
      rotulo: "Melhor dia em vendas",
      valor: DIAS_LONGOS[pico],
      sub: `${inteiro.format(resumo.porDia.vendas[pico])} ${resumo.porDia.vendas[pico] === 1 ? "venda" : "vendas"}`,
    });
  }
  if (cenas.has("vendas") && cenas.has("leads")) {
    tiles.push({ chave: "conversao", rotulo: "Conversão de lead em venda", valor: `${pctSimples.format(conversao)}%` });
  }
  if (cenas.has("receita")) {
    tiles.push({ chave: "ticket", rotulo: "Ticket médio", valor: brl.format(ticket) });
  }
  return tiles;
}

/** O painel do último quadro. `animar = false` é a versão sem movimento: os mesmos dados, parados. */
function PainelResumo({
  resumo,
  nome,
  animar,
  atraso = 0,
}: {
  resumo: ResumoSemana;
  nome: string;
  animar: boolean;
  atraso?: number;
}) {
  const tiles = tilesDoResumo(resumo);
  return (
    <div className="flex h-full flex-col">
      <h2 className="font-semibold leading-[1] tracking-[-0.04em] text-[clamp(2rem,5.2vw,4.4rem)]">
        {animar ? (
          <>
            <Revela atraso={atraso} className="text-muted-foreground">
              Boa semana,
            </Revela>
            <Revela atraso={atraso + 0.15}>{nome}.</Revela>
          </>
        ) : (
          <>
            <span className="block text-muted-foreground">Boa semana,</span>
            <span className="block">{nome}.</span>
          </>
        )}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground sm:text-base">Resumo da semana de {resumo.periodo}</p>

      <dl className="mt-5 grid grid-cols-2 gap-2.5 sm:mt-6 sm:grid-cols-3 sm:gap-4">
        {tiles.map((t, i) => {
          const cartao = (
            <>
              <dt className="truncate text-xs text-muted-foreground sm:text-sm">{t.rotulo}</dt>
              <dd className="mt-1 truncate text-xl font-semibold tabular-nums tracking-tight sm:mt-1.5 sm:text-[1.9rem] sm:leading-tight">
                {t.valor}
              </dd>
              {t.sub && <div className="mt-1 text-xs text-muted-foreground sm:text-sm">{t.sub}</div>}
            </>
          );
          const classe = t.destaque
            ? "min-w-0 rounded-2xl border border-primary/50 bg-primary/[0.07] p-3 shadow-[0_0_44px_-14px_hsl(var(--primary)/0.6)] sm:p-4"
            : "min-w-0 rounded-2xl border border-border/70 bg-card/70 p-3 sm:p-4";
          return animar ? (
            <motion.div
              key={t.chave}
              initial={{ opacity: 0, y: 28, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ ...MOLA, delay: atraso + 0.9 + i * 0.12 }}
              className={classe}
            >
              {cartao}
            </motion.div>
          ) : (
            <div key={t.chave} className={classe}>
              {cartao}
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function CenaFecho({ esc, nome, resumo }: CenaProps) {
  const parede = esc * 0.7;
  const l = TELA_L * parede;
  const a = TELA_A * parede;

  const tela = (
    x: number,
    y: number,
    ry: number,
    rz: number,
    z: number,
    delay: number,
    conteudo: ReactNode,
  ) => (
    <motion.div
      initial={{ opacity: 0, x: x * 1.5, y: y * 1.5 + 80 }}
      animate={{ opacity: 1, x, y }}
      transition={{ duration: 1.6, ease: EXPO_OUT, delay }}
      className="absolute left-1/2 top-1/2"
      style={{ width: l, height: a, marginLeft: -l / 2, marginTop: -a / 2, zIndex: z }}
    >
      <div style={{ width: l, height: a, transform: `rotateY(${ry}deg) rotateZ(${rz}deg)` }}>
        <div style={{ width: TELA_L, height: TELA_A, transform: `scale(${parede})`, transformOrigin: "0 0" }}>{conteudo}</div>
      </div>
    </motion.div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="absolute inset-0"
      style={{ zIndex: 70 }}
    >
      {/* Recuo: a câmera começa colada num detalhe e abre até mostrar a parede inteira. */}
      <motion.div
        initial={{ scale: 3.6, rotateY: -10, rotateX: 6 }}
        animate={{ scale: [3.6, 1, 1.05], rotateY: [-10, -5, 2], rotateX: [6, 2, 0] }}
        transition={{ duration: 8.0, times: [0, 0.3, 1], ease: [EXPO_OUT, SINE_INOUT] }}
        style={{ perspective: 1900, transformOrigin: "50% 46%" }}
        className="absolute inset-0"
      >
        {tela(
          -l * 0.5,
          -a * 0.32,
          14,
          2,
          1,
          0.1,
          <TelaDashboard
            sobre={<GraficoReceita valores={resumo.porDia.receita} atraso={1.6} duracao={1.8} ease={EXPO_INOUT} />}
          />,
        )}
        {tela(l * 0.52, a * 0.3, -14, -2, 1, 0.25, <TelaConversa />)}
        {tela(0, 0, 0, 0, 2, 0, <TelaFunil destaque="vendido" />)}
      </motion.div>

      {/* A parede escurece quando o resumo chega: a imagem fica de textura, o texto é quem manda. */}
      <motion.div
        aria-hidden
        initial={{ opacity: 0.55 }}
        animate={{ opacity: 0.9 }}
        transition={{ duration: 1.4, ease: EXPO_OUT, delay: 2.0 }}
        className="absolute inset-0 bg-background"
      />

      <div className="absolute inset-x-6 bottom-[6%] top-[11%] z-20 sm:inset-x-12">
        <PainelResumo resumo={resumo} nome={nome} animar atraso={1.7} />
      </div>
    </motion.div>
  );
}

// ─── Sem movimento ───────────────────────────────────────────────────────────

/** As mesmas cenas, em texto e fade: sem 3D, sem zoom, sem contagem. */
function CenaSemMovimento({ id, nome, saudacao, resumo }: CenaProps & { id: CenaId }) {
  const metrica = (rotulo: string, valor: string, atual: number, anterior?: number) => {
    const v = variacao(atual, anterior);
    return (
      <>
        <p className={ROTULO}>{rotulo}</p>
        <p className={`mt-2 ${NUMERO}`}>{valor}</p>
        {v !== null && (
          <p className="mt-5 text-base text-muted-foreground sm:text-xl">
            <span className={v >= 0 ? "font-semibold text-success" : "font-semibold text-destructive"}>
              {v >= 0 ? "↑" : "↓"} {pct.format(v)}%
            </span>{" "}
            sobre a semana anterior
          </p>
        )}
      </>
    );
  };
  let conteudo: ReactNode;
  switch (id) {
    case "impacto":
      conteudo = (
        <>
          <p className={ROTULO}>
            {saudacao}, {nome}.
          </p>
          <h1 className={`mt-2 ${TITULO}`}>Segunda.</h1>
        </>
      );
      break;
    case "leads":
      conteudo = metrica("Leads novos", inteiro.format(resumo.leads), resumo.leads, resumo.anterior?.leads);
      break;
    case "vendas":
      conteudo = metrica("Vendas fechadas", inteiro.format(resumo.vendas), resumo.vendas, resumo.anterior?.vendas);
      break;
    case "receita":
      conteudo = metrica("Receita", brl.format(resumo.receita), resumo.receita, resumo.anterior?.receita);
      break;
    case "automacoes":
      conteudo = resumo.automacoes ? (
        <>
          {metrica("Execuções de automação", inteiro.format(resumo.automacoes.execucoes), resumo.automacoes.execucoes, resumo.automacoes.anterior)}
          {resumo.automacoes.top && (
            <p className="mt-4 text-base text-muted-foreground sm:text-xl">
              A que mais rodou: <span className="font-semibold text-foreground">{resumo.automacoes.top.nome}</span>, {inteiro.format(resumo.automacoes.top.execucoes)}{" "}
              {resumo.automacoes.top.execucoes === 1 ? "vez" : "vezes"}
            </p>
          )}
        </>
      ) : null;
      break;
    case "movimentacao":
      conteudo = resumo.movimentacao ? (
        <>
          <p className={ROTULO}>Quem mais movimentou leads</p>
          <h2 className={`mt-1 ${TITULO}`}>{resumo.movimentacao.top.voce ? "Você." : `${resumo.movimentacao.top.nome}.`}</h2>
          <p className="mt-4 text-base text-muted-foreground sm:text-xl">
            {inteiro.format(resumo.movimentacao.top.movimentos)} leads movidos de etapa
          </p>
        </>
      ) : null;
      break;
    case "ranking":
      conteudo = resumo.ranking ? (
        <>
          <p className={ROTULO}>
            {resumo.ranking.corrente
              ? `Ranking de ${nomeDoMes(resumo.ranking.mes, resumo.ranking.ano)}, até agora`
              : `Ranking de ${nomeDoMes(resumo.ranking.mes, resumo.ranking.ano)}, fechado`}
          </p>
          <ol className="mt-4 space-y-2 text-xl font-semibold sm:text-3xl">
            {resumo.ranking.top.map((t) => (
              <li key={t.posicao}>
                {t.posicao}º {t.nome}
                {t.voce ? " (você)" : ""} <span className="font-normal text-muted-foreground">{brl.format(t.valor)}</span>
              </li>
            ))}
          </ol>
          {resumo.ranking.voce && !resumo.ranking.top.some((t) => t.voce) && (
            <p className="mt-5 text-base text-muted-foreground sm:text-xl">
              Você está em {resumo.ranking.voce.posicao}º de {resumo.ranking.pessoas}.
            </p>
          )}
        </>
      ) : null;
      break;
    default:
      conteudo = (
        <div className="py-[8vh]">
          <PainelResumo resumo={resumo} nome={nome} animar={false} />
        </div>
      );
  }
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.5 } }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
      className="absolute inset-0 flex flex-col justify-center px-6 sm:px-12"
    >
      {conteudo}
    </motion.div>
  );
}

// ─── Peça ────────────────────────────────────────────────────────────────────

const CENAS: Record<CenaId, (p: CenaProps) => ReactNode> = {
  impacto: CenaImpacto,
  leads: CenaLeads,
  vendas: CenaVendas,
  receita: CenaReceita,
  automacoes: CenaAutomacoes,
  movimentacao: CenaMovimentacao,
  ranking: CenaRanking,
  fecho: CenaFecho,
};

export function BoasVindasSemana({ nome, resumo, onConcluir }: Props) {
  const semMovimento = useReducedMotion() ?? false;
  const esc = useEscala();
  // Quais cenas esta org TEM, e quando cada uma entra e sai. O resumo não muda durante a peça.
  const plano = useMemo(() => cronograma(planejarCenas(resumo)), [resumo]);
  const duracao = plano[plano.length - 1].fim;
  /** Quais cenas estão em cena agora. Cada uma tem a própria saída, que o AnimatePresence espera. */
  const [visiveis, setVisiveis] = useState<boolean[]>(() => plano.map((_, i) => i === 0));
  const [saindo, setSaindo] = useState(false);
  const concluiu = useRef(false);

  const concluir = useCallback(() => {
    if (concluiu.current) return;
    concluiu.current = true;
    onConcluir();
  }, [onConcluir]);

  const encerrar = useCallback(() => setSaindo(true), []);

  useEffect(() => {
    const timers: number[] = [];
    const marcar = (i: number, v: boolean) =>
      setVisiveis((atual) => atual.map((x, k) => (k === i ? v : semMovimento && v ? false : x)));
    plano.forEach((c, i) => {
      if (i > 0) timers.push(window.setTimeout(() => marcar(i, true), c.inicio));
      if (i < plano.length - 1) {
        // Sem movimento não há sobreposição: a cena anterior sai quando a próxima entra.
        timers.push(window.setTimeout(() => marcar(i, false), semMovimento ? plano[i + 1].inicio : c.fim));
      }
    });
    timers.push(window.setTimeout(() => setSaindo(true), duracao - FADE_SAIDA_MS));
    // Rede de segurança: se o motor de animação não assentar, a camada bloqueante sai mesmo assim.
    timers.push(window.setTimeout(concluir, duracao + 400));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [concluir, semMovimento, plano, duracao]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") encerrar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [encerrar]);

  const saudacao = saudacaoBrt();
  const primeiroNome = nome.trim().split(/\s+/)[0] ?? nome;
  const props: CenaProps = { esc, nome: primeiroNome, saudacao, resumo };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`${saudacao}, ${primeiroNome}. Resumo da semana passada.`}
      initial={{ opacity: 0 }}
      animate={{ opacity: saindo ? 0 : 1 }}
      transition={{ duration: saindo ? FADE_SAIDA_MS / 1000 : 0.4, ease: "easeInOut" }}
      onAnimationComplete={() => {
        if (saindo) concluir();
      }}
      className="fixed inset-0 z-[190] overflow-hidden bg-background text-left text-foreground"
    >
      {/* Leitores de tela recebem o resumo uma vez, em texto; a coreografia fica de fora. */}
      <p className="sr-only">
        Semana de {resumo.periodo}. {tilesDoResumo(resumo).map((t) => `${t.rotulo}: ${t.valor}.`).join(" ")}
      </p>

      <div aria-hidden className="absolute inset-0">
        {/* Horizonte: o clarão respira devagar por trás de tudo. */}
        {!semMovimento && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, scale: [1, 1.18, 1] }}
            transition={{ opacity: { duration: 2 }, scale: { duration: 9, repeat: Infinity, ease: SINE_INOUT } }}
            className="pointer-events-none absolute -bottom-[38%] -left-[10%] h-[80vmax] w-[80vmax] rounded-full bg-primary/[0.13] blur-[140px]"
          />
        )}

        {semMovimento ? (
          <AnimatePresence mode="wait">
            {plano.map((c, i) => (visiveis[i] ? <CenaSemMovimento key={c.id} id={c.id} {...props} /> : null))}
          </AnimatePresence>
        ) : (
          <AnimatePresence>
            {plano.map((c, i) => {
              const Cena = CENAS[c.id];
              return visiveis[i] ? <Cena key={c.id} {...props} /> : null;
            })}
          </AnimatePresence>
        )}
      </div>

      {/* Progresso: uma faixa por cena, que enche enquanto ela dura. */}
      <div aria-hidden className="absolute inset-x-6 top-5 z-[100] flex gap-1.5 sm:inset-x-12">
        {plano.map((c, i) => (
          <span key={c.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-foreground/15">
            <motion.span
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{
                // Cada faixa enche até a cena SEGUINTE entrar, não até a dela acabar: sem lacuna entre faixas.
                duration: ((i < plano.length - 1 ? plano[i + 1].inicio : duracao) - c.inicio) / 1000,
                delay: c.inicio / 1000,
                ease: SINE_INOUT,
              }}
              style={{ originX: 0 }}
              className="block h-full bg-primary"
            />
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={encerrar}
        className="absolute bottom-5 right-6 z-[100] rounded-md px-3 py-2 text-sm text-muted-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:right-12"
      >
        Pular
      </button>
    </motion.div>
  );
}
