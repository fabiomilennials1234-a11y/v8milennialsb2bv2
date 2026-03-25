import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";

// ============================================
// Types
// ============================================

export type CampaignTemplateMessageType = "text" | "audio" | "image" | "document";

export interface CampaignTemplate {
  id: string;
  organization_id: string;
  name: string;
  content: string;
  message_type?: CampaignTemplateMessageType;
  audio_url?: string | null;
  image_url?: string | null;
  document_url?: string | null;
  file_name?: string | null;
  available_variables: string[];
  times_used: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CampaignTemplateInsert {
  name: string;
  content: string;
  message_type?: CampaignTemplateMessageType;
  audio_url?: string | null;
  image_url?: string | null;
  document_url?: string | null;
  file_name?: string | null;
  available_variables?: string[];
}

export interface CampanhaTemplate {
  id: string;
  campanha_id: string;
  template_id: string;
  position: number;
  created_at: string;
  template?: CampaignTemplate;
}

export interface DispatchBatch {
  id: string;
  organization_id: string;
  campanha_id: string;
  template_id: string;
  scheduled_at: string;
  status: 'scheduled' | 'processing' | 'completed' | 'failed' | 'cancelled';
  lead_filter: LeadFilter | null;
  total_leads: number;
  sent_count: number;
  failed_count: number;
  created_by: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  template?: CampaignTemplate;
}

export interface LeadFilter {
  stage_ids?: string[];
  sdr_ids?: string[];
  has_phone?: boolean;
  exclude_contacted?: boolean;
}

export interface DispatchBatchInsert {
  campanha_id: string;
  template_id: string;
  scheduled_at: string;
  lead_filter?: LeadFilter | null;
}

// Variáveis disponíveis para templates
export const TEMPLATE_VARIABLES = [
  { key: 'nome', label: 'Nome do Lead', example: 'João Silva' },
  { key: 'empresa', label: 'Empresa', example: 'Acme Corp' },
  { key: 'email', label: 'Email', example: 'joao@acme.com' },
  { key: 'telefone', label: 'Telefone', example: '11999998888' },
  { key: 'origem', label: 'Origem', example: 'Meta Ads' },
  { key: 'segmento', label: 'Segmento', example: 'Tecnologia' },
  { key: 'faturamento', label: 'Faturamento', example: 'R$100 mil' },
  { key: 'saudacao', label: 'Saudação (Bom dia / Boa tarde / Boa noite)', example: 'Bom dia' },
  { key: 'data', label: 'Data atual (dd/mm/aaaa)', example: '30/01/2026' },
  { key: 'hora', label: 'Hora atual', example: '14:30' },
] as const;

/** Retorna saudação, data e hora no fuso do Brasil (preview/envio) */
export function getTimeBasedVariables(now: Date = new Date()): { saudacao: string; data: string; hora: string } {
  const tz = 'America/Sao_Paulo';
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(now),
    10,
  );
  let saudacao = 'Bom dia';
  if (hour >= 12 && hour < 18) saudacao = 'Boa tarde';
  else if (hour >= 18 || hour < 5) saudacao = 'Boa noite';
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(now);
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  return { saudacao, data, hora };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Faz upload de áudio de template de campanha para o Storage e retorna URL pública
 */
export async function uploadCampaignTemplateAudio(
  blob: Blob,
  organizationId: string
): Promise<string> {
  const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("webm") ? "webm" : "mp4";
  const path = `campaign-templates/${organizationId}/${crypto.randomUUID()}.${ext}`;

  const { data, error } = await supabase.storage.from("media").upload(path, blob, {
    contentType: blob.type || "audio/ogg",
    upsert: false,
  });

  if (error) throw new Error(`Erro ao enviar áudio: ${error.message}`);

  const { data: urlData } = supabase.storage.from("media").getPublicUrl(data.path);
  if (!urlData?.publicUrl) throw new Error("Erro ao obter URL do áudio");
  return urlData.publicUrl;
}

/**
 * Faz upload de imagem de template de campanha para o Storage e retorna URL pública
 */
export async function uploadCampaignTemplateImage(
  file: File | Blob,
  organizationId: string
): Promise<string> {
  const ext = file instanceof File
    ? file.name.split(".").pop() || "jpg"
    : file.type.includes("png") ? "png" : file.type.includes("webp") ? "webp" : "jpg";
  const path = `campaign-templates/${organizationId}/images/${crypto.randomUUID()}.${ext}`;

  const { data, error } = await supabase.storage.from("media").upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });

  if (error) throw new Error(`Erro ao enviar imagem: ${error.message}`);

  const { data: urlData } = supabase.storage.from("media").getPublicUrl(data.path);
  if (!urlData?.publicUrl) throw new Error("Erro ao obter URL da imagem");
  return urlData.publicUrl;
}

/**
 * Faz upload de documento de template de campanha para o Storage e retorna URL pública
 */
export async function uploadCampaignTemplateDocument(
  file: File,
  organizationId: string
): Promise<string> {
  const ext = file.name.split(".").pop() || "pdf";
  const path = `campaign-templates/${organizationId}/documents/${crypto.randomUUID()}.${ext}`;

  const { data, error } = await supabase.storage.from("media").upload(path, file, {
    contentType: file.type || "application/pdf",
    upsert: false,
  });

  if (error) throw new Error(`Erro ao enviar documento: ${error.message}`);

  const { data: urlData } = supabase.storage.from("media").getPublicUrl(data.path);
  if (!urlData?.publicUrl) throw new Error("Erro ao obter URL do documento");
  return urlData.publicUrl;
}

/**
 * Substitui variáveis no template com valores de exemplo (inclui saudação/data/hora atuais na preview)
 */
export function replaceVariablesWithExamples(content: string): string {
  let result = content;
  const timeVars = getTimeBasedVariables();
  for (const variable of TEMPLATE_VARIABLES) {
    const value =
      variable.key === 'saudacao' ? timeVars.saudacao
      : variable.key === 'data' ? timeVars.data
      : variable.key === 'hora' ? timeVars.hora
      : variable.example;
    result = result.replace(new RegExp(`\\{${variable.key}\\}`, 'gi'), value);
  }
  return result;
}

/**
 * Substitui variáveis no template com dados do lead + saudação/data/hora atuais
 */
export function replaceVariablesWithLeadData(
  content: string,
  lead: {
    name?: string;
    company?: string;
    email?: string;
    phone?: string;
    origin?: string;
    segment?: string;
    faturamento?: string;
  }
): string {
  const time = getTimeBasedVariables();
  return content
    .replace(/\{nome\}/gi, lead.name || '')
    .replace(/\{empresa\}/gi, lead.company || '')
    .replace(/\{email\}/gi, lead.email || '')
    .replace(/\{telefone\}/gi, lead.phone || '')
    .replace(/\{origem\}/gi, lead.origin || '')
    .replace(/\{segmento\}/gi, lead.segment || '')
    .replace(/\{faturamento\}/gi, lead.faturamento || '')
    .replace(/\{saudacao\}/gi, time.saudacao)
    .replace(/\{data\}/gi, time.data)
    .replace(/\{hora\}/gi, time.hora);
}

// ============================================
// Hooks - Templates da Organização
// ============================================

/**
 * Lista todos os templates ativos da organização atual (isolado por organização)
 */
export function useCampaignTemplates() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["campaign_templates", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("campaign_templates")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as CampaignTemplate[];
    },
    enabled: isReady && !!organizationId,
  });
}

/**
 * Busca um template específico da organização atual (isolado por organização)
 */
export function useCampaignTemplate(id: string | undefined) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["campaign_template", id, organizationId],
    queryFn: async () => {
      if (!id || !organizationId) return null;

      const { data, error } = await supabase
        .from("campaign_templates")
        .select("*")
        .eq("id", id)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (error) throw error;
      return data as CampaignTemplate | null;
    },
    enabled: isReady && !!organizationId && !!id,
  });
}

/**
 * Cria um novo template na organização atual (sempre vinculado à org do usuário)
 */
export function useCreateCampaignTemplate() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (template: CampaignTemplateInsert) => {
      if (!organizationId) throw new Error("Organização não disponível");

      const { data, error } = await supabase
        .from("campaign_templates")
        .insert({
          ...template,
          organization_id: organizationId,
          available_variables: template.available_variables || TEMPLATE_VARIABLES.map(v => v.key),
        })
        .select()
        .single();

      if (error) {
        console.error("Erro ao criar template:", error);
        throw new Error(error.message || "Erro ao criar template");
      }

      if (!data) {
        throw new Error("Não foi possível criar o template. Verifique suas permissões.");
      }

      return data as CampaignTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign_templates"] });
    },
    onError: (error: Error) => {
      console.error("Mutation error:", error);
    },
  });
}

/**
 * Atualiza um template (apenas da organização atual)
 */
export function useUpdateCampaignTemplate() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<CampaignTemplate> & { id: string }) => {
      if (!organizationId) throw new Error("Organização não disponível");

      const { data, error } = await supabase
        .from("campaign_templates")
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select()
        .single();

      if (error) throw error;
      return data as CampaignTemplate;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campaign_templates"] });
      queryClient.invalidateQueries({ queryKey: ["campaign_template", variables.id] });
    },
  });
}

/**
 * Deleta um template (soft delete via is_active = false), apenas da organização atual
 */
export function useDeleteCampaignTemplate() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!organizationId) throw new Error("Organização não disponível");

      const { error } = await supabase
        .from("campaign_templates")
        .update({ is_active: false })
        .eq("id", id)
        .eq("organization_id", organizationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign_templates"] });
    },
  });
}

// ============================================
// Hooks - Templates de uma Campanha
// ============================================

/**
 * Lista templates vinculados a uma campanha
 */
export function useCampanhaTemplates(campanhaId: string | undefined) {
  return useQuery({
    queryKey: ["campanha_templates", campanhaId],
    queryFn: async () => {
      if (!campanhaId) return [];

      const { data, error } = await supabase
        .from("campanha_templates")
        .select(`
          *,
          template:campaign_templates(*)
        `)
        .eq("campanha_id", campanhaId)
        .order("position", { ascending: true });

      if (error) throw error;
      return data as CampanhaTemplate[];
    },
    enabled: !!campanhaId,
  });
}

/**
 * Adiciona um template a uma campanha
 */
export function useAddTemplateToCampanha() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ campanha_id, template_id, position }: { campanha_id: string; template_id: string; position?: number }) => {
      const { data, error } = await supabase
        .from("campanha_templates")
        .insert({
          campanha_id,
          template_id,
          position: position ?? 0,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_templates", variables.campanha_id] });
    },
  });
}

/**
 * Remove um template de uma campanha
 */
export function useRemoveTemplateFromCampanha() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, campanha_id }: { id: string; campanha_id: string }) => {
      const { error } = await supabase
        .from("campanha_templates")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campanha_templates", variables.campanha_id] });
    },
  });
}

// ============================================
// Hooks - Dispatch Batches (Lotes de Disparo)
// ============================================

/**
 * Lista lotes de disparo de uma campanha (apenas da organização atual)
 */
export function useDispatchBatches(campanhaId: string | undefined) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["dispatch_batches", campanhaId, organizationId],
    queryFn: async () => {
      if (!campanhaId || !organizationId) return [];

      const { data, error } = await supabase
        .from("campaign_dispatch_batches")
        .select(`
          *,
          template:campaign_templates(id, name, content)
        `)
        .eq("campanha_id", campanhaId)
        .eq("organization_id", organizationId)
        .order("scheduled_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as DispatchBatch[];
    },
    enabled: isReady && !!organizationId && !!campanhaId,
  });
}

/**
 * Cria um lote de disparo agendado (sempre na organização atual)
 */
export function useCreateDispatchBatch() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (batch: DispatchBatchInsert & { total_leads?: number }) => {
      if (!organizationId) throw new Error("Organização não disponível");

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data, error } = await supabase
        .from("campaign_dispatch_batches")
        .insert({
          ...batch,
          organization_id: organizationId,
          created_by: user.id,
          total_leads: batch.total_leads || 0,
        })
        .select()
        .single();

      if (error) throw error;
      return data as DispatchBatch;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["dispatch_batches", variables.campanha_id] });
    },
  });
}

/**
 * Cancela um lote de disparo agendado (apenas da organização atual)
 */
export function useCancelDispatchBatch() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, campanha_id }: { id: string; campanha_id: string }) => {
      if (!organizationId) throw new Error("Organização não disponível");

      const { data, error } = await supabase
        .from("campaign_dispatch_batches")
        .update({ status: 'cancelled' })
        .eq("id", id)
        .eq("organization_id", organizationId)
        .eq("status", 'scheduled')
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["dispatch_batches", variables.campanha_id] });
    },
  });
}

// ============================================
// Hooks - Dispatch Log (Histórico de Envios)
// ============================================

/**
 * Lista histórico de disparos de uma campanha (apenas da organização atual)
 */
export function useDispatchLog(campanhaId: string | undefined, limit: number = 50) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["dispatch_log", campanhaId, organizationId, limit],
    queryFn: async () => {
      if (!campanhaId || !organizationId) return [];

      const { data, error } = await supabase
        .from("outbound_dispatch_log")
        .select(`
          *,
          lead:leads(id, name, company, phone)
        `)
        .eq("campanha_id", campanhaId)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data ?? [];
    },
    enabled: isReady && !!organizationId && !!campanhaId,
  });
}

/**
 * Estatísticas de disparo de uma campanha (apenas da organização atual)
 */
export function useDispatchStats(campanhaId: string | undefined) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["dispatch_stats", campanhaId, organizationId],
    queryFn: async () => {
      if (!campanhaId || !organizationId) return { pending: 0, sent: 0, failed: 0, total: 0 };

      const { data, error } = await supabase
        .from("outbound_dispatch_log")
        .select("status")
        .eq("campanha_id", campanhaId)
        .eq("organization_id", organizationId);

      if (error) throw error;

      const stats = {
        pending: 0,
        sent: 0,
        failed: 0,
        cancelled: 0,
        total: data?.length || 0,
      };

      data?.forEach(item => {
        if (item.status === 'pending') stats.pending++;
        else if (item.status === 'sent') stats.sent++;
        else if (item.status === 'failed') stats.failed++;
        else if (item.status === 'cancelled') stats.cancelled++;
      });

      return stats;
    },
    enabled: isReady && !!organizationId && !!campanhaId,
  });
}
