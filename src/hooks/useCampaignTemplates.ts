import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ============================================
// Types
// ============================================

export type CampaignTemplateMessageType = "text" | "audio";

export interface CampaignTemplate {
  id: string;
  organization_id: string;
  name: string;
  content: string;
  message_type?: CampaignTemplateMessageType;
  audio_url?: string | null;
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
] as const;

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
 * Substitui variáveis no template com valores de exemplo
 */
export function replaceVariablesWithExamples(content: string): string {
  let result = content;
  for (const variable of TEMPLATE_VARIABLES) {
    result = result.replace(new RegExp(`\\{${variable.key}\\}`, 'g'), variable.example);
  }
  return result;
}

/**
 * Substitui variáveis no template com dados do lead
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
  return content
    .replace(/\{nome\}/g, lead.name || '')
    .replace(/\{empresa\}/g, lead.company || '')
    .replace(/\{email\}/g, lead.email || '')
    .replace(/\{telefone\}/g, lead.phone || '')
    .replace(/\{origem\}/g, lead.origin || '')
    .replace(/\{segmento\}/g, lead.segment || '')
    .replace(/\{faturamento\}/g, lead.faturamento || '');
}

// ============================================
// Hooks - Templates da Organização
// ============================================

/**
 * Lista todos os templates ativos da organização
 */
export function useCampaignTemplates() {
  return useQuery({
    queryKey: ["campaign_templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_templates")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as CampaignTemplate[];
    },
  });
}

/**
 * Busca um template específico
 */
export function useCampaignTemplate(id: string | undefined) {
  return useQuery({
    queryKey: ["campaign_template", id],
    queryFn: async () => {
      if (!id) return null;

      const { data, error } = await supabase
        .from("campaign_templates")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      return data as CampaignTemplate;
    },
    enabled: !!id,
  });
}

/**
 * Cria um novo template
 */
export function useCreateCampaignTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (template: CampaignTemplateInsert) => {
      // Buscar organization_id do usuário
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: teamMember } = await supabase
        .from("team_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .single();

      if (!teamMember) throw new Error("Usuário não pertence a uma organização");

      const { data, error } = await supabase
        .from("campaign_templates")
        .insert({
          ...template,
          organization_id: teamMember.organization_id,
          available_variables: template.available_variables || TEMPLATE_VARIABLES.map(v => v.key),
        })
        .select()
        .single();

      if (error) {
        console.error("Erro ao criar template:", error);
        throw new Error(error.message || "Erro ao criar template");
      }
      
      // Verificar se o template foi realmente criado (RLS pode bloquear silenciosamente)
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
 * Atualiza um template
 */
export function useUpdateCampaignTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<CampaignTemplate> & { id: string }) => {
      const { data, error } = await supabase
        .from("campaign_templates")
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
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
 * Deleta um template (soft delete via is_active = false)
 */
export function useDeleteCampaignTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("campaign_templates")
        .update({ is_active: false })
        .eq("id", id);

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
 * Lista lotes de disparo de uma campanha
 */
export function useDispatchBatches(campanhaId: string | undefined) {
  return useQuery({
    queryKey: ["dispatch_batches", campanhaId],
    queryFn: async () => {
      if (!campanhaId) return [];

      const { data, error } = await supabase
        .from("campaign_dispatch_batches")
        .select(`
          *,
          template:campaign_templates(id, name, content)
        `)
        .eq("campanha_id", campanhaId)
        .order("scheduled_at", { ascending: false });

      if (error) throw error;
      return data as DispatchBatch[];
    },
    enabled: !!campanhaId,
  });
}

/**
 * Cria um lote de disparo agendado
 */
export function useCreateDispatchBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (batch: DispatchBatchInsert & { total_leads?: number }) => {
      // Buscar organization_id e user_id
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: teamMember } = await supabase
        .from("team_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .single();

      if (!teamMember) throw new Error("Usuário não pertence a uma organização");

      const { data, error } = await supabase
        .from("campaign_dispatch_batches")
        .insert({
          ...batch,
          organization_id: teamMember.organization_id,
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
 * Cancela um lote de disparo agendado
 */
export function useCancelDispatchBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, campanha_id }: { id: string; campanha_id: string }) => {
      const { data, error } = await supabase
        .from("campaign_dispatch_batches")
        .update({ status: 'cancelled' })
        .eq("id", id)
        .eq("status", 'scheduled') // Só pode cancelar se ainda está agendado
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
 * Lista histórico de disparos de uma campanha
 */
export function useDispatchLog(campanhaId: string | undefined, limit: number = 50) {
  return useQuery({
    queryKey: ["dispatch_log", campanhaId, limit],
    queryFn: async () => {
      if (!campanhaId) return [];

      const { data, error } = await supabase
        .from("outbound_dispatch_log")
        .select(`
          *,
          lead:leads(id, name, company, phone)
        `)
        .eq("campanha_id", campanhaId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data;
    },
    enabled: !!campanhaId,
  });
}

/**
 * Estatísticas de disparo de uma campanha
 */
export function useDispatchStats(campanhaId: string | undefined) {
  return useQuery({
    queryKey: ["dispatch_stats", campanhaId],
    queryFn: async () => {
      if (!campanhaId) return { pending: 0, sent: 0, failed: 0, total: 0 };

      const { data, error } = await supabase
        .from("outbound_dispatch_log")
        .select("status")
        .eq("campanha_id", campanhaId);

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
    enabled: !!campanhaId,
  });
}
