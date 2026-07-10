/**
 * useTicketAttachments — os prints que um Chamado carrega.
 *
 * Bucket privado. A leitura sai por URL assinada de vida curta, e a autorização
 * acontece no servidor: a policy do Storage deriva o Chamado do primeiro
 * segmento do caminho e pergunta a `can_read_support_ticket()`. Esconder um
 * botão no React não protegeria arquivo nenhum (ADR-0018).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  SIGNED_URL_TTL_SECONDS,
  SUPPORT_ATTACHMENTS_BUCKET,
  attachmentPath,
  validateAttachment,
} from "@/modules/platform/lib/support-attachments";

const KEY = "support-ticket-attachments";

export interface TicketAttachment {
  path: string;
  name: string;
  /** Assinada, morre em 5 minutos. Se vazar depois disso, é link morto. */
  signedUrl: string;
}

export function useTicketAttachments(ticketId: string | null) {
  return useQuery({
    queryKey: [KEY, ticketId],
    queryFn: async (): Promise<TicketAttachment[]> => {
      const { data: files, error } = await supabase.storage
        .from(SUPPORT_ATTACHMENTS_BUCKET)
        .list(ticketId!);

      if (error) throw error;
      if (!files?.length) return [];

      const paths = files.map((f) => `${ticketId}/${f.name}`);
      const { data: signed, error: signError } = await supabase.storage
        .from(SUPPORT_ATTACHMENTS_BUCKET)
        .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

      if (signError) throw signError;

      return (signed ?? [])
        .filter((s) => !!s.signedUrl)
        .map((s) => ({
          path: s.path ?? "",
          name: (s.path ?? "").split("/").pop() ?? "",
          signedUrl: s.signedUrl,
        }));
    },
    enabled: !!ticketId,
    // A URL expira em 5 min: não vale a pena manter em cache além disso.
    staleTime: (SIGNED_URL_TTL_SECONDS - 30) * 1000,
  });
}

export function useUploadTicketAttachment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ticketId, file }: { ticketId: string; file: File }) => {
      const check = validateAttachment(file);
      if (!check.ok) throw new Error(check.reason);

      const path = attachmentPath(ticketId, file.name);
      const { error } = await supabase.storage
        .from(SUPPORT_ATTACHMENTS_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });

      if (error) throw error;
      return path;
    },
    onSuccess: (_path, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: [KEY, ticketId] });
    },
  });
}
