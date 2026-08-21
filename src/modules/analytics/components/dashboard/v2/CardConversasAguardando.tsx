import { Link } from "react-router-dom";
import { Bot, MessageSquareDot, Smartphone } from "lucide-react";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
import { formatContactTime } from "@/modules/communication/components/chat/list/ConversationListItem";
import {
  useConversasAguardando,
  type ConversaAguardando,
} from "@/modules/analytics/hooks/useConversasAguardando";
import { ComandoCard } from "./ComandoCard";

const MOSTRAR = 10;

/** Linha inteira é o alvo do clique: a lista é a ação, não a decoração. */
const LINHA_CLASSES =
  "flex h-auto w-full items-center justify-start gap-3 whitespace-normal rounded-none px-4 py-2.5 text-left font-normal transition-colors hover:bg-muted/40";

/**
 * Bloco 1 — o mais importante da tela, e o único que representa dinheiro
 * escapando: cliente que falou e não foi respondido.
 *
 * ⚠️ ABRIR CONVERSA TEM UM CAMINHO SÓ. É `AbrirConversaButton`, e um
 * `no-restricted-imports` em `eslint.config.js` reprova quem chamar
 * `useOpenWhatsAppChat` direto — a regra existe porque esse hook já foi chamado
 * em 9 lugares com 9 regras diferentes, e um dos botões passou meses lançando
 * `ReferenceError`. O componente decide sozinho: uma caixa abre direto, mais de
 * uma pergunta por qual falar.
 */
export function CardConversasAguardando() {
  const { items, total, isLoading, isError, isDegraded } =
    useConversasAguardando(MOSTRAR);

  const restantes = Math.max(0, total - items.length);

  return (
    <ComandoCard
      icon={MessageSquareDot}
      title="Aguardando resposta"
      count={total}
      tone="urgent"
      action={{ label: "Abrir chat", to: "/chat-whatsapp" }}
      isLoading={isLoading}
      isError={isError}
      isEmpty={items.length === 0}
      emptyTitle="Ninguém esperando"
      emptyHint="Todo cliente que falou já teve resposta de alguém do time. É o estado que você quer ver aqui."
      notice={
        isDegraded ? (
          <p className="border-b border-border/50 bg-muted/40 px-4 py-2 text-[10px] leading-relaxed text-muted-foreground/80">
            Lista parcial: mostrando só as conversas sem nenhuma resposta. As que
            a IA respondeu entram depois que a migration
            <span className="cmd-mono"> 20270821170000 </span>
            for aplicada neste banco.
          </p>
        ) : null
      }
      footer={
        restantes > 0 ? (
          <p className="text-[11px] text-muted-foreground/70">
            e mais <span className="font-bold tabular-nums">{restantes}</span>{" "}
            {restantes === 1 ? "conversa esperando" : "conversas esperando"}
          </p>
        ) : null
      }
    >
      <ul className="divide-y divide-border/50">
        {items.map((c) => (
          <li key={c.key}>
            {c.leadId ? (
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
              /* Sem lead vinculado o caminho sancionado não se aplica — ele
                 exige `leadId` por contrato. A conversa existe e o vendedor
                 precisa alcançá-la, então a linha leva ao chat já apontando a
                 caixa exata; não há "qual caixa?" a perguntar, porque o hook
                 fez fan-out por instância e cada linha carrega a sua. */
              <Link
                to={`/chat-whatsapp?phone=${encodeURIComponent(c.phoneNumber)}&instance=${encodeURIComponent(c.instanceId)}`}
                className={LINHA_CLASSES}
                aria-label={`Abrir conversa com ${c.displayName}`}
              >
                <LinhaConversa conversa={c} />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </ComandoCard>
  );
}

function LinhaConversa({ conversa }: { conversa: ConversaAguardando }) {
  return (
    <>
      {/* O ponto é o sinal de "parada aqui". Sem ele a linha some no meio da lista. */}
      <span
        className="mt-[3px] h-1.5 w-1.5 shrink-0 self-start rounded-full bg-primary"
        aria-hidden
      />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold">
            {conversa.displayName}
          </span>
          {conversa.aiReplied && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded border border-border/70 px-1 py-px text-[9px] font-bold uppercase tracking-[0.06em] text-muted-foreground/70"
              title="A IA já respondeu; nenhum humano respondeu depois"
            >
              <Bot className="h-2.5 w-2.5" />
              IA
            </span>
          )}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground/70">
          {conversa.lastClientMessage?.trim() || "Mensagem sem texto"}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-[11px] tabular-nums text-muted-foreground/70">
          {formatContactTime(conversa.lastClientMessageAt)}
        </span>
        <span className="hidden items-center gap-1 text-[10px] text-muted-foreground/50 sm:flex">
          <Smartphone className="h-2.5 w-2.5" />
          <span className="max-w-[110px] truncate">{conversa.instanceName}</span>
        </span>
      </span>
    </>
  );
}
