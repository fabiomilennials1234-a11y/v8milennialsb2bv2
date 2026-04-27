-- Drop the existing policy that allows ALL operations for team members on leads
DROP POLICY IF EXISTS "Team members podem gerenciar leads" ON public.leads;

-- Create separate policies for leads
-- SELECT: All team members can view leads
CREATE POLICY "Team members podem ver leads" 
ON public.leads 
FOR SELECT 
USING (is_team_member(auth.uid()));

-- INSERT: All team members can create leads
CREATE POLICY "Team members podem criar leads" 
ON public.leads 
FOR INSERT 
WITH CHECK (is_team_member(auth.uid()));

-- UPDATE: All team members can update leads
CREATE POLICY "Team members podem atualizar leads" 
ON public.leads 
FOR UPDATE 
USING (is_team_member(auth.uid()));

-- DELETE: Only admins can delete leads
CREATE POLICY "Apenas admins podem excluir leads" 
ON public.leads 
FOR DELETE 
USING (has_role(auth.uid(), 'admin'::app_role));