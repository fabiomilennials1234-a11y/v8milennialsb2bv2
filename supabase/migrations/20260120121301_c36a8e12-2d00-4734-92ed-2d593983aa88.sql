-- Create products table
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('mrr', 'projeto')),
  ticket NUMERIC,
  ticket_minimo NUMERIC,
  entregaveis TEXT,
  materiais TEXT,
  links TEXT[],
  logo_url TEXT,
  contrato_padrao_url TEXT,
  contrato_minimo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Products visíveis para autenticados" 
ON public.products 
FOR SELECT 
USING (is_team_member(auth.uid()));

CREATE POLICY "Apenas admins podem gerenciar products" 
ON public.products 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add product_id to goals table
ALTER TABLE public.goals ADD COLUMN product_id UUID REFERENCES public.products(id);

-- Add product_id to pipe_propostas table
ALTER TABLE public.pipe_propostas ADD COLUMN product_id UUID REFERENCES public.products(id);

-- Create trigger for updated_at
CREATE TRIGGER update_products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- Insert default product "Milennials Team"
INSERT INTO public.products (name, type, ticket, ticket_minimo, entregaveis)
VALUES ('Milennials Team', 'mrr', 0, 0, 'Produto padrão para metas e propostas existentes');

-- Update existing goals to use the default product
UPDATE public.goals 
SET product_id = (SELECT id FROM public.products WHERE name = 'Milennials Team' LIMIT 1);

-- Update existing proposals to use the default product
UPDATE public.pipe_propostas 
SET product_id = (SELECT id FROM public.products WHERE name = 'Milennials Team' LIMIT 1);