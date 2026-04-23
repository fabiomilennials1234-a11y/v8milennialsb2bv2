/**
 * useConversationReadState — rastreamento de "última leitura" de conversas.
 *
 * Onda 2a C14 — implementa Opção B (Architect Plan seção 4):
 * - Persiste em localStorage com chave user-scoped (B1 pattern)
 * - Backward-compat: lê chave legada `whatsapp_last_seen_${phone}` se nova chave vazia
 * - UPSERT em conversation_read_state (tabela da migration 20260422120000) quando disponível
 * - Fallback silencioso se tabela não existir (migration não aplicada em prod ainda)
 *
 * Chave nova:  `chat-last-read:${userId}:${orgId}:${phone}`
 * Chave legada: `whatsapp_last_seen_${phone}` (Onda 1 — migrado silenciosamente)
 *
 * API:
 *   const { lastReadAt, markAsRead } = useConversationReadState({ phoneNumber, leadId, organizationId })
 *   lastReadAt: number (epoch ms, 0 = nunca lido)
 *   markAsRead(): void — chama ao abrir conversa
 */
import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface UseConversationReadStateOptions {
  phoneNumber: string;
  leadId?: string | null;
  organizationId?: string | null;
}

export interface ConversationReadState {
  lastReadAt: number;
  markAsRead: () => void;
  isLoading: boolean;
}

// ─── Helpers de chave localStorage ───────────────────────────────────────────

function buildUserScopedKey(
  userId: string,
  orgId: string,
  phone: string
): string {
  return `chat-last-read:${userId}:${orgId}:${phone}`;
}

/** Normaliza telefone com a mesma lógica do banco */
function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");
  if (!cleaned) return phone;
  if (cleaned.length >= 12 && cleaned.startsWith("55")) cleaned = cleaned.slice(2);
  if (cleaned.length === 10) cleaned = cleaned.slice(0, 2) + "9" + cleaned.slice(2);
  return cleaned;
}

/** Formato da conversation_key (deve ser consistente com B1 security pattern) */
function buildConversationKey(instanceId: string | null | undefined, phone: string): string {
  return instanceId ? `whatsapp:${instanceId}:${phone}` : `whatsapp:unknown:${phone}`;
}

/** Lê last-read do localStorage (chave nova) com fallback para chave legada */
function readLocalLastReadAt(
  userId: string,
  orgId: string,
  phone: string
): number {
  const normalizedPhone = normalizePhone(phone);
  try {
    // Tenta chave nova (user-scoped)
    const newKey = buildUserScopedKey(userId, orgId, normalizedPhone);
    const stored = localStorage.getItem(newKey);
    if (stored) return new Date(stored).getTime() || 0;

    // Fallback: chave legada Onda 1 (não user-scoped — lê só se nova estiver vazia)
    const legacyKey = `whatsapp_last_seen_${normalizedPhone}`;
    const legacy = localStorage.getItem(legacyKey);
    if (legacy) {
      const ts = new Date(legacy).getTime() || 0;
      // Migrar silenciosamente para a chave nova
      if (ts > 0) {
        localStorage.setItem(newKey, legacy);
        localStorage.removeItem(legacyKey);
      }
      return ts;
    }
  } catch {
    // localStorage unavailable
  }
  return 0;
}

/** Persiste last-read no localStorage (chave user-scoped) */
function writeLocalLastReadAt(
  userId: string,
  orgId: string,
  phone: string
): void {
  const normalizedPhone = normalizePhone(phone);
  try {
    const newKey = buildUserScopedKey(userId, orgId, normalizedPhone);
    localStorage.setItem(newKey, new Date().toISOString());
    // Limpar legado se existir
    localStorage.removeItem(`whatsapp_last_seen_${normalizedPhone}`);
  } catch {
    // localStorage unavailable
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useConversationReadState({
  phoneNumber,
  organizationId,
}: UseConversationReadStateOptions): ConversationReadState {
  const { user } = useAuth();
  const { data: teamMember } = useCurrentTeamMember();

  const userId = user?.id;
  const orgId = organizationId ?? teamMember?.organization_id ?? null;

  const [lastReadAt, setLastReadAt] = useState<number>(() => {
    if (!userId || !orgId) return 0;
    return readLocalLastReadAt(userId, orgId, phoneNumber);
  });
  const [isLoading] = useState(false);

  // Sincroniza quando conversa muda
  useEffect(() => {
    if (!userId || !orgId) {
      setLastReadAt(0);
      return;
    }
    setLastReadAt(readLocalLastReadAt(userId, orgId, phoneNumber));
  }, [userId, orgId, phoneNumber]);

  const markAsRead = useCallback(() => {
    if (!userId || !orgId) return;

    const now = Date.now();
    setLastReadAt(now);

    // Persiste no localStorage (imediato)
    writeLocalLastReadAt(userId, orgId, phoneNumber);

    // Tenta UPSERT na tabela conversation_read_state (se migration aplicada)
    // Erro silencioso: fallback localStorage já é a fonte de verdade nesta onda
    void (async () => {
      try {
        const conversationKey = buildConversationKey(
          teamMember?.organization_id ? undefined : null,
          phoneNumber
        );
        await supabase.from("conversation_read_state" as string).upsert(
          {
            organization_id: orgId,
            user_id: userId,
            conversation_key: conversationKey,
            last_read_at: new Date().toISOString(),
          },
          { onConflict: "organization_id,user_id,conversation_key" }
        );
      } catch {
        // Tabela não existe ou UPSERT falhou — fallback localStorage é suficiente
      }
    })();
  }, [userId, orgId, phoneNumber, teamMember?.organization_id]);

  return { lastReadAt, markAsRead, isLoading };
}
