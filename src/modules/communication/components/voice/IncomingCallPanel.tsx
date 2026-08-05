/**
 * Os cartões das ligações que estão ENTRANDO.
 *
 * Uma tela de chamada recebida tem um trabalho só, e é decidir em segundos: com
 * quem eu vou falar, e por qual número ele me procurou. Nada mais cabe — quem
 * está com o telefone tocando não lê.
 *
 * ─── O que decide o conteúdo: 47% dos contatos não têm lead ─────────────────
 * Por isso a linha de cima é `nome || telefone`, e nunca "Desconhecido" ou um
 * espaço vazio esperando por um cadastro que quase metade das vezes não existe.
 * Um cliente novo ligando é a ligação mais valiosa que entra aqui, e ela chega
 * exatamente sem nome.
 *
 * ─── Duas ao mesmo tempo não podem se atropelar ─────────────────────────────
 * Elas EMPILHAM numa coluna, e não se sobrepõem. O empilhamento é do container
 * (`VoiceCallProvider`), não de cada cartão: posição absoluta por cartão é o que
 * faria a segunda cobrir a primeira.
 */
import { PhoneIncoming, BellOff, Phone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPeerPhone } from "@/modules/communication/lib/formatPeerPhone";
import { normalizePhone } from "@/lib/normalizePhone";
import {
  useIncomingCallerName,
  type IncomingVoiceCall,
} from "@/modules/communication/hooks/useIncomingVoiceCalls";

/**
 * Quantos cartões cabem antes de a coluna virar uma parede.
 *
 * Três já é um cenário que ninguém atende; a partir daí o que ajuda é saber
 * QUANTAS são, não ver todas. E uma coluna sem teto sairia da tela por cima,
 * levando junto a que chegou primeiro.
 */
const MAXIMO_VISIVEL = 3;

function CartaoDeEntrada({
  call,
  silenced,
  busy,
  onAnswer,
  onDismiss,
}: {
  call: IncomingVoiceCall;
  silenced: boolean;
  /** O vendedor já está em outra chamada: atender está fechado, não escondido. */
  busy: boolean;
  onAnswer: (call: IncomingVoiceCall) => void;
  onDismiss: (call: IncomingVoiceCall) => void;
}) {
  const nome = useIncomingCallerName(call.peerDigits);
  /**
   * O telefone é CANONIZADO antes de ser formatado, e isto não é preciosismo.
   *
   * A oferta chega com o JID do WhatsApp, que vem **sem o nono dígito**:
   * `555185960716`. Formatado como veio, ele vira `(51) 8596-0716` — um número
   * de oito dígitos que não existe, que o vendedor não reconhece e que ele não
   * consegue retornar. `normalizePhone` é a mesma tradução que o chat usa
   * (espelho de `normalize_brazilian_phone`), e devolve `(51) 98596-0716`.
   *
   * O painel da chamada que SAI não faz isto de propósito: lá o `peer` já vem
   * derivado do cadastro pelo servidor, e não passou pela perda do JID. Normaliza
   * quem sabe que perdeu.
   */
  const telefone = formatPeerPhone(normalizePhone(call.peerDigits) ?? call.peerDigits);
  // Sem telefone utilizável o JID não era um número (conta LID, oferta de
  // grupo). A ligação é real e segue tocando; o que falta é a identidade, e
  // dizer isso é melhor que um cartão em branco.
  const titulo = nome || telefone || "Número não identificado";

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="w-full overflow-hidden rounded-xl border border-accent/40 bg-card shadow-2xl"
    >
      <div className="flex items-center gap-3 p-4">
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10">
          {/* O halo pulsa enquanto a oferta está viva. Ele some junto com o
              cartão — não há estado "tocou e parou". */}
          <span className="absolute inset-0 animate-ping rounded-full bg-accent/20" />
          <PhoneIncoming className="relative h-4 w-4 text-accent" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{titulo}</p>
          <p className="truncate text-xs text-muted-foreground">
            Chamando em {call.instanceName}
            {/* O telefone volta a aparecer ao lado do nome: é ele que o vendedor
                confere quando o cadastro tem homônimo. */}
            {nome && telefone && (
              <span className="text-muted-foreground/70"> · {telefone}</span>
            )}
          </p>
        </div>
      </div>

      {silenced && (
        <div className="flex items-center gap-2 border-t border-border/40 bg-background/40 px-4 py-2">
          <BellOff className="h-3.5 w-3.5 shrink-0 text-warning" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Sem som — o navegador só libera o toque depois que você clicar na
            página.
          </p>
        </div>
      )}

      {/* ─── As duas ações, e elas NÃO são simétricas ─────────────────────────
          Atender é a ação; Recusar é a saída. Por isso uma é o botão cheio e a
          outra um ícone discreto — e é o mesmo desequilíbrio do produto: quem
          recusa não decide nada sobre a ligação, só tira o cartão da frente.
          A ligação segue tocando no celular dele e nos CRMs dos colegas. */}
      <div className="flex items-center gap-2 border-t border-border/40 bg-background/40 px-3 py-2.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDismiss(call)}
          className="gap-2 text-muted-foreground"
          // Diz o que recusar FAZ, porque o rótulo sozinho promete o contrário:
          // "recusar" soa como desligar na cara do cliente, e não é isso.
          title="Tira esta ligação da sua tela. Ela continua tocando no seu celular e para os colegas."
        >
          <X className="h-4 w-4" />
          Recusar
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={() => onAnswer(call)}
          disabled={busy}
          className="gap-2"
          title={busy ? "Você já está em uma chamada" : undefined}
        >
          <Phone className="h-4 w-4" />
          Atender
        </Button>
      </div>
    </div>
  );
}

export function IncomingCallPanel({
  calls,
  silenced,
  busy,
  onAnswer,
  onDismiss,
}: {
  calls: IncomingVoiceCall[];
  silenced: boolean;
  busy: boolean;
  onAnswer: (call: IncomingVoiceCall) => void;
  onDismiss: (call: IncomingVoiceCall) => void;
}) {
  if (calls.length === 0) return null;

  // As MAIS RECENTES ficam visíveis, e a mais nova por último — encostada no
  // painel da chamada em curso, que é onde o olho já está.
  const visiveis = calls.slice(-MAXIMO_VISIVEL);
  const ocultas = calls.length - visiveis.length;

  return (
    <>
      {ocultas > 0 && (
        <p className="w-full rounded-lg border border-border/60 bg-card/90 px-3 py-1.5 text-center text-xs text-muted-foreground shadow-lg">
          +{ocultas} {ocultas === 1 ? "outra ligação" : "outras ligações"} chamando
        </p>
      )}
      {visiveis.map((call) => (
        // A chave é o PAR `(sessão, chamada)` — o quarto lugar da identidade, e
        // o único em que o próprio React avisa quando a premissa não vale. Na
        // entrada o `tcCallId` vem do stanza REMOTO: duas sessões podem receber
        // o mesmo, e chave duplicada faz o React dizer, literalmente, que o
        // comportamento "não é suportado e pode mudar numa versão futura". Ver
        // `mesmaChamada`, em `useIncomingVoiceCalls.ts`.
        <CartaoDeEntrada
          key={`${call.tcSessionId.length}:${call.tcSessionId}:${call.tcCallId}`}
          call={call}
          silenced={silenced}
          busy={busy}
          onAnswer={onAnswer}
          onDismiss={onDismiss}
        />
      ))}
    </>
  );
}
