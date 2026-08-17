/**
 * Publicação do anexo do Direct.
 *
 * Arquivo SEPARADO da classificação de propósito: aquela é pura e testável sem
 * navegador nem rede; esta toca storage. Juntas, um `import` do cliente Supabase
 * arrastaria o ambiente do Vite para dentro do teste da regra.
 */
import { supabase } from "@/integrations/supabase/client";

import { classifyAttachment, type SocialAttachmentType } from "./social-attachment";

export interface UploadedAttachment {
  url: string;
  type: SocialAttachmentType;
  filename: string;
  sizeBytes: number;
}

/**
 * Publica o anexo e devolve a URL que o fornecedor vai buscar.
 *
 * O caminho carrega uuid — nome de arquivo do cliente não vira caminho
 * adivinhável, e dois anexos com o mesmo nome não se sobrescrevem.
 */
export async function uploadSocialAttachment(
  file: File,
  organizationId: string,
): Promise<UploadedAttachment> {
  // `allowDocument: false` porque este caminho é SÓ do Direct, e o canal não
  // aceita documento — recusar antes do upload poupa o storage e devolve a razão
  // na hora, em vez da recusa muda do fornecedor depois do envio.
  const check = classifyAttachment(file.type, file.name, file.size, { allowDocument: false });
  if (!check.ok) throw new Error(check.error);

  const seguro = file.name.replace(/[^\w.-]/g, "_").slice(-80) || "anexo";
  const path = `notificame/outbound/${organizationId}/${crypto.randomUUID()}-${seguro}`;

  const { error } = await supabase.storage.from("media").upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(`Falha ao publicar o arquivo: ${error.message}`);

  const { data } = supabase.storage.from("media").getPublicUrl(path);
  const url = data?.publicUrl;
  if (!url) throw new Error("O arquivo subiu mas não recebeu URL pública");

  return { url, type: check.type, filename: file.name, sizeBytes: file.size };
}
