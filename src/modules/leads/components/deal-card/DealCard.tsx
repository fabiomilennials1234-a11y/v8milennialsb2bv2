import { useEffect, useState } from "react";
import { CalendarCheck, Check, Trophy, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { LeadCardDeals } from "../lead-card/LeadCardDeals";
import { DealCardActivities } from "./DealCardActivities";
import { DealCardStages } from "./DealCardStages";
import { DealCardTimeline } from "./DealCardTimeline";
import { DealCardMoney } from "./DealCardMoney";
import { contaDoNegocio } from "./conta-do-negocio";
import type { DealCardData } from "./types";

/**
 * O Card do Negócio — a coluna DIREITA do painel, no formato do print DataCrazy.
 *
 * ── O QUE MUDOU E POR QUÊ ─────────────────────────────────────────────────
 * A versão anterior era uma coluna só, empilhando sete seções (Lead, Tempo,
 * Negócio, Valor, Reunião, Movimentação, Anotação) numa rolagem longa. O print
 * do concorrente organiza o mesmo conteúdo em três camadas — três ladrilhos de
 * cabeçalho, um trilho de etapas com data, e um bloco de dinheiro — atrás de
 * abas. Duas consequências práticas, e é por elas que vale copiar:
 *
 *   1. **o que decide fica acima da dobra.** Tempo, valor e data de criação
 *      respondem "vale a pena mexer nisto agora" sem rolar;
 *   2. **o resto não some, muda de camada.** A movimentação vira aba irmã do
 *      trilho, em vez de sexto bloco de uma pilha que ninguém desce.
 *
 * ── O BLOCO DO LEAD SAIU DAQUI ────────────────────────────────────────────
 * Ele existia porque o painel era só o negócio, e abrir um negócio sem saber de
 * quem ele é não serve. Agora a pessoa ocupa a coluna da esquerda inteira, com
 * mais campo e mais métrica do que a grade de oito campos dava — repetir os
 * mesmos dados a 40cm de distância é onde as duas verdades começam.
 *
 * ── O PRIMEIRO LADRILHO NÃO É O "#75" DO PRINT ────────────────────────────
 * O DataCrazy abre com o número sequencial do negócio. O Torque **não tem esse
 * número** — não há coluna em `deals` nem sequence no Postgres — e a decisão do
 * dono do produto em 21/08 foi sair **sem migration**. No lugar dele entra o
 * dado que o próprio card já elegeu como manchete: **há quanto tempo isto está
 * aberto**. `value` existe em 1,1% dos negócios; tempo existe em 100%, e é o
 * único que aponta ação. O ladrilho acende em vermelho quando o negócio passa
 * do dobro da mediana da etapa na própria org.
 */

type Aba = "negocio" | "atividades" | "negocios";
type SubAba = "pipeline" | "jornada";
type AbaDinheiro = "produtos" | "anotacao";

function formatarData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const TOM = {
  azul: "border-sky-500/30 bg-sky-500/[0.07]",
  verde: "border-emerald-500/30 bg-emerald-500/[0.07]",
  roxo: "border-violet-500/30 bg-violet-500/[0.07]",
  alerta: "border-destructive/40 bg-destructive/[0.09]",
} as const;

const TINTA = {
  azul: "text-sky-400",
  verde: "text-emerald-400",
  roxo: "text-violet-400",
  alerta: "text-destructive",
} as const;

/** Os três cartões coloridos do topo do print. */
function Ladrilho({
  rotulo,
  valor,
  sufixo,
  tom,
  nota,
}: {
  rotulo: string;
  valor: string;
  sufixo?: string;
  tom: keyof typeof TOM;
  nota?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-1.5 rounded-xl border px-4 py-3", TOM[tom])}>
      <span className={cn("truncate text-[11.5px] font-medium tracking-[0.01em]", TINTA[tom])}>
        {rotulo}
      </span>
      <span className="truncate text-[21px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
        {valor}
        {sufixo && (
          <span className="ml-1 text-[13px] font-medium text-muted-foreground">{sufixo}</span>
        )}
      </span>
      {nota && <span className="truncate text-[11px] text-muted-foreground/75">{nota}</span>}
    </div>
  );
}

/** A barra de abas do print: sublinhado no ativo, sem moldura. */
function Abas<T extends string>({
  itens,
  ativa,
  onTrocar,
  compacta,
}: {
  itens: { chave: T; rotulo: string; contagem?: number }[];
  ativa: T;
  onTrocar: (chave: T) => void;
  compacta?: boolean;
}) {
  return (
    <nav className="flex items-center gap-1 border-b border-border">
      {itens.map((i) => {
        const acesa = i.chave === ativa;
        return (
          <button
            key={i.chave}
            type="button"
            onClick={() => onTrocar(i.chave)}
            className={cn(
              "relative px-3 transition-colors",
              compacta ? "py-2 text-[12.5px]" : "py-2.5 text-[13.5px]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              acesa ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {i.rotulo}
            {i.contagem !== undefined && (
              <span className="ml-1.5 text-[11px] tabular-nums text-muted-foreground/60">
                {i.contagem}
              </span>
            )}
            {acesa && (
              <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-primary" />
            )}
          </button>
        );
      })}
    </nav>
  );
}

function AcaoPrimaria({
  icone: Icone,
  rotulo,
  tom,
  onClick,
  desabilitado,
}: {
  icone: typeof Check;
  rotulo: string;
  tom: "ganho" | "perda";
  onClick?: () => void;
  desabilitado?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      className={cn(
        "disabled:pointer-events-none disabled:opacity-45",
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        tom === "ganho"
          ? "border-success/40 text-success hover:bg-success/10"
          : "border-border text-muted-foreground hover:border-destructive/40 hover:text-destructive",
      )}
    >
      <Icone className="size-3.5" />
      {rotulo}
    </button>
  );
}

export function DealCard({
  negocio,
  onSaveNote,
  onMoverEtapa,
  onOpenDeal,
  onNewDeal,
  onAdicionarProduto,
  movendo,
}: {
  negocio: DealCardData;
  onSaveNote?: (texto: string) => void;
  /** Move o negócio. Ganhar e perder são movimentos para etapa terminal. */
  onMoverEtapa?: (chave: string) => void;
  /** Abre OUTRO negócio do mesmo lead, na aba "Negócios". */
  onOpenDeal?: (entryId: string) => void;
  onNewDeal?: () => void;
  onAdicionarProduto?: () => void;
  movendo?: string | null;
}) {
  const [aba, setAba] = useState<Aba>("negocio");
  const [subAba, setSubAba] = useState<SubAba>("pipeline");
  const [abaDinheiro, setAbaDinheiro] = useState<AbaDinheiro>("produtos");
  const [nota, setNota] = useState(negocio.nota);

  // Repor o texto quando o que está salvo muda.
  useEffect(() => {
    setNota(negocio.nota);
  }, [negocio.nota]);

  /**
   * Voltar à primeira aba SÓ quando o negócio troca.
   *
   * Junto com o efeito de cima isto era um efeito só, com `negocio.nota` na
   * lista — e aí gravar a anotação resetava a navegação: o `onBlur` grava,
   * a query refaz, `negocio.nota` muda, e a textarea que a pessoa acabava de
   * usar sumia da tela. Acontecia em 100% das gravações.
   */
  useEffect(() => {
    setAba("negocio");
    setSubAba("pipeline");
    setAbaDinheiro("produtos");
  }, [negocio.id]);

  const aberto = negocio.estado === "aberto";
  const etapaGanha = negocio.etapas.find((e) => e.papel === "ganho");
  const etapaPerdida = negocio.etapas.find((e) => e.papel === "perdido");
  const estagnado =
    aberto &&
    negocio.diasNaEtapa !== null &&
    negocio.medianaDaEtapa !== null &&
    negocio.diasNaEtapa > negocio.medianaDaEtapa * 2;

  const { total } = contaDoNegocio(negocio.itens, negocio.valorDoNegocio, negocio.valor);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {/* ── Cabeçalho ─────────────────────────────────────────────────────
          Não está no print — o negócio do DataCrazy não tem título nem funil
          visível ali. Aqui tem, e some daqui seria perder o que identifica o
          negócio e os dois únicos botões que o encerram. Fica em uma linha. */}
      <header className="flex shrink-0 items-start gap-3 px-6 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="truncate text-[18px] font-semibold tracking-[-0.02em]">
              {negocio.titulo}
            </h1>
            {negocio.estado === "ganho" && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-2 py-0.5 text-[12px] font-semibold text-success">
                <Trophy className="size-3" />
                Ganho
              </span>
            )}
            {negocio.estado === "perdido" && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-destructive/35 bg-destructive/[0.08] px-2 py-0.5 text-[12px] font-semibold text-destructive">
                <X className="size-3" />
                Perdido
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="size-1.5 rounded-full"
                style={{ background: negocio.funilCor }}
                aria-hidden="true"
              />
              {negocio.funil}
            </span>
            {negocio.dono ? <span>{negocio.dono}</span> : <span className="opacity-70">sem dono</span>}
          </div>
        </div>

        {/* Ganhar e perder são MOVIMENTOS para a etapa terminal do funil (ADR-0023
            §5). Somem quando o funil não tem etapa terminal: 83 funis custom em
            prod estão nesse caso, e botão que não tem para onde ir mente. */}
        {aberto && (etapaGanha || etapaPerdida) && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 pr-8">
            {etapaGanha && (
              <AcaoPrimaria
                icone={Check}
                rotulo="Ganhou"
                tom="ganho"
                desabilitado={!!movendo}
                onClick={() => onMoverEtapa?.(etapaGanha.chave)}
              />
            )}
            {etapaPerdida && (
              <AcaoPrimaria
                icone={X}
                rotulo="Perdeu"
                tom="perda"
                desabilitado={!!movendo}
                onClick={() => onMoverEtapa?.(etapaPerdida.chave)}
              />
            )}
          </div>
        )}
      </header>

      {/* ── Barra de abas do print ────────────────────────────────────────
          O print tem seis: Histórico · Atividades · Negócios · Arquivos ·
          Atendimentos · Informações do Negócio. Entram as TRÊS que têm fonte de
          dado ligada. As outras três ficam de fora em vez de entrar vazias —
          aba que abre num "nada aqui" ensina a não clicar em nenhuma:
            · Arquivos    — não existe anexo de negócio no schema. As três
                            tabelas de arquivo do produto prendem em ticket,
                            produto e agente; nenhuma tem `deal_id`.
            · Atendimentos— é o chat, e ele tem tela própria com muito mais
                            (busca, envio, mídia). Espelhar um pedaço aqui cria
                            um segundo lugar de ler conversa.
            · Histórico   — já está como "Jornada do Negócio", sub-aba do
                            trilho, que é onde ele responde a pergunta certa. */}
      <div className="shrink-0 px-6">
        <Abas
          ativa={aba}
          onTrocar={setAba}
          itens={[
            { chave: "negocio" as const, rotulo: "Informações do Negócio" },
            {
              chave: "atividades" as const,
              rotulo: "Atividades",
              contagem: negocio.atividades.length,
            },
            { chave: "negocios" as const, rotulo: "Negócios", contagem: negocio.outrosNegocios.length },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {aba === "atividades" ? (
          <DealCardActivities atividades={negocio.atividades} />
        ) : aba === "negocios" ? (
          <LeadCardDeals
            negocios={negocio.outrosNegocios}
            atual={negocio.id}
            onOpenDeal={(id) => onOpenDeal?.(id)}
            onNewDeal={() => onNewDeal?.()}
          />
        ) : (
          <div className="flex flex-col gap-5">
            {/* Os três cartões do print. */}
            <div className="flex flex-wrap items-stretch gap-3">
              <Ladrilho
                tom={estagnado ? "alerta" : "azul"}
                rotulo={estagnado ? "Parado na etapa" : "Em aberto"}
                valor={
                  estagnado
                    ? String(negocio.diasNaEtapa)
                    : negocio.diasEmAberto === null
                      ? "—"
                      : String(negocio.diasEmAberto)
                }
                sufixo={
                  estagnado || negocio.diasEmAberto !== null ? "dias" : undefined
                }
                nota={
                  estagnado
                    ? `normal aqui: ${negocio.medianaDaEtapa} dias`
                    : negocio.diasNaEtapa !== null
                      ? `${negocio.diasNaEtapa} nesta etapa`
                      : undefined
                }
              />
              {/* O ladrilho FICA sempre, como no print — mas sem valor ele
                  mostra "—", não "R$ 0,00". `sale_value` existe em 1,1% dos
                  38.739 negócios: carimbar zero em 98,9% das aberturas é
                  afirmar que o negócio não vale nada, e não saber quanto vale
                  é outra coisa. Decisão do dono do produto em 22/08. */}
              <Ladrilho
                tom="verde"
                rotulo="Valor Total"
                valor={total > 0 ? formatBRL(total, 2) : "—"}
                nota={negocio.itens.length > 0 ? `${negocio.itens.length} produto(s)` : undefined}
              />
              <Ladrilho
                tom="roxo"
                rotulo="Data de Criação"
                valor={negocio.criadoEm ? formatarData(negocio.criadoEm) : "—"}
                nota={
                  negocio.previsaoFechamento
                    ? `previsão ${formatarData(negocio.previsaoFechamento)}`
                    : undefined
                }
              />
            </div>

            {/* Sub-abas do print: a régua e a jornada são a MESMA pergunta
                ("por onde ele andou") em duas formas — a régua responde onde
                está, a jornada responde quem o levou lá. */}
            <div className="flex flex-col gap-4">
              <Abas
                compacta
                ativa={subAba}
                onTrocar={setSubAba}
                itens={[
                  { chave: "pipeline" as const, rotulo: "Pipeline Completa" },
                  {
                    chave: "jornada" as const,
                    rotulo: "Jornada do Negócio",
                    contagem: negocio.movimentacoes.length,
                  },
                ]}
              />
              {subAba === "pipeline" ? (
                <DealCardStages
                  etapas={negocio.etapas}
                  atual={negocio.etapaAtual}
                  cor={negocio.funilCor}
                  movimentacoes={negocio.movimentacoes}
                  onMover={onMoverEtapa}
                  movendo={movendo}
                />
              ) : (
                <DealCardTimeline movimentacoes={negocio.movimentacoes} />
              )}
            </div>

            {/* Reunião — fora das abas porque é a única coisa aqui com HORA
                marcada; enterrar num painel é como se perde reunião. */}
            {negocio.reuniao && (
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5">
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-md border",
                    negocio.reuniao.confirmada
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-border bg-muted text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  <CalendarCheck className="size-3.5" />
                </span>
                <span className="text-[13px] font-medium tabular-nums">
                  {new Date(negocio.reuniao.data).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {negocio.reuniao.confirmada ? "confirmada" : "sem confirmação"}
                </span>
              </div>
            )}

            {/* Desfecho — só quando o negócio já morreu. */}
            {!aberto && negocio.desfecho && (
              <div
                className={cn(
                  "flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-4 py-3",
                  negocio.estado === "ganho"
                    ? "border-success/35 bg-success/[0.07]"
                    : "border-border bg-card",
                )}
              >
                <div className="flex flex-col">
                  <span className="text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
                    {negocio.estado === "ganho" ? "Vendido em" : "Perdido em"}
                  </span>
                  <span className="text-[14px] font-semibold tabular-nums">
                    {formatarData(negocio.desfecho.quando)}
                  </span>
                </div>
                {negocio.desfecho.valorVenda ? (
                  <div className="flex flex-col">
                    <span className="text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
                      Valor da venda
                    </span>
                    <span className="text-[14px] font-semibold tabular-nums text-success">
                      {formatBRL(negocio.desfecho.valorVenda)}
                    </span>
                  </div>
                ) : null}
                {negocio.desfecho.motivo && (
                  <div className="flex flex-col">
                    <span className="text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
                      Motivo
                    </span>
                    <span className="text-[14px] font-medium">{negocio.desfecho.motivo}</span>
                  </div>
                )}
              </div>
            )}

            {/* Segunda barra do print. Das cinco abas dele (Produtos e Valores ·
                Campos adicionais · Anexos · Histórico · Atividades), Campos
                adicionais e Anexos não existem para negócio em tabela nenhuma,
                e Histórico/Atividades já são a Jornada logo acima. Sobra a de
                dinheiro — e a Anotação, que precisava de casa. */}
            <div className="flex flex-col gap-4">
              <Abas
                compacta
                ativa={abaDinheiro}
                onTrocar={setAbaDinheiro}
                itens={[
                  { chave: "produtos" as const, rotulo: "Produtos e Valores" },
                  { chave: "anotacao" as const, rotulo: "Anotação" },
                ]}
              />
              {abaDinheiro === "produtos" ? (
                <DealCardMoney
                  itens={negocio.itens}
                  valorDoNegocio={negocio.valorDoNegocio}
                  valorDoFunil={negocio.valor}
                  onAdicionarProduto={onAdicionarProduto}
                />
              ) : (
                <textarea
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  onBlur={() => nota !== negocio.nota && onSaveNote?.(nota)}
                  placeholder="O que precisa ser lembrado sobre este negócio…"
                  rows={4}
                  className={cn(
                    "w-full resize-none rounded-lg border border-border bg-card px-3.5 py-2.5",
                    "text-[13px] leading-relaxed placeholder:text-muted-foreground/70",
                    "transition-colors hover:border-muted-foreground/30",
                    "focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30",
                  )}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
