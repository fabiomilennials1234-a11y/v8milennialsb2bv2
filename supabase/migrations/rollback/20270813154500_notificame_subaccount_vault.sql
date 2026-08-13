-- Rollback de 20270813154500_notificame_subaccount_vault.sql
--
-- ⚠️ DESTRUTIVO DE UM JEITO QUE O ROLLBACK DA FUNDAÇÃO NÃO É. Leia inteiro.
--
-- ORDEM: este é o SEGUNDO rollback a rodar. O apply é cofre (…154500) → fundação
-- (…154600); o desfazer é o inverso — rode
-- `rollback/20270813154600_notificame_channel_foundation.sql` ANTES deste. Rodar na
-- ordem errada deixa a flag ligada e o canal insertável apontando para um cofre que
-- não existe mais.
--
-- Derrubar `notificame_subaccounts` APAGA os tokens (CompanyId cifrado) de todas
-- as subcontas provisionadas. As subcontas CONTINUAM VIVAS e faturáveis no
-- fornecedor — este arquivo não fala com a NotificaMe. E como o token é o único
-- caminho de acesso à subconta (a senha gerada no provisionamento é aleatória e
-- NÃO é armazenada, de propósito), apagar esta tabela é perder o acesso
-- operacional a contas que seguem existindo e sendo cobradas.
--
-- ANTES DE RODAR, EXPORTE A TRILHA — INCLUSIVE AS LINHAS DESANEXADAS:
--
--   SELECT organization_id, detached_organization_id, detached_at,
--          vendor_email, status, provisioned_at
--     FROM public.notificame_subaccounts;
--
-- `organization_id IS NULL` NÃO significa linha descartável: significa que a org
-- foi apagada e a subconta CONTINUA VIVA E FATURADA no fornecedor. Essas são
-- justamente as que ninguém mais consegue reconstruir — a org que as gerou não
-- existe para ser consultada. `detached_organization_id` e `vendor_email` são tudo
-- o que resta delas.
--
-- PROCEDIMENTO DE RECUPERAÇÃO, se rodar mesmo assim:
--   1. `GET /v1/resale/` com o `X-Api-Token` da CONTA-MÃE (secret
--      NOTIFICAME_API_TOKEN) lista as subcontas da revenda;
--   2. cada item traz `acccount_id` — que É o token daquela subconta (provado:
--      idêntico, byte-a-byte, ao CompanyId devolvido por POST /v2/accounts);
--   3. reconcilie subconta ↔ org pelo EMAIL: ele é determinístico,
--      `torque-<organization_id>@<dominio>`. É a única trilha que sobrevive à
--      perda desta tabela — daí `vendor_email` ser guardado em claro.
--   4. re-provisionar do zero NÃO é opção: criaria uma SEGUNDA subconta
--      irremovível por org, e a UNIQUE(organization_id) impede reconciliar
--      depois sem intervenção manual.
--
-- CAMINHO PREFERÍVEL a rodar isto: deixar as duas tabelas de pé. Sem quem escreva
-- (as edge functions notificame-*) elas são inertes, custam nada e preservam a
-- trilha. Rollback de código não exige rollback de cofre.
--
-- As sessões de conexão, ao contrário, são descartáveis: são efêmeras (TTL de
-- minutos) e nada além do fluxo de conexão as lê. Nenhum dado a preservar.

-- 1. Sessões primeiro (nada depende delas).
DROP TABLE IF EXISTS public.notificame_connect_sessions;

-- 2. O cofre. Ponto de não-retorno descrito acima.
DROP TABLE IF EXISTS public.notificame_subaccounts;

-- 3. A função do trigger de trilha. O DROP TABLE leva o TRIGGER junto, mas não a
--    FUNCTION — sem esta linha o rollback deixa órfã uma função que referencia
--    colunas de uma tabela que não existe mais.
DROP FUNCTION IF EXISTS public.notificame_subaccount_stamp_detach();
