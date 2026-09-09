/**
 * `regimeDaConversaAberta` — de qual caixa sai a resposta. PURO.
 *
 * ─── POR QUE ISTO É UMA FUNÇÃO, E NÃO SEIS `const` NO SHELL ─────────────────
 *
 * É a decisão D6: o envio sai da Conversa do Lead ABERTA, não do estado global.
 * Até a caixa unificada, "a caixa selecionada" e "a caixa da conversa" eram a
 * mesma coisa, e a distinção não precisava de nome. Agora são conceitos
 * diferentes — a tela mostra várias caixas e a thread pertence à linha em que a
 * pessoa clicou —, e é dessa decisão que dependem o composer, o read-state, o
 * fetch da thread e o painel de contexto.
 *
 * Com ela fora do componente, o teste consegue perguntar "abri a linha do canal
 * oficial: por onde sai a resposta?" sem montar um shell de 1400 linhas e três
 * dezenas de hooks. Era o único jeito de a promessa da onda ficar presa por um
 * teste em vez de por uma leitura atenta do código.
 *
 * ─── OS TRÊS EIXOS ──────────────────────────────────────────────────────────
 *
 * Três, e não dois, desde o canal oficial:
 *
 *   `instanciaDeChip`   → WhatsApp por QR, lê e escreve em `whatsapp_messages`
 *   `canalDeInstagram`  → Instagram, lê `channel_messages` por canal
 *   `instanciaOficial`  → canal oficial, lê `channel_messages` por instância
 *
 * Cada consumidor recebe `null` quando não é a vez dele, e é isso que garante
 * que nenhuma das RPCs seja chamada com o uuid do eixo errado — as duas de
 * lista levantam 42501 nesse caso, por desenho.
 */
import { caixaDaChave } from "@/modules/communication/hooks/chat/types";
import { boxUsesChannelMessages } from "@/modules/communication/hooks/chat/inbox-box-source";
import type { InboxBox } from "@/modules/communication/hooks/chat/types";

export interface RegimeDaConversaAberta {
  /**
   * A caixa de referência da tela. É a da conversa aberta; sem conversa, é a
   * única marcada — e só quando é uma só. Com várias marcadas e nada aberto,
   * "a caixa atual" não existe, e inventar uma faria o composer nascer
   * apontando para um número arbitrário.
   */
  caixa: InboxBox | null;
  /** A caixa aberta lê `channel_messages`? Decide pelo PROVIDER, não pelo `kind`. */
  ehSocial: boolean;
  /** Dentro das sociais, a do canal oficial — a que envia por outra rota. */
  ehOficial: boolean;
  instanciaDeChip: string | null;
  canalDeInstagram: string | null;
  instanciaOficial: string | null;
}

export interface ArgsDoRegime {
  /** A chave da conversa aberta, ou `null`. */
  chave: string | null;
  /** Todas as caixas que a pessoa pode ler. */
  caixas: readonly InboxBox[];
  /** As caixas marcadas no seletor. */
  marcadas: readonly InboxBox[];
}

export function regimeDaConversaAberta({
  chave,
  caixas,
  marcadas,
}: ArgsDoRegime): RegimeDaConversaAberta {
  const idDaChave = caixaDaChave(chave);
  const aberta = idDaChave ? caixas.find((b) => b.id === idDaChave) : undefined;

  // A caixa da CHAVE ganha da seleção, sempre. É o coração da D6: a linha
  // clicada manda, mesmo que o seletor tenha outras caixas marcadas — e mesmo
  // que a caixa da linha nem esteja marcada, o que acontece por um instante
  // quando o deep-link abre uma conversa antes de o conjunto assentar.
  const caixa = aberta ?? (marcadas.length === 1 ? marcadas[0] : null);

  const ehSocial = caixa ? boxUsesChannelMessages(caixa) : false;
  const ehOficial = ehSocial && caixa?.kind === "whatsapp";

  return {
    caixa: caixa ?? null,
    ehSocial,
    ehOficial,
    instanciaDeChip: ehSocial ? null : (caixa?.id ?? null),
    // Desde a W5 o canal social sai da conversa ABERTA, e não de "a única caixa
    // marcada": com o Instagram dentro do conjunto, a tela pode ter uma conversa
    // de Instagram aberta ao lado de conversas de WhatsApp na mesma lista.
    canalDeInstagram: caixa?.kind === "instagram" ? caixa.id : null,
    instanciaOficial: ehOficial ? (caixa?.id ?? null) : null,
  };
}
