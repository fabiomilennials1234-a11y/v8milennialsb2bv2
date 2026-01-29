-- Create table for multiple products per proposal
CREATE TABLE public.pipe_proposta_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pipe_proposta_id UUID NOT NULL REFERENCES public.pipe_propostas(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  sale_value NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.pipe_proposta_items ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Pipe proposta items visíveis para autenticados"
ON public.pipe_proposta_items
FOR SELECT
USING (is_team_member(auth.uid()));

CREATE POLICY "Team members podem gerenciar pipe proposta items"
ON public.pipe_proposta_items
FOR ALL
USING (is_team_member(auth.uid()));

-- Add index for performance
CREATE INDEX idx_pipe_proposta_items_proposta_id ON public.pipe_proposta_items(pipe_proposta_id);

-- Migrate existing data: create items from existing product_id/sale_value
INSERT INTO public.pipe_proposta_items (pipe_proposta_id, product_id, sale_value)
SELECT id, product_id, sale_value
FROM public.pipe_propostas
WHERE product_id IS NOT NULL;

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.pipe_proposta_items;