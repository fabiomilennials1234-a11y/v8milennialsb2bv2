-- Adiciona coluna pipe_whatsapp na tabela leads para rastrear estágio no funil WhatsApp
-- Estágios: novo → abordado → respondeu → esfriou/agendado

-- Adicionar coluna pipe_whatsapp usando o enum existente
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS pipe_whatsapp pipe_whatsapp_status DEFAULT 'novo';

-- Criar índice para consultas por estágio
CREATE INDEX IF NOT EXISTS idx_leads_pipe_whatsapp 
ON public.leads(pipe_whatsapp) 
WHERE pipe_whatsapp IS NOT NULL;

-- Criar índice composto para Kanban (org + funil)
CREATE INDEX IF NOT EXISTS idx_leads_org_pipe_whatsapp 
ON public.leads(organization_id, pipe_whatsapp) 
WHERE pipe_whatsapp IS NOT NULL;

-- Comentário explicativo
COMMENT ON COLUMN public.leads.pipe_whatsapp IS 'Estágio do lead no funil de qualificação via WhatsApp: novo, abordado, respondeu, esfriou, agendado';
