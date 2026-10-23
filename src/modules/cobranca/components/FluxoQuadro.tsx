/**
 * O quadro do Fluxo de Cobrança — mesma gramática do kanban dos funis (raia
 * afundada, cartão branco, alvo do arrasto em ouro), com o que a cobrança pede:
 * a coluna diz QUANTO está parado nela, não só quantos casos.
 *
 * Colunas de desfecho (Recuperado, Perdido, Cancelado) mostram os últimos 30
 * dias e recebem o arrasto, mas o desfecho tem regra: Recuperado só com saldo
 * zero — soltar ali abre "Registrar pagamento".
 *
 * Coluna com automação (20271214000000) mostra no cabeçalho com quantos dias de
 * atraso o caso entra sozinho (D+N) e se manda mensagem ao entrar — soltar um
 * card nela pergunta antes, com a prévia ("Mover e enviar" / "Só mover").
 */
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { BellOff, CircleCheck, CircleX, Ban, MessageCircle, Pause, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { diaCurto, haQuantoTempo } from "../lib/atraso";
import { reais, reaisCompacto } from "../lib/formato";
import { proximaAcao } from "../lib/proxima-acao";
import { marcaDoPasso, rotuloDaEntrada } from "../lib/regua";
import type { Etapa, InadimplenteResumo, PapelDaEtapa } from "../lib/tipos";
import type { CasoEncerrado } from "../hooks/useCobrancaDados";
import { AtrasoSelo, IniciaisAvatar } from "./atomos";

const ICONE_DO_DESFECHO: Partial<Record<PapelDaEtapa, { icone: LucideIcon; cor: string }>> = {
  recuperado: { icone: CircleCheck, cor: "text-success-strong" },
  perdido: { icone: CircleX, cor: "text-destructive" },
  cancelado: { icone: Ban, cor: "text-muted-foreground" },
};

function CartaoDoCaso({ r, arrastando, onAbrir }: { r: InadimplenteResumo; arrastando?: boolean; onAbrir?: () => void }) {
  const acao = proximaAcao(r);
  const tomAcao = {
    ouro: "text-primary-soft-foreground dark:text-primary",
    alerta: "text-destructive",
    aviso: "text-warning-strong",
    neutro: "text-muted-foreground",
    bom: "text-success-strong",
  }[acao.tom];
  return (
    <div
      onClick={onAbrir}
      className={cn(
        "flex cursor-grab flex-col gap-2 rounded-2xl border border-card-border bg-card p-3 text-left shadow-relevo",
        "transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-relevo-alto",
        arrastando && "rotate-[1.5deg] cursor-grabbing shadow-relevo-alto ring-2 ring-primary/60",
      )}
    >
      <div className="flex items-center gap-2">
        <IniciaisAvatar nome={r.nome} tamanho="sm" />
        <p className="min-w-0 flex-1 truncate text-[13px] font-bold">{r.nome}</p>
        {r.naoContatar && (
          <span title="Pediu para não receber mensagens" className="text-warning-strong">
            <BellOff className="size-3.5" aria-label="Não contatar" />
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[15px] font-extrabold tabular-nums tracking-[-0.01em]">{reais(r.saldoAberto)}</span>
        <span className="text-[11px] text-muted-foreground">
          {r.titulosAbertos} {r.titulosAbertos === 1 ? "título" : "títulos"}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        <AtrasoSelo vencimento={r.vencimentoMaisAntigo} className="h-[20px] px-2 text-[10.5px]" />
        {r.compromissoTipo && (
          <span className="inline-flex h-[20px] items-center rounded-full bg-primary-soft px-2 text-[10.5px] font-bold text-primary-soft-foreground">
            {r.compromissoTipo === "promessa"
              ? `promessa ${diaCurto(r.compromissoProximaVencimento)}`
              : `acordo ${r.compromissoParcelas ?? ""}x`}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 border-t border-border/70 pt-2 text-[11.5px] font-semibold">
        <span className={cn("min-w-0 flex-1 truncate", tomAcao)}>{acao.texto}</span>
        {r.responsavelNome ? (
          <span title={r.responsavelNome}>
            <IniciaisAvatar nome={r.responsavelNome} tamanho="xs" />
          </span>
        ) : (
          <span title="Sem responsável" className="grid size-[22px] place-items-center rounded-full border border-dashed border-border text-[10px] text-muted-foreground">
            +
          </span>
        )}
      </div>
    </div>
  );
}

function CartaoArrastavel({ r, onAbrir, podeArrastar }: { r: InadimplenteResumo; onAbrir: () => void; podeArrastar: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: r.casoId as string, disabled: !podeArrastar });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      aria-label={`${r.nome}, ${reais(r.saldoAberto)}`}
      className={cn("outline-none focus-visible:rounded-2xl focus-visible:ring-2 focus-visible:ring-ring", isDragging && "opacity-30")}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === "Enter") onAbrir();
      }}
    >
      <CartaoDoCaso r={r} onAbrir={onAbrir} />
    </div>
  );
}

/** D+N, pausa e mensagem: o que a coluna faz sozinha, num relance. */
function AutomacaoDaColuna({ etapa }: { etapa: Etapa }) {
  if (etapa.papel !== "aberta") return null;
  const dias = etapa.entradaDias;
  const desligada = dias !== null && !etapa.automacaoAtiva;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {dias !== null && (
        <span
          title={desligada ? "Entrada automática desligada" : rotuloDaEntrada(dias)}
          className={cn(
            "inline-flex h-[18px] items-center rounded-full px-1.5 text-[10px] font-extrabold tabular-nums",
            desligada ? "border border-dashed border-border text-muted-foreground line-through" : "bg-tinta text-tinta-foreground",
          )}
        >
          {marcaDoPasso({ gatilho: "atraso", dias })}
        </span>
      )}
      {etapa.pausaRegua && (
        <span title="Pausa a régua: nada sai sozinho enquanto o caso está aqui" className="text-muted-foreground">
          <Pause className="size-3" aria-label="Pausa a régua" />
        </span>
      )}
      {etapa.mensagem && (
        <span
          title={dias !== null && !desligada ? "Manda mensagem quando o caso entra" : "Tem mensagem: sai quando alguém move o card para cá e escolhe enviar"}
          className="text-primary-soft-foreground dark:text-primary"
        >
          <MessageCircle className="size-3" aria-label="Manda mensagem ao entrar" />
        </span>
      )}
    </span>
  );
}

function Coluna({
  etapa,
  casos,
  encerrados,
  onAbrir,
  podeArrastar,
}: {
  etapa: Etapa;
  casos: InadimplenteResumo[];
  encerrados: CasoEncerrado[];
  onAbrir: (inadimplenteId: string) => void;
  podeArrastar: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa.id, disabled: !podeArrastar });
  const desfecho = etapa.papel !== "aberta" ? ICONE_DO_DESFECHO[etapa.papel] : undefined;
  const soma = desfecho ? encerrados.reduce((s, c) => s + c.valorPago, 0) : casos.reduce((s, c) => s + c.saldoAberto, 0);
  const quantos = desfecho ? encerrados.length : casos.length;

  return (
    <section
      ref={setNodeRef}
      aria-label={`Etapa ${etapa.nome}`}
      className={cn(
        "flex w-[276px] shrink-0 flex-col overflow-hidden rounded-card border border-border/60 transition-[background-color,box-shadow] duration-200",
        etapa.papel === "recuperado" ? "bg-success/[.07]" : etapa.papel === "perdido" ? "bg-destructive/[.06]" : "bg-sunken",
        isOver && "bg-primary-soft/50 ring-2 ring-primary/60",
      )}
    >
      <header className="shrink-0 px-3.5 pb-1 pt-3">
        <div className="flex items-center gap-2">
          {desfecho ? (
            <desfecho.icone className={cn("size-4 shrink-0", desfecho.cor)} aria-hidden />
          ) : (
            <span aria-hidden className="size-2 shrink-0 rounded-[3px]" style={{ background: etapa.cor }} />
          )}
          <h3 className="truncate text-xs font-extrabold tracking-[-0.01em]">{etapa.nome}</h3>
          <span className="inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-card px-1.5 text-[10.5px] font-extrabold tabular-nums shadow-relevo">
            {quantos}
          </span>
        </div>
        <p className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5">
            <AutomacaoDaColuna etapa={etapa} />
            <span className="truncate">{desfecho ? (etapa.papel === "recuperado" ? "recebido em 30 dias" : "últimos 30 dias") : "em aberto"}</span>
          </span>
          {(soma > 0 || !desfecho) && <span className="font-extrabold tabular-nums text-foreground">{reaisCompacto(soma)}</span>}
        </p>
      </header>
      <div className="flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto px-2.5 pb-3 pt-1.5">
        {desfecho
          ? encerrados.map((c) => (
              <button
                key={c.casoId}
                type="button"
                onClick={() => onAbrir(c.inadimplenteId)}
                className="flex items-center gap-2 rounded-xl border border-card-border bg-card/80 px-2.5 py-2 text-left shadow-relevo transition-colors hover:bg-card"
              >
                <IniciaisAvatar nome={c.nome} tamanho="xs" />
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{c.nome}</span>
                <span className="text-[10.5px] text-muted-foreground">{haQuantoTempo(c.encerradoEm)}</span>
              </button>
            ))
          : casos.map((r) => (
              <CartaoArrastavel key={r.casoId} r={r} onAbrir={() => onAbrir(r.id)} podeArrastar={podeArrastar} />
            ))}
        {quantos === 0 && (
          <p className="grid flex-1 place-items-center py-6 text-center text-[11.5px] text-muted-foreground/70">
            {podeArrastar ? "Solte um caso aqui" : "Nenhum caso"}
          </p>
        )}
      </div>
    </section>
  );
}

export function FluxoQuadro({
  etapas,
  casos,
  encerrados,
  onAbrir,
  onSoltar,
  podeArrastar,
}: {
  etapas: Etapa[];
  casos: InadimplenteResumo[];
  encerrados: CasoEncerrado[];
  onAbrir: (inadimplenteId: string) => void;
  onSoltar: (caso: InadimplenteResumo, destino: Etapa) => void;
  podeArrastar: boolean;
}) {
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor));
  const [ativo, setAtivo] = useState<InadimplenteResumo | null>(null);
  const porId = new Map(casos.map((c) => [c.casoId as string, c]));

  const inicio = (e: DragStartEvent) => setAtivo(porId.get(String(e.active.id)) ?? null);
  const fim = (e: DragEndEvent) => {
    setAtivo(null);
    const caso = porId.get(String(e.active.id));
    const destino = etapas.find((et) => et.id === e.over?.id);
    if (caso && destino && destino.id !== caso.etapaId) onSoltar(caso, destino);
  };

  return (
    <DndContext sensors={sensores} onDragStart={inicio} onDragEnd={fim} onDragCancel={() => setAtivo(null)}>
      <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0">
        <div className="flex min-h-[560px] gap-3">
          {etapas.map((etapa) => (
            <Coluna
              key={etapa.id}
              etapa={etapa}
              casos={casos.filter((c) => c.etapaId === etapa.id)}
              encerrados={encerrados.filter((c) => c.etapaId === etapa.id)}
              onAbrir={onAbrir}
              podeArrastar={podeArrastar}
            />
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>{ativo ? <CartaoDoCaso r={ativo} arrastando /> : null}</DragOverlay>
    </DndContext>
  );
}
