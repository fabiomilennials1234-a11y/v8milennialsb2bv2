import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, MessageCircle, MessageSquareDot } from "lucide-react";
import { FocusCard, FocusTile, InkPanel, InkRow } from "@/components/ui/bento";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useViewport } from "@/shared/hooks/use-viewport";
import { useCopilotToggleStatus } from "@/modules/copilot";
import { QUALIFICATION_TIER_CONFIG } from "@/modules/leads";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
import {
  useConversasAguardando,
  type ConversaAguardando,
} from "@/modules/analytics/hooks/useConversasAguardando";
import { useFocoDoLead } from "@/modules/analytics/hooks/useFocoDoLead";

const MOSTRAR = 10;

/** No celular a linha inteira abre a conversa (a lista é a ação). */
const LINHA_CLASSES =
  "group flex h-auto w-full items-center justify-start gap-3 whitespace-normal rounded-2xl px-3 py-2.5 text-left font-normal text-tinta-foreground transition-colors hover:bg-white/[.06] hover:text-tinta-foreground active:scale-100";

/**
 * Bloco 1 — o mais importante da tela, e o único que representa dinheiro
 * escapando: cliente que falou e não foi respondido.
 *
 * V5 (mockup, decisão do CTO 02/10): lista de 340 px em tinta à esquerda e o
 * cartão de ouro do cliente SELECIONADO à direita. No computador a linha
 * seleciona e o cartão abre a conversa; no celular a linha abre direto (lá o
 * cartão fica em cima e escolher antes de agir é um passo a mais).
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

  const { isMobile } = useViewport();
  const [selecionadaKey, setSelecionadaKey] = useState<string | null>(null);

  const restantes = Math.max(0, total - items.length);
  const comLead = items.filter((c): c is ConversaAguardando & { leadId: string } => !!c.leadId);
  // Sem escolha (ou a escolhida saiu da fila), o foco é o primeiro.
  const emFoco = comLead.find((c) => c.key === selecionadaKey) ?? comLead[0];

  return (
    <InkPanel
      title="Conversas aguardando"
      count={!isLoading && !isError ? `${total} ${total === 1 ? "cliente" : "clientes"}` : undefined}
      actions={
        <>
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
        <div className="grid gap-3 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <div className="space-y-2 p-1.5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 rounded-2xl bg-white/[.07]" />
            ))}
          </div>
          <Skeleton className="hidden min-h-[340px] rounded-card bg-white/[.07] lg:block" />
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
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <ul className="order-2 flex min-w-0 flex-col gap-1 lg:order-1">
            {comLead.map((c) => (
              <li key={c.key}>
                {isMobile ? (
                  <AbrirConversaButton
                    leadId={c.leadId}
                    phone={c.phoneNumber}
                    variant="ghost"
                    className={LINHA_CLASSES}
                    aria-label={`Abrir conversa com ${c.displayName}`}
                  >
                    <LinhaConversa conversa={c} />
                  </AbrirConversaButton>
                ) : (
                  <InkRow
                    selected={c.key === emFoco?.key}
                    onClick={() => setSelecionadaKey(c.key)}
                    aria-label={`Ver ${c.displayName}`}
                  >
                    <LinhaConversa conversa={c} />
                  </InkRow>
                )}
              </li>
            ))}
            {restantes > 0 && (
              <li className="px-3 pt-2 text-[11px] text-tinta-muted">
                e mais <span className="font-bold tabular-nums text-tinta-foreground">{restantes}</span>{" "}
                {restantes === 1 ? "conversa esperando" : "conversas esperando"}
              </li>
            )}
          </ul>

          {emFoco && <CartaoDoFoco conversa={emFoco} mostrarDono={isAdmin} />}
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

/** Espera curta e exata — "6 min", "1 h 35 min", "3 d". */
export function esperaCurta(iso: string | null | undefined, agora = Date.now()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const min = Math.max(0, Math.round((agora - t) / 60_000));
  if (min < 60) return { valor: String(min), unidade: "min", texto: `${min} min`, longa: false };
  const h = Math.floor(min / 60);
  if (h < 24) {
    const resto = min % 60;
    return { valor: String(h), unidade: resto ? `h ${resto} min` : "h", texto: resto ? `${h} h ${resto} min` : `${h} h`, longa: true };
  }
  const d = Math.floor(h / 24);
  return { valor: String(d), unidade: d === 1 ? "dia" : "dias", texto: `${d} ${d === 1 ? "dia" : "dias"}`, longa: true };
}

function LinhaConversa({ conversa }: { conversa: ConversaAguardando }) {
  const espera = esperaCurta(conversa.lastClientMessageAt);
  return (
    <>
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-bold text-tinta-foreground group-data-[selected=true]:bg-primary-foreground/15 group-data-[selected=true]:text-primary-foreground"
        aria-hidden
      >
        {iniciais(conversa.displayName)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold">{conversa.displayName}</span>
        <span className="block truncate text-[11.5px] text-tinta-muted group-data-[selected=true]:text-primary-foreground/70">
          {conversa.lastClientMessage?.trim() || "Mensagem sem texto"}
        </span>
      </span>
      {espera && (
        <span
          className={cn(
            "shrink-0 text-[12px] font-bold tabular-nums",
            espera.longa ? "text-destructive" : "text-tinta-foreground",
            "group-data-[selected=true]:text-primary-foreground",
          )}
        >
          {espera.texto}
        </span>
      )}
    </>
  );
}

/** O cartão de ouro: quem, há quanto tempo, o que disse, onde está — e agir. */
function CartaoDoFoco({
  conversa,
  mostrarDono,
}: {
  conversa: ConversaAguardando & { leadId: string };
  /** Só a visão da equipe mostra o dono: para o vendedor a fila já é dele. */
  mostrarDono: boolean;
}) {
  const espera = esperaCurta(conversa.lastClientMessageAt);
  const foco = useFocoDoLead(conversa.leadId);
  const copilot = useCopilotToggleStatus({ phone: conversa.phoneNumber, leadId: conversa.leadId });
  const tier = foco.data?.qualificacao
    ? QUALIFICATION_TIER_CONFIG[foco.data.qualificacao as keyof typeof QUALIFICATION_TIER_CONFIG]
    : undefined;
  const carregando = foco.isLoading;

  return (
    <FocusCard className="order-1 min-h-[340px] gap-4 p-[18px] lg:order-2">
      {/* (a) espera · cliente · dono */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        {espera && (
          <div className="shrink-0">
            <p className="text-[11px] font-bold text-primary-foreground/70">Esperando há</p>
            <p className="text-[2.6rem] font-extrabold leading-none tracking-[-0.045em] tabular-nums">
              {espera.valor}
              <span className="ml-1 text-[0.45em] font-bold tracking-normal">{espera.unidade}</span>
            </p>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-primary-foreground/70">Cliente</p>
          <p className="truncate text-[17px] font-extrabold tracking-[-0.02em]">{conversa.displayName}</p>
          <p className="truncate text-[12px] text-primary-foreground/70">
            {[foco.data?.empresa, conversa.instanceName].filter(Boolean).join(" · ")}
          </p>
        </div>
        {mostrarDono &&
          (conversa.ownerName ? (
            <div className="flex shrink-0 items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-primary-foreground/15 text-[11px] font-bold" aria-hidden>
                {iniciais(conversa.ownerName)}
              </span>
              <span className="leading-tight">
                <span className="block text-[13px] font-bold">{conversa.ownerName}</span>
                <span className="block text-[11px] text-primary-foreground/70">Responsável</span>
              </span>
            </div>
          ) : (
            <span className="shrink-0 rounded-full bg-tinta px-2.5 py-1 text-[11px] font-bold text-tinta-foreground">
              Sem responsável
            </span>
          ))}
      </div>

      {/* (b) o que o cliente disse */}
      <FocusTile className="p-4">
        <p className="flex gap-2 text-[16px] font-semibold leading-snug">
          <MessageCircle className="mt-1 h-4 w-4 shrink-0" aria-hidden />
          <span>“{conversa.lastClientMessage?.trim() || "Mensagem sem texto"}”</span>
        </p>
        <p className="mt-2 text-[11px] font-semibold text-primary-foreground/65">
          Caixa {conversa.instanceName} · {conversa.aiReplied ? "IA respondeu, nenhum humano depois" : "Aguardando resposta"}
        </p>
      </FocusTile>

      {/* (c) onde o lead está — só leitura */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        <FocusTile>
          <p className="truncate text-[15px] font-extrabold">{carregando ? "…" : foco.data?.etapa ?? "Sem negócio aberto"}</p>
          <p className="truncate text-[11px] text-primary-foreground/65">
            Etapa{foco.data?.funil ? ` · ${foco.data.funil}` : ""}
          </p>
        </FocusTile>
        <FocusTile>
          <p className="truncate text-[15px] font-extrabold">{carregando ? "…" : tier?.label ?? "Sem qualificação"}</p>
          <p className="truncate text-[11px] text-primary-foreground/65">Qualificação</p>
        </FocusTile>
        <FocusTile>
          <p className="truncate text-[15px] font-extrabold">
            {copilot.isLoading ? "…" : copilot.data?.ai_disabled ? "IA pausada" : "IA ativa"}
          </p>
          <p className="truncate text-[11px] text-primary-foreground/65">Copilot</p>
        </FocusTile>
      </div>

      {/* (d) agir */}
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-primary-foreground/10 pt-4">
        <Link
          to={`/leads?lead=${conversa.leadId}`}
          className="inline-flex h-9 items-center rounded-full bg-primary-foreground/10 px-4 text-[12.5px] font-bold transition-colors hover:bg-primary-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/40"
        >
          Ver lead
        </Link>
        <span className="flex-1" />
        <AbrirConversaButton
          leadId={conversa.leadId}
          phone={conversa.phoneNumber}
          variant="outline"
          className="h-11 justify-center rounded-full border-transparent bg-white px-5 text-[13px] font-bold text-neutral-900 shadow-none hover:bg-white/90"
          aria-label={`Abrir conversa com ${conversa.displayName}`}
        >
          Abrir conversa
          <ArrowRight className="h-4 w-4" />
        </AbrirConversaButton>
      </div>
    </FocusCard>
  );
}
