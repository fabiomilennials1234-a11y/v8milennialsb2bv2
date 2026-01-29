-- Add email column to team_members for Cal.com organizer matching
ALTER TABLE public.team_members 
ADD COLUMN IF NOT EXISTS email TEXT;

-- Create index for faster email lookups
CREATE INDEX IF NOT EXISTS idx_team_members_email ON public.team_members(email);

-- Add a comment explaining the purpose
COMMENT ON COLUMN public.team_members.email IS 'Email do membro da equipe para matching com organizador do Cal.com';