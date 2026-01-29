import { supabase } from "@/integrations/supabase/client";

/**
 * Evolution API Client
 *
 * Este módulo faz chamadas para a Evolution API através de uma Edge Function proxy,
 * mantendo a API key segura no servidor.
 */

// Função auxiliar para fazer requisições via Edge Function
async function makeRequest<T>(
  endpoint: string,
  method: string = "GET",
  body?: Record<string, unknown>,
  operation: string = "Request"
): Promise<T> {
  console.log(`[Evolution API] ${operation}`, {
    endpoint,
    method,
    hasBody: !!body,
  });

  try {
    const { data, error } = await supabase.functions.invoke("evolution-api-proxy", {
      body: {
        endpoint,
        method,
        body,
      },
    });

    if (error) {
      console.error(`[Evolution API] ${operation} - Edge Function Error:`, error);
      throw new Error(error.message || "Erro ao conectar com o servidor");
    }

    // Se a resposta contém um erro da Evolution API
    if (data?.error) {
      console.error(`[Evolution API] ${operation} - API Error:`, data);
      const apiError = new Error(data.error);
      (apiError as any).status = data.status;
      (apiError as any).details = data.details;
      throw apiError;
    }

    console.log(`[Evolution API] ${operation} - Success`);
    return data as T;
  } catch (error: any) {
    // Re-throw se já é nosso erro formatado
    if (error.status) {
      throw error;
    }

    // Erro de rede ou outro
    console.error(`[Evolution API] ${operation} - Network Error:`, error);
    throw new Error(
      error.message || "Erro de conexão. Verifique sua internet e tente novamente."
    );
  }
}

export interface CreateInstanceResponse {
  instance: {
    instanceName: string;
    status?: string;
  };
  qrcode?: {
    code: string;
    base64?: string;
  };
}

export interface ConnectionStateResponse {
  instance: {
    instanceName: string;
    state: "open" | "close" | "connecting";
    status?: string;
  };
}

export interface QRCodeResponse {
  code: string;
  base64?: string;
}

export interface TestConnectionResponse {
  status: number;
  message: string;
  version?: string;
  working: boolean;
}

/**
 * Testa a conexão com a Evolution API
 */
export async function testEvolutionConnection(): Promise<TestConnectionResponse> {
  try {
    const data = await makeRequest<{ message?: string; version?: string }>(
      "",
      "GET",
      undefined,
      "Test Connection"
    );

    return {
      status: 200,
      message: data.message || "Conexão bem-sucedida com a Evolution API",
      version: data.version,
      working: true,
    };
  } catch (error: any) {
    console.error("[Evolution API] Test Connection Failed:", error);
    return {
      status: error.status || 0,
      message: error.message || "Falha ao conectar com a Evolution API",
      working: false,
    };
  }
}

/**
 * Cria uma nova instância WhatsApp na Evolution API
 */
export async function createEvolutionInstance(
  instanceName: string
): Promise<CreateInstanceResponse> {
  const data = await makeRequest<CreateInstanceResponse>(
    "/instance/create",
    "POST",
    {
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
    },
    "Create Instance"
  );

  console.log("[Evolution API] Create Instance - Response:", {
    instanceName: data.instance?.instanceName,
    hasQRCode: !!data.qrcode,
  });

  return data;
}

/**
 * Obtém o QR code de uma instância
 */
export async function getQRCode(instanceName: string): Promise<QRCodeResponse> {
  const data = await makeRequest<QRCodeResponse>(
    `/instance/connect/${instanceName}`,
    "GET",
    undefined,
    "Get QR Code"
  );

  console.log("[Evolution API] Get QR Code - Response:", {
    instanceName,
    hasQRCode: !!data.base64 || !!data.code,
  });

  return data;
}

/**
 * Verifica o status de conexão de uma instância
 */
export async function getConnectionState(
  instanceName: string
): Promise<ConnectionStateResponse> {
  const data = await makeRequest<ConnectionStateResponse>(
    `/instance/connectionState/${instanceName}`,
    "GET",
    undefined,
    "Get Connection State"
  );

  console.log("[Evolution API] Get Connection State - Response:", {
    instanceName,
    state: data.instance?.state,
  });

  return data;
}

/**
 * Deleta uma instância
 */
export async function deleteEvolutionInstance(instanceName: string): Promise<void> {
  await makeRequest<void>(
    `/instance/delete/${instanceName}`,
    "DELETE",
    undefined,
    "Delete Instance"
  );

  console.log("[Evolution API] Delete Instance - Success:", { instanceName });
}

/**
 * Faz logout de uma instância
 */
export async function logoutInstance(instanceName: string): Promise<void> {
  await makeRequest<void>(
    `/instance/logout/${instanceName}`,
    "DELETE",
    undefined,
    "Logout Instance"
  );

  console.log("[Evolution API] Logout Instance - Success:", { instanceName });
}

/**
 * Envia mensagem de texto via WhatsApp
 */
export async function sendTextMessage(
  instanceName: string,
  to: string,
  text: string
): Promise<{ key: { id: string } }> {
  const data = await makeRequest<{ key: { id: string } }>(
    `/message/sendText/${instanceName}`,
    "POST",
    {
      number: to,
      text,
    },
    "Send Text Message"
  );

  console.log("[Evolution API] Send Text Message - Success:", {
    instanceName,
    to,
    messageId: data.key?.id,
  });

  return data;
}

/**
 * Lista todas as instâncias
 */
export async function listInstances(): Promise<
  Array<{ instance: { instanceName: string; state: string } }>
> {
  const data = await makeRequest<
    Array<{ instance: { instanceName: string; state: string } }>
  >("/instance/fetchInstances", "GET", undefined, "List Instances");

  console.log("[Evolution API] List Instances - Success:", {
    count: data?.length || 0,
  });

  return data;
}

/**
 * Envia mídia (imagem, áudio, documento) via WhatsApp
 */
export async function sendMediaMessage(
  instanceName: string,
  to: string,
  mediaType: "image" | "audio" | "document" | "video",
  media: string, // base64 ou URL
  options?: {
    caption?: string;
    fileName?: string;
    mimetype?: string;
  }
): Promise<{ key: { id: string } }> {
  // Detectar se é base64 ou URL
  const isBase64 = media.startsWith("data:") || !media.startsWith("http");
  
  let endpoint: string;
  let body: Record<string, unknown>;

  if (mediaType === "audio") {
    // Para áudio, usar endpoint específico
    endpoint = `/message/sendWhatsAppAudio/${instanceName}`;
    body = {
      number: to,
      audio: media,
      encoding: isBase64,
    };
  } else {
    // Para imagem, documento, vídeo
    endpoint = `/message/sendMedia/${instanceName}`;
    body = {
      number: to,
      mediatype: mediaType,
      media,
      caption: options?.caption || "",
      fileName: options?.fileName,
      mimetype: options?.mimetype,
    };
  }

  const data = await makeRequest<{ key: { id: string } }>(
    endpoint,
    "POST",
    body,
    `Send ${mediaType} Message`
  );

  console.log(`[Evolution API] Send ${mediaType} Message - Success:`, {
    instanceName,
    to,
    messageId: data.key?.id,
  });

  return data;
}

/**
 * Faz upload de arquivo e retorna URL/base64
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
}
