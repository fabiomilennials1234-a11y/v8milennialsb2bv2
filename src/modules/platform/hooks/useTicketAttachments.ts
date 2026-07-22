/**
 * useTicketAttachments — os arquivos que um Chamado carrega.
 *
 * A listagem sai da **tabela**, não do Storage: `filename`, autor, tamanho e o
 * vínculo com o Comentário só existem lá, e `storage.list()` não enxergaria o
 * ramo `internal/` sem uma segunda chamada. O Storage entra só para assinar as
 * URLs dos caminhos que a tabela devolveu.
 *
 * Bucket privado, URL assinada de vida curta, autorização no servidor: a policy
 * deriva o Chamado do primeiro segmento do caminho e, quando o segundo é
 * `internal`, exige master. Esconder um botão no React não protegeria arquivo
 * nenhum (ADR-0018, ADR-0022).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  SIGNED_URL_TTL_SECONDS,
  SUPPORT_ATTACHMENTS_BUCKET,
  attachmentPath,
  isPreviewable,
  validateAttachment,
} from "@/modules/platform/lib/support-attachments";

/** Exportada: `useTicketChannel` invalida esta mesma chave. */
export const ATTACHMENTS_QUERY_KEY = "support-ticket-attachments";
const KEY = ATTACHMENTS_QUERY_KEY;

/**
 * A tabela é nova; `types.ts` só a conhece depois que a migration for aplicada e
 * os tipos regenerados. Até lá o formato mora aqui.
 */
interface AttachmentRow {
  id: string;
  ticket_id: string;
  comment_id: string | null;
  path: string;
  filename: string;
  mime: string;
  size_bytes: number;
  is_internal: boolean;
  author_user_id: string | null;
  created_at: string;
  purged_at: string | null;
}

export interface TicketAttachment {
  id: string;
  commentId: string | null;
  path: string;
  /** O nome que o usuário deu. Vive na coluna, nunca no caminho. */
  filename: string;
  mime: string;
  sizeBytes: number;
  isInternal: boolean;
  authorUserId: string | null;
  createdAt: string;
  /** Imagem tem miniatura; o resto é card e baixa. */
  previewable: boolean;
  /**
   * Quando a retenção levou o arquivo. A linha fica: a thread continua dizendo
   * que houve uma evidência ali e que ela expirou (ADR-0022, 9).
   */
  purgedAt: string | null;
  /**
   * Assinada, morre em 5 minutos. Se vazar depois disso, é link morto. Vazia
   * quando o arquivo já foi removido pela retenção.
   */
  signedUrl: string;
}

const TABLE = "support_ticket_attachments";

export function useTicketAttachments(ticketId: string | null) {
  return useQuery({
    queryKey: [KEY, ticketId],
    queryFn: async (): Promise<TicketAttachment[]> => {
      const { data, error } = await supabase
        .from(TABLE as never)
        .select("*")
        .eq("ticket_id", ticketId!)
        .order("created_at", { ascending: true });

      if (error) throw error;
      const rows = (data ?? []) as unknown as AttachmentRow[];
      if (rows.length === 0) return [];

      // Assinar o que a retenção já levou seria pedir URL para arquivo que não
      // existe mais.
      const vivos = rows.filter((r) => !r.purged_at);

      const { data: signed, error: signError } = vivos.length
        ? await supabase.storage
            .from(SUPPORT_ATTACHMENTS_BUCKET)
            .createSignedUrls(
              vivos.map((r) => r.path),
              SIGNED_URL_TTL_SECONDS,
            )
        : { data: [], error: null };

      if (signError) throw signError;

      const urlByPath = new Map(
        (signed ?? []).filter((s) => !!s.signedUrl).map((s) => [s.path ?? "", s.signedUrl]),
      );

      return rows.flatMap((row) => {
        const url = urlByPath.get(row.path);
        // Sem URL e sem marca de retenção, a policy recusou: não há o que
        // mostrar. Com a marca, a linha vira lápide e continua na thread.
        if (!url && !row.purged_at) return [];

        const previewable = isPreviewable(row.mime);

        return [
          {
            id: row.id,
            commentId: row.comment_id,
            path: row.path,
            filename: row.filename,
            mime: row.mime,
            sizeBytes: row.size_bytes,
            isInternal: row.is_internal,
            authorUserId: row.author_user_id,
            createdAt: row.created_at,
            previewable,
            purgedAt: row.purged_at,
            // Não-imagem baixa, nunca abre inline: um PDF renderizado no visor
            // executa o JavaScript que carrega. E `download` devolve ao arquivo
            // o nome real, que o caminho não podia carregar.
            signedUrl: !url
              ? ""
              : previewable
                ? url
                : `${url}&download=${encodeURIComponent(row.filename)}`,
          },
        ];
      });
    },
    enabled: !!ticketId,
    // A URL expira em 5 min: não vale a pena manter em cache além disso.
    staleTime: (SIGNED_URL_TTL_SECONDS - 30) * 1000,
  });
}

export interface UploadAttachmentInput {
  ticketId: string;
  file: File;
  /** NULL quando o anexo vem na abertura do Chamado. */
  commentId?: string | null;
  /** Só master, e só quando o Comentário também é interno. */
  internal?: boolean;
}

export function useUploadTicketAttachment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ticketId,
      file,
      commentId = null,
      internal = false,
    }: UploadAttachmentInput) => {
      const check = validateAttachment(file);
      if (!check.ok) throw new Error(check.reason);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sessão expirada. Entre de novo para anexar.");

      const path = attachmentPath(ticketId, file.name, { internal });

      // O arquivo sobe antes da linha. Se a linha falhar, sobra objeto órfão que
      // ninguém lista — invisível, custa bytes. A ordem inversa deixaria uma
      // linha apontando para nada, que o master vê como anexo quebrado
      // (ADR-0022, 8).
      const { error: uploadError } = await supabase.storage
        .from(SUPPORT_ATTACHMENTS_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });

      if (uploadError) throw uploadError;

      const { error: rowError } = await supabase.from(TABLE as never).insert({
        ticket_id: ticketId,
        comment_id: commentId,
        path,
        filename: file.name,
        mime: file.type,
        size_bytes: file.size,
        is_internal: internal,
        author_user_id: user.id,
      } as never);

      if (rowError) throw rowError;
      return path;
    },
    onSuccess: (_path, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: [KEY, ticketId] });
    },
  });
}

/**
 * Remoção de um Anexo — só master, como o Chamado.
 *
 * A linha vai **antes** do objeto. Sem transação entre Postgres e Storage, uma
 * das duas pode sobrar: falha depois da linha deixa arquivo órfão que ninguém
 * lista (custa bytes, invisível); a ordem inversa deixaria linha apontando para
 * nada, que o master vê como anexo quebrado. Quando o resíduo é inevitável, ele
 * fica do lado que ninguém lê (ADR-0022, 8).
 */
export function useDeleteTicketAttachment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, path }: { id: string; path: string; ticketId: string }) => {
      const { error } = await supabase.from(TABLE as never).delete().eq("id", id);
      if (error) throw error;

      const { error: objectError } = await supabase.storage
        .from(SUPPORT_ATTACHMENTS_BUCKET)
        .remove([path]);

      // A linha já saiu: o anexo sumiu para quem olha. Um arquivo órfão não
      // justifica dizer ao master que a remoção falhou.
      if (objectError) {
        console.warn("[support] anexo removido da tabela, objeto ficou no bucket", objectError);
      }
    },
    onSuccess: (_r, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: [KEY, ticketId] });
    },
  });
}

/**
 * Sobe a fila de arquivos de uma mensagem e devolve os que falharam.
 *
 * Um anexo que não sobe **não** desfaz a mensagem nem o Chamado: eles são o
 * pedido de ajuda, o arquivo apenas o ilustrava (ADR-0022, 2).
 */
export async function uploadAll(
  upload: (input: UploadAttachmentInput) => Promise<unknown>,
  files: File[],
  base: Omit<UploadAttachmentInput, "file">,
): Promise<string[]> {
  const falhas: string[] = [];
  for (const file of files) {
    try {
      await upload({ ...base, file });
    } catch {
      falhas.push(file.name);
    }
  }
  return falhas;
}
