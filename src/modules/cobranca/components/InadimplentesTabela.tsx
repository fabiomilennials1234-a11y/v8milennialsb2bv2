import {
  AlertTriangle,
  BellOff,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Mail,
  MessageCircle,
  MoreHorizontal,
  PhoneOff,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { diaCurto, haQuantoTempo } from "../lib/atraso";
import { formatarDocumento, formatarTelefone } from "../lib/documento";
import { ROTULO_CANAL, ROTULO_DESFECHO, ROTULO_ORIGEM, reais } from "../lib/formato";
import { type IconeDaAcao, type TomDaAcao, proximaAcao } from "../lib/proxima-acao";
import type { InadimplenteResumo } from "../lib/tipos";
import { AtrasoSelo, EtapaPill, IniciaisAvatar } from "./atomos";

/**
 * A lista de inadimplentes — mesma gramática da lista de Leads (grade de uma
 * linha por item, 57 px, seleção com barra de ouro), colunas da cobrança.
 */
const GRADE =
  "grid items-center gap-x-3 grid-cols-[24px_minmax(190px,2fr)_60px_minmax(120px,1fr)_minmax(104px,0.8fr)_minmax(140px,1.05fr)_minmax(180px,1.45fr)_minmax(104px,0.85fr)_40px_32px]";

const ICONE: Record<IconeDaAcao, LucideIcon> = {
  compromisso: CalendarClock,
  atrasado: AlertTriangle,
  sem_dono: UserPlus,
  sem_contato: PhoneOff,
  nao_contatar: BellOff,
  contato: MessageCircle,
  encerrado: CheckCircle2,
};

const TOM: Record<TomDaAcao, string> = {
  ouro: "text-primary-soft-foreground dark:text-primary",
  alerta: "text-destructive",
  aviso: "text-warning-strong",
  neutro: "text-muted-foreground",
  bom: "text-success-strong",
};

export interface AcoesDaLinha {
  onAbrir: (r: InadimplenteResumo) => void;
  onContato?: (r: InadimplenteResumo) => void;
  onPagamento?: (r: InadimplenteResumo) => void;
}

function CabecalhoDaTabela({ selecionarTodos }: { selecionarTodos: ReactNode }) {
  return (
    <div
      className={cn(
        GRADE,
        "sticky top-0 z-10 h-11 border-b border-border bg-card/95 px-4 backdrop-blur",
        "text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground",
      )}
    >
      <span>{selecionarTodos}</span>
      <span>Inadimplente</span>
      <span>Contato</span>
      <span>Em aberto</span>
      <span>Atraso</span>
      <span>Etapa no fluxo</span>
      <span>Próxima ação</span>
      <span>Último contato</span>
      <span>Dono</span>
      <span aria-hidden />
    </div>
  );
}

function LinhaDaTabela({
  r,
  selecionado,
  onSelecionar,
  acoes,
  podeEditar,
}: {
  r: InadimplenteResumo;
  selecionado: boolean;
  onSelecionar: () => void;
  acoes: AcoesDaLinha;
  podeEditar: boolean;
}) {
  const acao = proximaAcao(r);
  const Icone = ICONE[acao.icone];
  const sub = [r.documento ? formatarDocumento(r.documento) : null, r.cidade].filter(Boolean).join(" · ");

  return (
    <div
      role="button"
      tabIndex={0}
      aria-selected={selecionado}
      onClick={() => acoes.onAbrir(r)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          acoes.onAbrir(r);
        }
      }}
      className={cn(
        GRADE,
        "group relative h-[57px] cursor-pointer border-b border-border/70 px-4 last:border-b-0",
        "transition-[background-color] duration-100 ease-standard hover:bg-muted/40",
        "focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        selecionado && "bg-primary-soft/60 hover:bg-primary-soft",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-0.5 bg-primary transition-opacity duration-100",
          selecionado ? "opacity-100" : "opacity-0",
        )}
      />
      <div onClick={(e) => e.stopPropagation()}>
        {podeEditar && r.casoId ? (
          <Checkbox checked={selecionado} onCheckedChange={onSelecionar} aria-label={`Selecionar ${r.nome}`} />
        ) : null}
      </div>

      <div className="flex min-w-0 items-center gap-2.5">
        <IniciaisAvatar nome={r.nome} />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-bold tracking-[-0.01em]">{r.nome}</p>
          <p className="truncate text-[11px] text-muted-foreground">{sub || r.contatoNome || "—"}</p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <span
          title={
            !r.telefone
              ? "Sem telefone"
              : r.naoContatar
                ? `${formatarTelefone(r.telefone)} · pediu para não receber mensagens`
                : `WhatsApp: ${formatarTelefone(r.telefone)}`
          }
          className={cn(
            "grid size-7 place-items-center rounded-lg border border-border bg-sunken",
            !r.telefone ? "text-muted-foreground/40" : r.naoContatar ? "text-warning-strong" : "text-success-strong",
          )}
        >
          {r.telefone && r.naoContatar ? (
            <BellOff className="size-3.5" aria-hidden />
          ) : (
            <MessageCircle className="size-3.5" aria-hidden />
          )}
        </span>
        <span
          title={r.email ? `E-mail: ${r.email}` : "Sem e-mail"}
          className={cn(
            "grid size-7 place-items-center rounded-lg border border-border bg-sunken",
            r.email ? "text-muted-foreground" : "text-muted-foreground/40",
          )}
        >
          <Mail className="size-3.5" aria-hidden />
        </span>
      </div>

      <div className="min-w-0 leading-tight">
        <p className="truncate text-[13.5px] font-extrabold tabular-nums tracking-[-0.01em]">
          {r.saldoAberto > 0 ? reais(r.saldoAberto) : "—"}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {r.titulosAbertos > 0 ? `${r.titulosAbertos} ${r.titulosAbertos === 1 ? "título" : "títulos"} · ` : ""}
          {ROTULO_ORIGEM[r.origem]}
        </p>
      </div>

      <div className="min-w-0 leading-tight">
        {r.vencimentoMaisAntigo ? (
          <>
            <AtrasoSelo vencimento={r.vencimentoMaisAntigo} />
            <p className="mt-0.5 text-[11px] text-muted-foreground">desde {diaCurto(r.vencimentoMaisAntigo)}</p>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>

      <div className="min-w-0">
        {r.etapaNome ? (
          <EtapaPill nome={r.etapaNome} cor={r.etapaCor} />
        ) : r.ultimoDesfecho ? (
          <span className="text-xs font-semibold text-muted-foreground">{ROTULO_DESFECHO[r.ultimoDesfecho]}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Sem caso</span>
        )}
      </div>

      <div className={cn("flex min-w-0 items-center gap-1.5 text-[12px] font-semibold", TOM[acao.tom])}>
        <Icone className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{acao.texto}</span>
      </div>

      <div className="min-w-0 truncate text-[12px] text-muted-foreground">
        {r.ultimoContatoEm
          ? `${haQuantoTempo(r.ultimoContatoEm)}${r.ultimoContatoCanal ? ` · ${ROTULO_CANAL[r.ultimoContatoCanal]}` : ""}`
          : "—"}
      </div>

      <div className="flex">
        {r.responsavelNome ? (
          <span title={r.responsavelNome}>
            <IniciaisAvatar nome={r.responsavelNome} tamanho="sm" />
          </span>
        ) : r.casoId ? (
          <span
            title="Sem responsável"
            className="grid size-[26px] place-items-center rounded-full border border-dashed border-border text-[11px] text-muted-foreground"
          >
            +
          </span>
        ) : null}
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              aria-label={`Ações de ${r.nome}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => acoes.onAbrir(r)}>Abrir ficha</DropdownMenuItem>
            {podeEditar && r.casoId && (
              <>
                <DropdownMenuSeparator />
                {acoes.onContato && <DropdownMenuItem onSelect={() => acoes.onContato?.(r)}>Registrar contato</DropdownMenuItem>}
                {acoes.onPagamento && <DropdownMenuItem onSelect={() => acoes.onPagamento?.(r)}>Registrar pagamento</DropdownMenuItem>}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function InadimplentesTabela({
  linhas,
  total,
  pagina,
  tamanhoDaPagina,
  onPagina,
  selecionados,
  onSelecionar,
  onSelecionarPagina,
  acoes,
  podeEditar,
  carregando,
  vazio,
}: {
  linhas: InadimplenteResumo[];
  total: number;
  pagina: number;
  tamanhoDaPagina: number;
  onPagina: (p: number) => void;
  selecionados: Set<string>;
  onSelecionar: (casoId: string) => void;
  onSelecionarPagina: (marcar: boolean) => void;
  acoes: AcoesDaLinha;
  podeEditar: boolean;
  carregando: boolean;
  vazio: ReactNode;
}) {
  const selecionaveis = linhas.filter((l) => l.casoId).map((l) => l.casoId as string);
  const todosMarcados = selecionaveis.length > 0 && selecionaveis.every((id) => selecionados.has(id));
  const algunsMarcados = selecionaveis.some((id) => selecionados.has(id));
  const paginas = Math.max(1, Math.ceil(total / tamanhoDaPagina));
  const de = total === 0 ? 0 : pagina * tamanhoDaPagina + 1;
  const ate = Math.min(total, (pagina + 1) * tamanhoDaPagina);

  return (
    <div className="overflow-hidden rounded-card border border-card-border bg-card shadow-relevo">
      <div className="overflow-x-auto">
        <div className="min-w-[1080px]">
          <CabecalhoDaTabela
            selecionarTodos={
              podeEditar && selecionaveis.length > 0 ? (
                <Checkbox
                  checked={todosMarcados ? true : algunsMarcados ? "indeterminate" : false}
                  onCheckedChange={(v) => onSelecionarPagina(v === true)}
                  aria-label="Selecionar todos desta página"
                />
              ) : null
            }
          />
          {carregando && linhas.length === 0 ? (
            <div className="space-y-px">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-[57px] animate-pulse border-b border-border/70 bg-muted/20" />
              ))}
            </div>
          ) : linhas.length === 0 ? (
            <div className="py-10">{vazio}</div>
          ) : (
            linhas.map((r) => (
              <LinhaDaTabela
                key={r.id}
                r={r}
                selecionado={!!r.casoId && selecionados.has(r.casoId)}
                onSelecionar={() => r.casoId && onSelecionar(r.casoId)}
                acoes={acoes}
                podeEditar={podeEditar}
              />
            ))
          )}
        </div>
      </div>
      {total > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-3 text-xs text-muted-foreground">
          <span className="tabular-nums">
            Mostrando {de}–{ate} de {total.toLocaleString("pt-BR")}
          </span>
          {paginas > 1 && (
            <div className="flex items-center gap-1 rounded-full bg-muted p-[3px]">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full"
                disabled={pagina === 0}
                onClick={() => onPagina(pagina - 1)}
                aria-label="Página anterior"
              >
                <ChevronLeft />
              </Button>
              <span className="px-2 font-bold tabular-nums text-foreground">
                {pagina + 1} / {paginas}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full"
                disabled={pagina + 1 >= paginas}
                onClick={() => onPagina(pagina + 1)}
                aria-label="Próxima página"
              >
                <ChevronRight />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
