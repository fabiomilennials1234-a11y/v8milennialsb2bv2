/**
 * Qual conversa está aberta na tela agora.
 *
 * Existe para uma regra só: não anunciar a mensagem de quem já se está lendo.
 * É estado de UI efêmero, de leitura global — não cabe em React Query (não é
 * dado do servidor) nem em contexto (o sino e o chat não têm ancestral comum
 * abaixo da aplicação inteira).
 */

let leadAberto: string | null = null;

export function definirConversaAberta(leadId: string | null): void {
  leadAberto = leadId;
}

export function conversaAberta(): string | null {
  return leadAberto;
}
