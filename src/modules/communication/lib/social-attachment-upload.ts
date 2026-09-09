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
  /**
   * O MIME REAL do que subiu. Existe porque `type` ("audio") não distingue nota
   * de voz de áudio comum, e essa distinção decide um campo do envelope
   * (`voice`) que a Meta valida contra o codec do arquivo.
   */
  mime: string;
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
  canal: "instagram" | "whatsapp_oficial" = "instagram",
): Promise<UploadedAttachment> {
  // O Direct não aceita documento; o WhatsApp oficial aceita — e usa o MESMO
  // composer. Recusar antes do upload poupa o storage e devolve a razão na hora,
  // em vez da recusa muda do fornecedor (ou da Meta, por callback) depois.
  // WebP no canal oficial é FIGURINHA. É o formato exclusivo de figurinha do
  // WhatsApp — quem manda um .webp está mandando uma, e tratá-lo como imagem
  // comum entregaria um quadrado com fundo branco no lugar do que o vendedor
  // escolheu. No Instagram continua sendo imagem: lá figurinha não existe.
  const ehFigurinha = canal === "whatsapp_oficial" && /^image\/webp$/i.test(file.type);

  const check = classifyAttachment(file.type, file.name, file.size, {
    allowDocument: canal === "whatsapp_oficial",
    sticker: ehFigurinha,
    canal,
  });
  if (!check.ok) throw new Error(check.error);

  const seguro = file.name.replace(/[^\w.-]/g, "_").slice(-80) || "anexo";
  // A ORG VEM NO SEGUNDO SEGMENTO, e isso não é estética: a policy
  // `media_insert_org_scoped` do bucket lê exatamente `foldername(name)[2]` e exige
  // que seja uma org do usuário. Com `notificame/outbound/<org>/…` o segmento 2 era
  // "outbound", a regex de uuid não casava e TODO anexo do vendedor morria em
  // "new row violates row-level security policy" — invisível para quem testava como
  // master (a policy curto-circuita em `is_master_user()`) e para as edge functions
  // (service_role bypassa RLS). Mover o segmento é o que faz o upload existir.
  const path = `notificame/${organizationId}/outbound/${crypto.randomUUID()}-${seguro}`;

  const { error } = await supabase.storage.from("media").upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(`Falha ao publicar o arquivo: ${error.message}`);

  const { data } = supabase.storage.from("media").getPublicUrl(path);
  const url = data?.publicUrl;
  if (!url) throw new Error("O arquivo subiu mas não recebeu URL pública");

  return {
    url,
    type: check.type,
    filename: file.name,
    sizeBytes: file.size,
    mime: file.type || "application/octet-stream",
  };
}
