import { useMemo, useState } from "react";
import {
  Bot,
  FileText,
  Handshake,
  ListFilter,
  MessageCircle,
  MessageSquare,
  Plus,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeadCardEvent, TipoDeEvento } from "./types";

/**
 * Histórico — a coisa mais densa que o sistema sabe sobre uma pessoa.
 *
 * Medido em prod: `lead_history` tem **321.721 linhas em 75,6% dos leads**,
 * mais 48.555 movimentações de negócio em 95%. Ganha a maior área do card.
 *
 * ⚠️ **73% dessas linhas são tráfego de WhatsApp** — `whatsapp_sent` e
 * `whatsapp_received` somam 235.484. Sem filtro, a história de qualquer lead
 * vira parede de mensagem e a pessoa desiste de ler. Os chips não são conforto,
 * são o que torna a seção utilizável.
 *
 * Movimentação de negócio aparece AQUI, e não é contradição com o corte
 * Lead↔Negócio: narrativa é da relação, controle é do negócio. Você lê "movido
 * para Proposta enviada" na história da pessoa; você move no card dele.
 */

const ICONE: Record<TipoDeEvento, typeof UserRound> = {
  lead: UserRound,
  negocio: Handshake,
  campo: FileText,
  mensagem: MessageCircle,
  comentario: MessageSquare,
  automacao: Bot,
};

/** Cor por tipo — semântica, não decorativa: dá para varrer sem ler. */
const COR: Record<TipoDeEvento, string> = {
  lead: "bg-sky-500/15 text-sky-400 ring-sky-500/25",
  negocio: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/25",
  campo: "bg-muted text-muted-foreground ring-border",
  mensagem: "bg-violet-500/15 text-violet-400 ring-violet-500/25",
  comentario: "bg-amber-500/15 text-amber-400 ring-amber-500/25",
  automacao: "bg-muted text-muted-foreground ring-border",
};

/** Cor do fio que liga um evento ao próximo — herda o tipo do de cima. */
const FIO: Record<TipoDeEvento, string> = {
  lead: "bg-sky-500/35",
  negocio: "bg-emerald-500/35",
  campo: "bg-border",
  mensagem: "bg-violet-500/35",
  comentario: "bg-amber-500/35",
  automacao: "bg-border",
};

const FILTROS: { chave: TipoDeEvento | "todos"; rotulo: string }[] = [
  { chave: "todos", rotulo: "Tudo" },
  { chave: "negocio", rotulo: "Negócios" },
  { chave: "campo", rotulo: "Campos" },
  { chave: "mensagem", rotulo: "Mensagens" },
  { chave: "comentario", rotulo: "Comentários" },
  { chave: "automacao", rotulo: "Automações" },
];

function quando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function iniciais(nome: string): string {
  return nome.trim().charAt(0).toUpperCase() || "?";
}

/**
 * Monta a frase com os realces em destaque. O evento traz `texto` com `{0}` e
 * a lista `realces` separada — o card nunca faz parsing de frase pronta, que é
 * como nasce bug de exibição com chave dentro.
 */
function Frase({ evento }: { evento: LeadCardEvent }) {
  const partes = useMemo(() => {
    const out: Array<{ t: string; realce: boolean }> = [];
    const regex = /\{(\d+)\}/g;
    let ultimo = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(evento.texto)) !== null) {
      if (m.index > ultimo) out.push({ t: evento.texto.slice(ultimo, m.index), realce: false });
      out.push({ t: evento.realces?.[Number(m[1])] ?? "", realce: true });
      ultimo = m.index + m[0].length;
    }
    if (ultimo < evento.texto.length) out.push({ t: evento.texto.slice(ultimo), realce: false });
    return out;
  }, [evento]);

  return (
    <span className="text-[13px] leading-snug">
      {partes.map((p, i) =>
        p.realce ? (
          <span key={i} className="font-semibold text-foreground">
            {p.t}
          </span>
        ) : (
          <span key={i} className="text-muted-foreground">
            {p.t}
          </span>
        ),
      )}
    </span>
  );
}

export function LeadCardHistory({
  eventos,
  onComment,
}: {
  eventos: LeadCardEvent[];
  onComment?: () => void;
}) {
  const [filtro, setFiltro] = useState<TipoDeEvento | "todos">("todos");
  const visiveis = filtro === "todos" ? eventos : eventos.filter((e) => e.tipo === filtro);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        {/* Sem título aqui: a aba acima já diz "Histórico", e repetir o mesmo
            rótulo a 40px de distância é ruído, não hierarquia. */}
        <p className="text-[11.5px] text-muted-foreground">
          Tudo que aconteceu com esta pessoa
        </p>
        <button
          type="button"
          onClick={onComment}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-primary",
            "transition-colors hover:bg-primary/10",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <Plus className="size-3.5" />
          Comentário
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <ListFilter className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
        {FILTROS.map((f) => {
          const ativo = filtro === f.chave;
          const quantos =
            f.chave === "todos" ? eventos.length : eventos.filter((e) => e.tipo === f.chave).length;
          if (quantos === 0 && f.chave !== "todos") return null;
          return (
            <button
              key={f.chave}
              type="button"
              onClick={() => setFiltro(f.chave)}
              className={cn(
                "rounded-full border px-2.5 py-[3px] text-[12px] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                ativo
                  ? "border-primary/45 bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:border-muted-foreground/35 hover:text-foreground",
              )}
            >
              {f.rotulo}
              <span className="ml-1.5 tabular-nums opacity-60">{quantos}</span>
            </button>
          );
        })}
      </div>

      <ol className="flex flex-col">
        {visiveis.map((e, i) => {
          const Icone = ICONE[e.tipo];
          const ultimo = i === visiveis.length - 1;
          return (
            <li key={e.id} className="relative flex gap-3 pb-3 last:pb-0">
              {/* O fio herda a cor do evento de cima — a coluna vira uma leitura
                  cromática do que andou nesta relação, sem ler uma palavra. */}
              {!ultimo && (
                <span
                  className={cn(
                    "absolute left-[15px] top-[34px] bottom-0 w-[2px] rounded-full",
                    FIO[e.tipo],
                  )}
                  aria-hidden="true"
                />
              )}
              <span
                className={cn(
                  "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-1",
                  COR[e.tipo],
                )}
                aria-hidden="true"
              >
                <Icone className="size-[15px]" />
              </span>

              <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
                <div className="px-3 py-2">
                  <Frase evento={e} />
                </div>
                <div className="flex items-center gap-2 border-t border-border/70 bg-muted/40 px-3 py-1.5">
                  {e.autor ? (
                    <>
                      <span
                        className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
                        aria-hidden="true"
                      >
                        {iniciais(e.autor)}
                      </span>
                      <span className="truncate text-[11.5px] text-muted-foreground">
                        {e.autor}
                      </span>
                    </>
                  ) : (
                    <span className="text-[11.5px] text-muted-foreground/70">Sistema</span>
                  )}
                  <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-muted-foreground/70">
                    {quando(e.quando)}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {visiveis.length === 0 && (
        <p className="rounded-lg border border-dashed border-border py-8 text-center text-[13px] text-muted-foreground">
          Nada deste tipo no histórico.
        </p>
      )}
    </div>
  );
}
