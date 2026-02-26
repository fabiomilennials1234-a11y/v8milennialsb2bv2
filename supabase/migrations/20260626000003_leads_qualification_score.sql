-- Item #14: Score progressivo de qualificação
-- Coluna na tabela leads para rastrear progresso de qualificação (0–100)

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS qualification_score integer DEFAULT 0
    CHECK (qualification_score >= 0 AND qualification_score <= 100);

COMMENT ON COLUMN leads.qualification_score IS
  'Score de qualificação de 0 a 100, atualizado pelo copilot conforme coleta informações do lead.';

-- Índice para filtrar leads por score (ranking, relatórios)
CREATE INDEX IF NOT EXISTS idx_leads_qualification_score
  ON leads (qualification_score DESC)
  WHERE qualification_score > 0;
