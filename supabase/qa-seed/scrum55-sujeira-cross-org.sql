-- ============================================================================
-- SCRUM-55 — a sujeira cross-org, em transação PRÓPRIA.
--
-- Arquivo separado por necessidade: `ALTER TABLE ... DISABLE TRIGGER` recusa
-- rodar quando a transação já tem evento de gatilho pendente, e o auto-seed de
-- Negócio é um CONSTRAINT TRIGGER DEFERRABLE — ou seja, a fixture anterior
-- deixa eventos na fila até o COMMIT. Dois arquivos, duas transações.
--
-- A trava do M6 já está no ar e recusa este INSERT — o que é a prova de que
-- ela funciona. A sujeira precisa nascer como nasceu em produção: ANTES da
-- trava (import cross-org em maio, trava escrita em julho).
-- ============================================================================

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

ALTER TABLE public.leads DISABLE TRIGGER trg_assert_member_same_org_leads;

INSERT INTO public.leads (id, organization_id, name, origin,
                          responsible_id, sdr_id, pre_sale_responsible_id, sale_responsible_id)
VALUES ('55dd0000-0000-0000-0000-0000000000bb', '55b00000-0000-0000-0000-0000000000bb',
        'Lead sujo da B', 'outro',
        '55111111-0000-0000-0000-0000000000aa', '55111111-0000-0000-0000-0000000000aa',
        '55111111-0000-0000-0000-0000000000aa', '55111111-0000-0000-0000-0000000000aa')
ON CONFLICT (id) DO NOTHING;

-- Força os gatilhos DEFERRABLE a dispararem AGORA. Sem isto, o `ENABLE` abaixo
-- esbarra em "pending trigger events": o auto-seed de Negócio é CONSTRAINT
-- TRIGGER DEFERRABLE INITIALLY DEFERRED e só rodaria no COMMIT, depois do
-- ALTER. É também o gatilho cuja decisão a prova H3-05 mede.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE public.leads ENABLE TRIGGER trg_assert_member_same_org_leads;


-- Força os gatilhos DEFERRABLE a dispararem AGORA. Sem isto, o `ENABLE` abaixo
-- esbarra em "pending trigger events": o auto-seed de Negócio é CONSTRAINT
-- TRIGGER DEFERRABLE INITIALLY DEFERRED e só rodaria no COMMIT, depois do
-- ALTER. É também o gatilho cuja decisão a prova H3-05 mede.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE public.leads ENABLE TRIGGER trg_assert_member_same_org_leads;

SELECT 'sujeira semeada' AS etapa;
