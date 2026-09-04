import { Bot, MessageSquareDot, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
import { formatContactTime } from "@/modules/communication/components/chat/list/ConversationListItem";
import {
  useConversasAguardando,
  type ConversaAguardando,
} from "@/modules/analytics/hooks/useConversasAguardando";
import { ComandoCard } from "./ComandoCard";
import { DonoDaLinha } from "./DonoDaLinha";

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

  return (
    <ComandoCard
      icon={MessageSquareDot}
      title="Aguardando resposta"
      count={total}
      tone="urgent"
      scopeHint={isAdmin ? "Equipe" : undefined}
      action={{ label: "Abrir chat", to: "/chat-whatsapp" }}
      isLoading={isLoading}
      isError={isError}
      onRetry={refetch}
      isEmpty={items.length === 0}
      /* Sem número conectado a fila não está limpa — ela nunca foi perguntada.
         Dizer "ninguém esperando" aqui seria afirmar o que não se mediu. */
      emptyTitle={semChips ? "Nenhum WhatsApp conectado" : "Ninguém esperando"}
      emptyHint={
        semChips
          ? "Este card lê as conversas do WhatsApp. Conecte um número em Configurações › WhatsApp para a fila aparecer aqui."
          : isAdmin
            ? "Todo cliente com lead cadastrado que falou já teve resposta de alguém do time. É o estado que você quer ver aqui."
            : "Todo cliente com lead cadastrado que falou com você já teve resposta. É o estado que você quer ver aqui."
      }
      notice={
        <>
          {isDegraded ? (
            <p className="border-b border-border/50 bg-muted/40 px-4 py-2 text-[10px] leading-relaxed text-muted-foreground/80">
              Lista parcial: mostrando só as conversas sem nenhuma resposta. As
              que a IA respondeu entram depois que a migration
              <span className="cmd-mono"> 20270821250000 </span>
              for aplicada neste banco.
            </p>
          ) : null}
          {/* Falha parcial de chip encurta a lista. Sem esta linha ela encurta
              calada, e a tela vira "está tudo respondido". */}
          {chipsComErro > 0 && !isError ? (
            <p className="border-b border-border/50 bg-muted/40 px-4 py-2 text-[10px] leading-relaxed text-muted-foreground/80">
              {chipsComErro === 1
                ? "Um número não respondeu agora — a fila dele está fora desta lista."
                : `${chipsComErro} números não responderam agora — as filas deles estão fora desta lista.`}
            </p>
          ) : null}
        </>
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
        {/* `c.leadId &&` não é redundância com o filtro do hook: é o que estreita
            o tipo para o contrato de `AbrirConversaButton`, que exige `leadId`. */}
        {items.map(
          (c) =>
            c.leadId && (
              <li key={c.key}>
                <AbrirConversaButton
                  leadId={c.leadId}
                  phone={c.phoneNumber}
                  variant="ghost"
                  className={LINHA_CLASSES}
                  aria-label={`Abrir conversa com ${c.displayName}`}
                >
                  <LinhaConversa conversa={c} mostrarDono={isAdmin} />
                </AbrirConversaButton>
              </li>
            ),
        )}
      </ul>
    </ComandoCard>
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
        {/* Terceira linha só para admin: de quem é a conversa. Fica embaixo, e
            não na coluna da direita, porque nome de pessoa é largo e ali
            disputaria espaço com a hora — que é o dado que o olho procura
            primeiro numa fila de espera. */}
        {mostrarDono && (
          <DonoDaLinha nome={conversa.ownerName} className="mt-0.5" />
        )}
      </span>

      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-[11px] tabular-nums text-muted-foreground/70">
          {formatContactTime(conversa.lastClientMessageAt)}
        </span>
        {/* A instância é requisito explícito do admin ("saber qual WhatsApp
            está vinculado"), então para ele aparece SEMPRE — inclusive no
            estreito. Para o vendedor continua como estava: só a partir de `sm`,
            porque ele costuma ter uma caixa só e o dado é ruído. */}
        <span
          className={cn(
            "items-center gap-1 text-[10px] text-muted-foreground/50",
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
