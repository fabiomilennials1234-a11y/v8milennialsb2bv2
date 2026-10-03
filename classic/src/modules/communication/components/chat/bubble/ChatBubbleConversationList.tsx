/**
 * Lista de conversas da bolha de chat — todas as caixas de Chip permitidas.
 *
 * ─── A RÉPLICA MANUAL MORREU AQUI (D10) ────────────────────────────────────
 *
 * Até a W4 este arquivo tinha uma cópia da consulta de lista escrita à mão:
 * baixava até 8.000 mensagens POR CAIXA, deduplicava por telefone no
 * navegador, resolvia nome de lead num segundo `select`, contava não-lidas
 * varrendo o `localStorage` e ainda lia `whatsapp_conversations` para saber o
 * que estava arquivado. Cinco idas ao banco por caixa, e um resultado que
 * divergia da lista do `/chat` sem ninguém saber qual das duas estava certa.
 *
 * Agora consome a MESMA função do banco que o `/chat` usa
 * (`useConversasUnificadas` → `get_whatsapp_conversation_list_multi`): uma
 * chamada para todas as caixas, lendo a tabela-resumo, com não-lida vinda do
 * `conversation_read_state` e a caixa de origem em cada linha.
 *
 * ⚠️ NÃO É INCIDENTE DE SEGURANÇA, e não foi tratado como um: a leitura direta
 *    passava por `whatsapp_messages`, cuja RLS já aplica `can_see_chat` —
 *    conferido ao vivo em produção. O problema era duplicação e divergência.
 *
 * ─── O QUE CONTINUA IGUAL, DE PROPÓSITO ────────────────────────────────────
 *
 * A bolha mostra só conversa ATIVA (arquivada fica fora), a busca segue local
 * sobre nome e telefone, o filtro por caixa segue visual, e a virtualização
 * entra acima de 50 linhas. Ela também NÃO é aposentada: serve para responder
 * sem sair do funil ou da Carteira.
 *
 * ⚠️ SÓ CAIXAS DE CHIP. A thread da bolha lê `whatsapp_messages`
 *    (`useWhatsAppMessages`), então listar aqui uma conversa do canal oficial
 *    abriria uma thread vazia — mostrar conversa que não abre é pior que não
 *    mostrar. O canal oficial na bolha é fatia própria.
 */
import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatBubbleConversationItem } from "./ChatBubbleConversationItem";
import { ChatBubbleEmptyState } from "./ChatBubbleEmptyState";
import { useConversasUnificadas } from "@/modules/communication/hooks/chat/useConversasUnificadas";
import { boxUsesChannelMessages } from "@/modules/communication/hooks/chat/inbox-box-source";
import { isWhatsAppContact } from "@/modules/communication/hooks/chat/types";
import type {
  ChatContact,
  InboxBox,
  WhatsAppInstanceForUser,
} from "@/modules/communication/hooks/chat/types";

const VIRTUALIZE_THRESHOLD = 50;

interface ListEntry {
  contact: ChatContact;
  instanceId: string;
  instanceName: string;
}

interface ChatBubbleConversationListProps {
  instances: WhatsAppInstanceForUser[];
  searchQuery: string;
  selectedPhone: string | null;
  selectedInstanceId: string | null;
  /** Filtro visual por instância. "all" = sem filtro. */
  filterInstanceId: string | "all";
  onSelect: (phone: string, instanceId: string) => void;
  /** Reseta filtro pra "all" — usado pelo empty `filtered-empty`. */
  onResetFilter: () => void;
}

export function ChatBubbleConversationList({
  instances,
  searchQuery,
  selectedPhone,
  selectedInstanceId,
  filterInstanceId,
  onSelect,
  onResetFilter,
}: ChatBubbleConversationListProps) {
  const showInstanceDot = instances.length > 1;

  /**
   * As caixas que esta lista cobre: só CHIP.
   *
   * A thread da bolha lê `whatsapp_messages`; incluir o canal oficial faria a
   * linha aparecer e a conversa abrir vazia. `boxUsesChannelMessages` decide
   * pelo PROVIDER, que é o discriminador certo — o canal oficial também é
   * `kind: "whatsapp"`.
   */
  const caixas = useMemo<InboxBox[]>(
    () =>
      instances
        .map(
          (i): InboxBox => ({
            kind: "whatsapp",
            id: i.id,
            name: i.instance_name,
            status: i.status,
            provider: i.provider,
          }),
        )
        .filter((box) => !boxUsesChannelMessages(box)),
    [instances],
  );

  // A MESMA fonte do /chat: uma chamada para todas as caixas, limite global,
  // ordenação por recência feita no servidor. Sem `serverFilter` — a bolha não
  // tem as dimensões do inbox, e o padrão já traz a página completa.
  const { linhas, isLoading, isFetching } = useConversasUnificadas(caixas);

  const allEntries: ListEntry[] = useMemo(
    () =>
      linhas.flatMap((linha) => {
        const contato = linha.contato;
        // A bolha é WhatsApp por QR de ponta a ponta; o estreitamento mantém o
        // resto do arquivo sem um único `as`.
        if (!isWhatsAppContact(contato)) return [];
        // Arquivada fica de fora — a bolha mostra só conversa ativa, como antes.
        if (contato.archived_at) return [];
        return [
          {
            contact: contato,
            instanceId: linha.caixa.id,
            instanceName: linha.caixa.nome,
          },
        ];
      }),
    [linhas],
  );

  // Filtro por instância (visual, client-side). Aplicado ANTES de search/empty
  // pra que o empty state filtered-empty fale do contexto correto.
  const instanceFiltered: ListEntry[] = useMemo(() => {
    if (filterInstanceId === "all") return allEntries;
    return allEntries.filter((e) => e.instanceId === filterInstanceId);
  }, [allEntries, filterInstanceId]);

  const filtered: ListEntry[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return instanceFiltered;
    return instanceFiltered.filter((e) => {
      const name = (e.contact.lead_name || e.contact.push_name || "").toLowerCase();
      const phone = (e.contact.phone_number || "").toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [instanceFiltered, searchQuery]);

  // Nome da instância filtrada (pro empty state `filtered-empty`)
  const filteredInstanceName = useMemo(() => {
    if (filterInstanceId === "all") return null;
    return instances.find((i) => i.id === filterInstanceId)?.instance_name ?? null;
  }, [filterInstanceId, instances]);

  // Virtualização
  const scrollRef = useRef<HTMLDivElement>(null);
  const useVirtual = filtered.length > VIRTUALIZE_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: useVirtual ? filtered.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col gap-1 px-3 py-3" aria-label="Carregando conversas">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton className="w-8 h-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-44" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (instances.length === 0) {
    return <ChatBubbleEmptyState variant="no-instance" />;
  }

  if (filtered.length === 0) {
    if (searchQuery.trim()) {
      return (
        <div className="flex flex-col items-center justify-center text-center px-6 py-12 gap-2">
          <p className="text-sm text-muted-foreground">
            Nenhum resultado pra "{searchQuery.trim()}"
          </p>
        </div>
      );
    }
    if (filterInstanceId !== "all" && filteredInstanceName) {
      return (
        <ChatBubbleEmptyState
          variant="filtered-empty"
          instanceName={filteredInstanceName}
          onReset={onResetFilter}
        />
      );
    }
    return <ChatBubbleEmptyState variant="no-conversations" />;
  }

  // ── Lista renderizada ──────────────────────────────────────────────────────
  return (
    <ScrollArea className="flex-1 min-h-0">
      <div ref={scrollRef} className="relative">
        {useVirtual ? (
          <ul
            role="list"
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const entry = filtered[vi.index];
              if (!entry) return null;
              return (
                <div
                  key={`${entry.instanceId}::${entry.contact.phone_number}`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <ChatBubbleConversationItem
                    contact={entry.contact}
                    instanceId={entry.instanceId}
                    instanceName={entry.instanceName}
                    showInstanceDot={showInstanceDot}
                    isSelected={
                      selectedPhone === entry.contact.phone_number &&
                      selectedInstanceId === entry.instanceId
                    }
                    onSelect={() => onSelect(entry.contact.phone_number, entry.instanceId)}
                  />
                </div>
              );
            })}
          </ul>
        ) : (
          <ul role="list">
            {filtered.map((entry) => (
              <ChatBubbleConversationItem
                key={`${entry.instanceId}::${entry.contact.phone_number}`}
                contact={entry.contact}
                instanceId={entry.instanceId}
                instanceName={entry.instanceName}
                showInstanceDot={showInstanceDot}
                isSelected={
                  selectedPhone === entry.contact.phone_number &&
                  selectedInstanceId === entry.instanceId
                }
                onSelect={() => onSelect(entry.contact.phone_number, entry.instanceId)}
              />
            ))}
          </ul>
        )}

        {isFetching && !isLoading && (
          <div className="absolute top-2 right-2 text-muted-foreground/60">
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
