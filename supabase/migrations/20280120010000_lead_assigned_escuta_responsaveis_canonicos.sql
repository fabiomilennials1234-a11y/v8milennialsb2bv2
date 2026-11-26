-- Gatilho `lead_assigned` passa a enxergar a troca de responsável feita pela tela.
--
-- O defeito: `trg_workflow_lead_assigned` era `AFTER UPDATE OF sdr_id, closer_id`.
-- A tela (ResponsibleSlot → useUpdateLead) grava só as colunas canônicas
-- `pre_sale_responsible_id` / `sale_responsible_id`; o espelho para sdr_id/closer_id
-- é feito pelo BEFORE trigger `trg_leads_sync_canonical_assignment`. Gatilho por
-- coluna só dispara para colunas citadas no SET do comando — mudança feita por um
-- BEFORE trigger não conta (manual do PostgreSQL, CREATE TRIGGER). Resultado: toda
-- troca manual de responsável era invisível para automações `lead_assigned`;
-- só escritas que citavam as colunas legadas (API/n8n) disparavam.
--
-- Medido em prod 18/11/2026: UPDATE de sale_responsible_id num lead da JR Tex
-- espelhou closer_id e não criou execução no workflow cc17dd37.
--
-- A função `trigger_workflow_lead_assigned` não muda: ela compara NEW/OLD de
-- sdr_id/closer_id, que já chegam espelhados pelo BEFORE trigger. Só a lista de
-- colunas do gatilho cresce. Um UPDATE que troca os dois papéis continua gerando
-- um único disparo (a função escolhe 'sdr' primeiro).
--
-- Efeito em outras orgs: em 18/11/2026 só dois workflows usam lead_assigned —
-- JR Tex "Avisar representante do lead" e Sorvfoods "Sequencia de boas-vindas
-- (copia)". A partir daqui, troca manual de responsável também os dispara.
-- Decisão do CTO, ciente do efeito na Sorvfoods.

-- CREATE OR REPLACE (PG14+): troca a definição numa operação só, sem janela sem gatilho.
CREATE OR REPLACE TRIGGER trg_workflow_lead_assigned
  AFTER UPDATE OF sdr_id, closer_id, pre_sale_responsible_id, sale_responsible_id
  ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_lead_assigned();
