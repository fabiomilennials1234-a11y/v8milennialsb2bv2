import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Bot, MessageSquareDot, Smartphone } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FocusCard, FocusTile, InkPanel } from "@/components/ui/bento";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
import { formatContactTime } from "@/modules/communication/components/chat/list/ConversationListItem";
import {
  useConversasAguardando,
  type ConversaAguardando,
} from "@/modules/analytics/hooks/useConversasAguardando";
import { DonoDaLinha } from "./DonoDaLinha";

const MOSTRAR = 10;

/** Linha inteira é o alvo do clique: a lista é a ação, não a decoração. */
const LINHA_CLASSES =
  "flex h-auto w-full items-center justify-start gap-3 whitespace-normal rounded-2xl px-3 py-2.5 text-left font-normal text-tinta-foreground transition-colors hover:bg-white/[.06] hover:text-tinta-foreground active:scale-100";

/**
 * Bloco 1 — o mais importante da tela, e o único que representa dinheiro
 * escapando: cliente que falou e não foi respondido.
 *
 * V5 (2026-10): vira o painel-herói em tinta. A lista continua sendo a ação —
 * cada linha abre a conversa direto, como antes. O cartão de ouro não é uma
 * seleção: é o PRIMEIRO da fila ("próximo a responder"), com a mensagem
 * inteira, para o olho começar por ele. Nenhum dado novo; só hierarquia.
 *
 * ⚠️ ABRIR CONVERSA TEM UM CAMINHO SÓ. É `AbrirConversaButton`, e um
 * `no-restricted-imports` em `eslint.config.js` reprova quem chamar
 * `useOpenWhatsAppChat` direto — a regra existe porque esse hook já foi chamado
 * em 9 lugares com 9 regras diferentes, e um dos botões passou meses lançando
 * `ReferenceError`. O componente decide sozinho: uma caixa abre direto, mais de
 * uma pergunta por qual falar.
 */
export function CardConversasAguardando() {
  const {
    items,
    total,
    isLoading,
    isError,
    isDegraded,
    isAdmin,
    semChips,
    chipsComErro,
    refetch,
  } = useConversasAguardando(MOSTRAR);

  const restantes = Math.max(0, total - items.length);
  const comLead = items.filter((c): c is ConversaAguardando & { leadId: string } => !!c.leadId);
  const proxima = comLead[0];

  return (
    <InkPanel
      title="Aguardando resposta"
      count={!isLoading && !isError ? total : undefined}
      actions={
        <>
          {isAdmin && (
            <span className="rounded-full border border-white/15 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.06em] text-tinta-muted">
              Equipe
            </span>
          )}
          <Link
            to="/chat-whatsapp"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[.06] px-3 text-[12px] font-semibold text-tinta-foreground transition-colors hover:bg-white/10"
          >
            Abrir chat
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </>
      }
    >
      {isDegraded ? (
        <p className="mx-1.5 mb-2 rounded-xl bg-white/[.05] px-3 py-2 text-[11px] leading-relaxed text-tinta-muted">
          Lista parcial: mostrando só as conversas sem nenhuma resposta. As
          que a IA respondeu entram depois que a migration
          <span className="cmd-mono"> 20270821250000 </span>
          for aplicada neste banco.
        </p>
      ) : null}
      {/* Falha parcial de chip encurta a lista. Sem esta linha ela encurta
          calada, e a tela vira "está tudo respondido". */}
      {chipsComErro > 0 && !isError ? (
        <p className="mx-1.5 mb-2 rounded-xl bg-white/[.05] px-3 py-2 text-[11px] leading-relaxed text-tinta-muted">
          {chipsComErro === 1
            ? "Um número não respondeu agora — a fila dele está fora desta lista."
            : `${chipsComErro} números não responderam agora — as filas deles estão fora desta lista.`}
        </p>
      ) : null}

      {isLoading ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
          <div className="space-y-2 p-1.5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 rounded-2xl bg-white/[.07]" />
            ))}
          </div>
          <Skeleton className="hidden min-h-[260px] rounded-card bg-white/[.07] lg:block" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <p className="text-[13px] font-semibold">Não deu para carregar</p>
          <p className="max-w-[260px] text-[12px] text-tinta-muted">
            O dado não veio. Isso não apaga nada — é só a leitura que falhou.
          </p>
          <button
            type="button"
            onClick={refetch}
            className="mt-1 rounded-full border border-white/15 px-3 py-1.5 text-[12px] font-semibold text-tinta-foreground transition-colors hover:bg-white/10"
          >
            Tentar de novo
          </button>
        </div>
      ) : comLead.length === 0 ? (
        /* Sem número conectado a fila não está limpa — ela nunca foi perguntada.
           Dizer "ninguém esperando" aqui seria afirmar o que não se mediu. */
        <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
          <MessageSquareDot className="h-6 w-6 text-primary" />
          <p className="text-[14px] font-bold">{semChips ? "Nenhum WhatsApp conectado" : "Ninguém esperando"}</p>
          <p className="max-w-[340px] text-[12px] text-tinta-muted">
            {semChips
              ? "Este bloco lê as conversas do WhatsApp. Conecte um número em Configurações › WhatsApp para a fila aparecer aqui."
              : isAdmin
                ? "Todo cliente com lead cadastrado que falou já teve resposta de alguém do time. É o estado que você quer ver aqui."
                : "Todo cliente com lead cadastrado que falou com você já teve resposta. É o estado que você quer ver aqui."}
          </p>
        </div>
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
          <ul className="order-2 flex min-w-0 flex-col gap-0.5 lg:order-1">
            {comLead.map((c, i) => (
              <li key={c.key}>
                <AbrirConversaButton
                  leadId={c.leadId}
                  phone={c.phoneNumber}
                  variant="ghost"
                  className={cn(LINHA_CLASSES, i === 0 && "bg-white/[.06]")}
                  aria-label={`Abrir conversa com ${c.displayName}`}
                >
                  <LinhaConversa conversa={c} mostrarDono={isAdmin} />
                </AbrirConversaButton>
              </li>
            ))}
            {restantes > 0 && (
              <li className="px-3 pt-2 text-[11px] text-tinta-muted">
                e mais <span className="font-bold tabular-nums text-tinta-foreground">{restantes}</span>{" "}
                {restantes === 1 ? "conversa esperando" : "conversas esperando"}
              </li>
            )}
          </ul>

          {proxima && <ProximaAResponder conversa={proxima} mostrarDono={isAdmin} />}
        </div>
      )}
    </InkPanel>
  );
}

function iniciais(nome: string) {
  return nome
    .replace(/[^\p{L}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?";
}

function esperandoHa(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return formatDistanceToNowStrict(d, { locale: ptBR });
}

/** O primeiro da fila, em destaque — mesma ação da linha, mais contexto. */
function ProximaAResponder({
  conversa,
  mostrarDono,
}: {
  conversa: ConversaAguardando & { leadId: string };
  mostrarDono: boolean;
}) {
  const ha = esperandoHa(conversa.lastClientMessageAt);
  return (
    <FocusCard className="order-1 lg:order-2">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-primary-foreground/70">Próximo a responder</p>
          <p className="mt-0.5 truncate text-[1.35rem] font-extrabold leading-tight tracking-[-0.03em]">
            {conversa.displayName}
          </p>
        </div>
        {ha && (
          <div className="shrink-0 text-right">
            <p className="text-[11px] font-bold text-primary-foreground/70">Esperando há</p>
            <p className="text-[1.35rem] font-extrabold leading-tight tracking-[-0.03em] tabular-nums">{ha}</p>
          </div>
        )}
      </div>

      <FocusTile className="text-[14px] font-semibold leading-relaxed">
        “{conversa.lastClientMessage?.trim() || "Mensagem sem texto"}”
      </FocusTile>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] font-semibold">
        <span className="inline-flex items-center gap-1.5">
          <Smartphone className="h-3.5 w-3.5" />
          {conversa.instanceName}
        </span>
        {conversa.aiReplied && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-primary-foreground px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-primary"
            title="A IA já respondeu; nenhum humano respondeu depois"
          >
            <Bot className="h-3 w-3" />
            IA respondeu
          </span>
        )}
        {mostrarDono && <DonoDaLinha nome={conversa.ownerName} className="text-[12px] text-primary-foreground/75" />}
      </div>

      <AbrirConversaButton
        leadId={conversa.leadId}
        phone={conversa.phoneNumber}
        variant="outline"
        className="h-11 w-full justify-center rounded-full border-transparent bg-white text-[13px] font-bold text-neutral-900 shadow-none hover:bg-white/90"
        aria-label={`Abrir conversa com ${conversa.displayName}`}
      >
        Abrir conversa
        <ArrowRight className="h-4 w-4" />
      </AbrirConversaButton>
    </FocusCard>
  );
}

function LinhaConversa({
  conversa,
  mostrarDono,
}: {
  conversa: ConversaAguardando;
  /** Só o admin: para o vendedor a fila inteira já é dele. */
  mostrarDono: boolean;
}) {
  return (
    <>
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-bold text-tinta-foreground"
        aria-hidden
      >
        {iniciais(conversa.displayName)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold">
            {conversa.displayName}
          </span>
          {conversa.aiReplied && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-white/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.06em] text-tinta-muted"
              title="A IA já respondeu; nenhum humano respondeu depois"
            >
              <Bot className="h-2.5 w-2.5" />
              IA
            </span>
          )}
        </span>
        <span className="block truncate text-[11.5px] text-tinta-muted">
          {conversa.lastClientMessage?.trim() || "Mensagem sem texto"}
        </span>
        {/* Terceira linha só para admin: de quem é a conversa. */}
        {mostrarDono && (
          <DonoDaLinha nome={conversa.ownerName} className="mt-0.5 text-tinta-muted" />
        )}
      </span>

      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-[11.5px] font-bold tabular-nums text-tinta-foreground">
          {formatContactTime(conversa.lastClientMessageAt)}
        </span>
        {/* A instância é requisito explícito do admin; para o vendedor só a
            partir de `sm`, porque ele costuma ter uma caixa só. */}
        <span
          className={cn(
            "items-center gap-1 text-[10px] text-tinta-muted",
            mostrarDono ? "flex" : "hidden sm:flex",
          )}
        >
          <Smartphone className="h-2.5 w-2.5" />
          <span className="max-w-[110px] truncate">{conversa.instanceName}</span>
        </span>
      </span>
    </>
  );
}
