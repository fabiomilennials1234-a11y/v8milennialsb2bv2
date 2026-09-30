/**
 * Um negócio no painel do chat — só desenho, sem busca.
 *
 * Separado de `ContextPanelNegocios` para poder ser visto sem sessão nem banco
 * (a prévia de `src/preview` não pode importar o client do Supabase, e o
 * barrel de `leads` importa).
 */
import { Link } from "react-router-dom";
import { ArrowUpRight, CalendarDays, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL, formatDateSafe } from "@/lib/format";
import type { NegocioDoChat } from "@/modules/communication/lib/negocioNoChat";

const ESTADO: Record<NegocioDoChat["estado"], { rotulo: string; classe: string }> = {
  aberto: { rotulo: "Aberto", classe: "text-primary bg-primary/10 border-primary/25" },
  ganho: { rotulo: "Ganho", classe: "text-success bg-success/10 border-success/25" },
  perdido: { rotulo: "Perdido", classe: "text-destructive bg-destructive/10 border-destructive/25" },
};

export function CartaoDoNegocio({
  negocio: n,
  onAbrir,
}: {
  negocio: NegocioDoChat;
  onAbrir?: () => void;
}) {
  const estado = ESTADO[n.estado];

  const corpo = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-[12.5px] font-semibold text-foreground">{n.titulo}</span>
        <span
          className={cn(
            "shrink-0 rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide",
            estado.classe,
          )}
        >
          {estado.rotulo}
        </span>
      </div>

      {n.valor != null && (
        <div
          className={cn(
            "mt-1 text-[13px] font-semibold tabular-nums",
            n.estado === "ganho" ? "text-success" : "text-foreground",
          )}
        >
          {formatBRL(n.valor, 2)}
        </div>
      )}

      <dl className="mt-1.5 space-y-1 text-[11.5px]">
        <Linha icone={User} rotulo="Responsável">
          {n.dono ?? <span className="italic text-muted-foreground/60">Sem responsável</span>}
        </Linha>
        <Linha icone={CalendarDays} rotulo="Criado em">
          {formatDateSafe(n.criadoEm)}
        </Linha>
      </dl>

      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: n.funilCor }} />
        <span className="min-w-0 truncate">
          {n.funil} · <span className="text-foreground/80">{n.etapa}</span>
        </span>
        {n.diasNaEtapa != null && n.estado === "aberto" && (
          <span className="shrink-0 tabular-nums opacity-70" title={`Nesta etapa há ${n.diasNaEtapa} dias`}>
            · {n.diasNaEtapa}d
          </span>
        )}
      </div>
    </>
  );

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20">
      {onAbrir ? (
        <button
          type="button"
          onClick={onAbrir}
          className="block w-full rounded-lg p-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Abrir negócio ${n.titulo}`}
        >
          {corpo}
        </button>
      ) : (
        <div className="p-2.5">{corpo}</div>
      )}

      {n.caminho && (
        <div className="flex justify-end border-t border-border/40 px-2 py-1">
          <Link
            to={n.caminho}
            className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-medium text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground"
            aria-label={`Ver ${n.titulo} no funil`}
          >
            Ver no funil
            <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        </div>
      )}
    </div>
  );
}

function Linha({
  icone: Icone,
  rotulo,
  children,
}: {
  icone: typeof User;
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
        <Icone className="h-3 w-3 opacity-70" />
        {rotulo}
      </dt>
      <dd className="min-w-0 truncate text-right text-foreground">{children}</dd>
    </div>
  );
}
