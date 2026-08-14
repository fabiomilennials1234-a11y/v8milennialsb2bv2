/**
 * useSocialRealtime — mensagem nova de canal social aparece sem F5.
 *
 * INVALIDAÇÃO, não cache-patching. `useWhatsAppMessagesRealtime` tem ~140 linhas
 * de patch cirúrgico porque lá o volume justifica: 30 orgs, milhares de
 * mensagens por dia, e um refetch por evento seria carga real. Aqui o volume
 * esperado é near-zero até o primeiro canal ser conectado — replicar o patcher
 * seria mecanismo sem carga, e mecanismo sem carga é mecanismo que ninguém
 * percebe quando quebra.
 *
 * `useRealtimeSubscription` de `@/shared/realtime` já entrega o transporte
 * pronto: filtro `organization_id` no servidor, debounce de 2s e invalidação por
 * PREFIXO de queryKey. `channel_messages` já está na publicação
 * `supabase_realtime` (medido em produção) — nada a alterar no banco.
 *
 * UMA subscription para os dois alvos, e não duas: dois `useRealtimeSubscription`
 * na MESMA tabela abririam dois canais postgres_changes para o mesmo fluxo de
 * eventos, dobrando a pressão no pool de Realtime — o recurso que já derrubou
 * este produto uma vez. A lista é invalidada primeiro; a thread, 2s depois,
 * pelo stagger que o transporte já implementa.
 *
 * GATE POR MONTAGEM. `useRealtimeSubscription` não aceita `enabled`; quem decide
 * se o canal existe é quem monta o hook. O shell só o monta com a caixa social
 * aberta (`SocialRealtimeMount`), então nenhuma das ~30 orgs que só usam
 * WhatsApp paga uma subscription por causa desta fatia.
 */
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import {
  SOCIAL_CONTACTS_KEY_ROOT,
  SOCIAL_MESSAGES_KEY_ROOT,
} from "./shared/queryKeys";

const SOCIAL_KEYS = [SOCIAL_CONTACTS_KEY_ROOT, SOCIAL_MESSAGES_KEY_ROOT];

export function useSocialRealtime() {
  useRealtimeSubscription("channel_messages", SOCIAL_KEYS);
}
