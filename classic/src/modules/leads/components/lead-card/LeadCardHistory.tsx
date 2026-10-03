import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  FileText,
  Handshake,
  ListFilter,
  Loader2,
  MessageCircle,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Trash2,
  UserRound,
  X,
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
 *
 * ── COMENTÁRIO É EVENTO DE PRIMEIRA CLASSE ────────────────────────────────
 * O chip "Comentários" existe desde o primeiro dia desta ficha, mas as linhas
 * que ele filtrava vinham de `lead_history` e diziam só **"Comentário
 * adicionado"** — o texto que a equipe escreveu não estava em lugar nenhum da
 * tela. Quem trabalha pela aba de Leads perdeu o histórico inteiro no corte
 * Lead↔Negócio, porque o bloco de comentário passou a existir só dentro do
 * painel do Negócio.
 *
 * Agora o evento de comentário chega com o corpo INTEIRO (`evento.comentario`)
 * e é o único que ganha ação dentro do histórico: editar e apagar. É uma
 * exceção deliberada à regra "histórico é leitura" — o comentário é a única
 * linha daqui que uma pessoa escreveu à mão e portanto a única que ela pode ter
 * escrito errado.
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

const CAMPO = cn(
  "w-full resize-none rounded-lg border border-border bg-card px-3 py-2",
  "text-[13px] leading-relaxed placeholder:text-muted-foreground/70",
  "transition-colors hover:border-muted-foreground/30",
  "focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30",
);

/**
 * O corpo do comentário, e as duas ações que só ele tem.
 *
 * `whitespace-pre-wrap` não é detalhe: comentário de vendedor vem com quebra de
 * linha e lista, e 411 dos 2.909 de prod passam de 200 caracteres. Colapsar
 * quebra devolveria um parágrafo ilegível.
 */
function CorpoDoComentario({
  evento,
  onEditar,
  onApagar,
}: {
  evento: LeadCardEvent;
  onEditar?: (id: string, texto: string) => void | Promise<void>;
  onApagar?: (id: string) => void | Promise<void>;
}) {
  const c = evento.comentario!;
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(c.corpo);
  const [ocupado, setOcupado] = useState(false);

  // O corpo é estado local durante a edição; quando a query volta com o texto
  // novo (ou com outro lead), ele precisa acompanhar — senão a caixa reabre com
  // a versão velha.
  useEffect(() => {
    if (!editando) setRascunho(c.corpo);
  }, [c.corpo, editando]);

  const salvar = async () => {
    const limpo = rascunho.trim();
    if (!limpo || limpo === c.corpo) {
      setEditando(false);
      return;
    }
    setOcupado(true);
    try {
      await onEditar?.(c.id, limpo);
      setEditando(false);
    } catch {
      // O container já avisou. A caixa fica aberta com o texto — fechar aqui
      // apagaria a edição que a pessoa acabou de digitar.
    } finally {
      setOcupado(false);
    }
  };

  if (editando) {
    return (
      <div className="flex flex-col gap-2 px-3 py-2">
        <textarea
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          rows={3}
          aria-label="Editar comentário"
          className={CAMPO}
        />
        <div className="flex items-center justify-end gap-2 text-[12px]">
          <button
            type="button"
            onClick={() => {
              setRascunho(c.corpo);
              setEditando(false);
            }}
            className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={ocupado || !rascunho.trim()}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-medium",
              "transition-colors hover:border-primary/45 hover:text-primary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-45",
            )}
          >
            {ocupado && <Loader2 className="size-3 animate-spin" />}
            Salvar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 px-3 py-2">
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground">
        {c.corpo}
      </p>
      {(c.podeEditar || c.podeApagar) && (
        <div className="flex shrink-0 items-center gap-0.5">
          {c.podeEditar && onEditar && (
            <button
              type="button"
              onClick={() => setEditando(true)}
              aria-label="Editar comentário"
              className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
          {c.podeApagar && onApagar && (
            <button
              type="button"
              onClick={() => void onApagar(c.id)}
              aria-label="Apagar comentário"
              className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function LeadCardHistory({
  eventos,
  onComentar,
  onEditarComentario,
  onApagarComentario,
  comentando,
}: {
  eventos: LeadCardEvent[];
  /**
   * Ausente quando não há onde gravar — sem org conhecida o INSERT falharia na
   * policy. O histórico continua inteiro e legível; some só a caixa de
   * escrever, pela mesma regra do "+ Adicionar produto" no painel do Negócio.
   */
  onComentar?: (texto: string) => void | Promise<void>;
  onEditarComentario?: (id: string, texto: string) => void | Promise<void>;
  onApagarComentario?: (id: string) => void | Promise<void>;
  comentando?: boolean;
}) {
  const [filtro, setFiltro] = useState<TipoDeEvento | "todos">("todos");
  const [escrevendo, setEscrevendo] = useState(false);
  const [texto, setTexto] = useState("");
  const campo = useRef<HTMLTextAreaElement>(null);
  const visiveis = filtro === "todos" ? eventos : eventos.filter((e) => e.tipo === filtro);

  const publicar = async () => {
    const limpo = texto.trim();
    if (!limpo || comentando) return;
    // Só esvazia depois do sucesso: engolir o erro e limpar a caixa apagaria o
    // que a pessoa escreveu, que é o pior desfecho possível aqui.
    try {
      await onComentar?.(limpo);
    } catch {
      return;
    }
    setTexto("");
    setEscrevendo(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        {/* Sem título aqui: a aba acima já diz "Histórico", e repetir o mesmo
            rótulo a 40px de distância é ruído, não hierarquia. */}
        <p className="text-[11.5px] text-muted-foreground">
          Tudo que aconteceu com esta pessoa
        </p>
        {onComentar && !escrevendo && (
          <button
            type="button"
            onClick={() => {
              setEscrevendo(true);
              // O foco tem de esperar o campo existir.
              window.setTimeout(() => campo.current?.focus(), 0);
            }}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-primary",
              "transition-colors hover:bg-primary/10",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Plus className="size-3.5" />
            Comentário
          </button>
        )}
      </div>

      {onComentar && escrevendo && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
          <textarea
            ref={campo}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            aria-label="Escrever comentário"
            placeholder="Escreva um comentário para a equipe…"
            className={CAMPO}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void publicar();
              }
            }}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10.5px] text-muted-foreground/55">
              Ctrl + Enter para publicar
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setTexto("");
                  setEscrevendo(false);
                }}
                aria-label="Cancelar comentário"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void publicar()}
                disabled={!texto.trim() || !!comentando}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5",
                  "text-[12.5px] font-medium transition-colors",
                  "hover:border-primary/45 hover:text-primary",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:pointer-events-none disabled:opacity-45",
                )}
              >
                {comentando ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
                Comentar
              </button>
            </div>
          </div>
        </div>
      )}

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

              <div
                className={cn(
                  "min-w-0 flex-1 overflow-hidden rounded-lg border bg-card",
                  // O comentário ganha a borda âmbar do próprio tipo: numa
                  // parede de tráfego de WhatsApp, o que uma pessoa escreveu à
                  // mão precisa ser achável sem ler.
                  e.comentario ? "border-amber-500/35" : "border-border",
                )}
              >
                {e.comentario ? (
                  <CorpoDoComentario
                    evento={e}
                    onEditar={onEditarComentario}
                    onApagar={onApagarComentario}
                  />
                ) : (
                  <div className="px-3 py-2">
                    <Frase evento={e} />
                  </div>
                )}
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
                  {e.comentario?.editadoEm && (
                    <span className="shrink-0 text-[11px] text-muted-foreground/55">· editado</span>
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
