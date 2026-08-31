-- ============================================================
-- Toth Flow — o serviço de PEDIDOS é outro servidor, não o /toth/services
-- ============================================================
--
-- 🔴 A descoberta que motiva esta migration: `/pedidos` NUNCA vai responder em
-- `http://cafejurere.ddns.net:8080/toth/services`. O fornecedor publicou o
-- endpoint em um serviço **separado** —
-- `http://cafejurere.ddns.net:3000/flow/crm` — com contrato próprio:
--
--   | | /toth/services (clientes, cobranças) | /flow/crm (pedidos) |
--   |---|---|---|
--   | login | `POST /users/login`, form | `POST /auth`, JSON |
--   | credencial | `user` + `password` | `client_id` + `client_secret` |
--   | resposta | `{login, user, token}` | `{success, data:"<JWT>", elapsed, count}` |
--   | token viaja | query string `?token=` | `Authorization: Bearer` |
--   | leitura | GET com query params | **POST com corpo JSON** |
--
-- São duas integrações com o mesmo cliente, não uma com dois caminhos. Por isso
-- endereço e credencial ganham colunas próprias em vez de reaproveitar as
-- existentes: apontar `base_url` para o :3000 quebraria clientes e cobranças, e
-- guardar `client_id` no lugar de `user` faria o login do Toth parar de existir.
--
-- O que NÃO ganha coluna própria: o aceite de tráfego sem TLS
-- (`allow_insecure_transport`). É a mesma máquina, a mesma rede e a mesma
-- decisão de risco do admin — dois aceites para o mesmo fato seriam duas
-- chances de divergir.
--
-- ⚠️ Antes de aplicar: LEIA O LEDGER DE PROD, não só este diretório. O guarda
-- `check-migration-versions.sh` compara repo × repo e não enxerga versão que
-- existe em prod sem arquivo aqui (aconteceu com `20270831000000`). Prefixo
-- ocupado faz `db push` pular esta migration em SILÊNCIO, com CI verde.

-- ── 1. Endereço do serviço de pedidos ────────────────────────────────────────

ALTER TABLE public.toth_connections
  ADD COLUMN IF NOT EXISTS flow_base_url TEXT,
  ADD COLUMN IF NOT EXISTS pedidos_janela_dias INTEGER,
  ADD COLUMN IF NOT EXISTS pedidos_data_inicial DATE;

-- Mesma forma da `base_url`, e mesma trava: http só com o aceite marcado.
-- `flow_base_url` é NULLABLE — org sem serviço de pedidos é o estado normal, e
-- o CHECK precisa deixar o NULL passar.
ALTER TABLE public.toth_connections
  DROP CONSTRAINT IF EXISTS toth_flow_base_url_forma;
ALTER TABLE public.toth_connections
  ADD CONSTRAINT toth_flow_base_url_forma
    CHECK (flow_base_url IS NULL OR flow_base_url ~ '^https?://[^[:space:]]+$');

ALTER TABLE public.toth_connections
  DROP CONSTRAINT IF EXISTS toth_flow_http_requires_explicit_optin;
ALTER TABLE public.toth_connections
  ADD CONSTRAINT toth_flow_http_requires_explicit_optin
    CHECK (
      flow_base_url IS NULL
      OR flow_base_url LIKE 'https://%'
      OR allow_insecure_transport
    );

COMMENT ON COLUMN public.toth_connections.flow_base_url IS
  'Base do serviço Flow do Toth (pedidos), ex.: http://host:3000/flow/crm. '
  'Serviço SEPARADO do /toth/services: outra porta, outra credencial '
  '(client_id/client_secret), token em Bearer e leitura por POST JSON. '
  'NULL = a org não tem o serviço de pedidos publicado.';

-- ── 2. Recorte temporal dos pedidos ──────────────────────────────────────────
--
-- `/flow/crm/pedidos` EXIGE janela: o corpo leva `dataInicial` e `dataFinal`.
-- Ao contrário de `/clientes`, não existe "traga tudo" — a chamada precisa
-- decidir um intervalo, e essa decisão é de configuração, não de código.
--
-- Duas colunas porque são duas perguntas diferentes:
--   - `pedidos_janela_dias`: o regime permanente. Quantos dias para trás cada
--     execução relê. Relê de propósito: pedido muda de situação (NORMAL vira
--     FATURADO) depois de emitido, e uma janela que só avança perderia a
--     virada.
--   - `pedidos_data_inicial`: o piso do backfill. Enquanto existir, manda sobre
--     a janela — é como se puxa o histórico uma vez sem que o regime permanente
--     passe a varrer anos todo dia.

COMMENT ON COLUMN public.toth_connections.pedidos_janela_dias IS
  'Dias para trás relidos a cada sincronização de pedidos. NULL = padrão do '
  'código (90). Releitura é intencional: pedido NORMAL vira FATURADO depois.';

COMMENT ON COLUMN public.toth_connections.pedidos_data_inicial IS
  'Piso do backfill de pedidos. Quando preenchida, vence pedidos_janela_dias — '
  'usada para puxar o histórico uma vez. Limpar volta ao regime da janela.';

-- ── 3. Credencial do Flow no cofre ───────────────────────────────────────────
--
-- Mesmo cofre, colunas novas: a tabela já é deny-all e já está atrelada à
-- conexão. Criar uma segunda tabela de segredo duplicaria RLS, grants e trigger
-- de updated_at para guardar o par de outro serviço do MESMO ERP.
--
-- NULLABLE porque a maioria das conexões não terá Flow — e porque a conexão
-- existente da Café Jurerê precisa continuar válida sem o par novo.

ALTER TABLE public.toth_connection_secrets
  ADD COLUMN IF NOT EXISTS flow_client_id_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS flow_client_id_nonce TEXT,
  ADD COLUMN IF NOT EXISTS flow_client_secret_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS flow_client_secret_nonce TEXT;

-- Meio par é pior que par nenhum: o carregador leria `client_id` sem
-- `client_secret` e tentaria autenticar com credencial incompleta, produzindo
-- uma falha de auth que parece senha errada.
ALTER TABLE public.toth_connection_secrets
  DROP CONSTRAINT IF EXISTS toth_flow_secret_par_completo;
ALTER TABLE public.toth_connection_secrets
  ADD CONSTRAINT toth_flow_secret_par_completo
    CHECK (
      num_nonnulls(
        flow_client_id_ciphertext,
        flow_client_id_nonce,
        flow_client_secret_ciphertext,
        flow_client_secret_nonce
      ) IN (0, 4)
    );

COMMENT ON COLUMN public.toth_connection_secrets.flow_client_id_ciphertext IS
  'client_id do serviço Flow (pedidos), AES-256-GCM. Par distinto do '
  'user/password do /toth/services — mesmo ERP, outro serviço, outra credencial.';

-- ── 4. Grants: o default do schema NÃO é o que você escreveu ────────────────
--
-- `ALTER DEFAULT PRIVILEGES` do projeto age sobre tudo que nasce em `public`, e
-- já entregou SELECT a `anon` numa tabela que a migration nunca mencionou
-- (medido em 27/08, `erp_order_items`). Aqui não há tabela nova, mas revogar é
-- barato e a leitura abaixo é o que prova o estado — não o SQL acima.

REVOKE ALL ON public.toth_connection_secrets FROM anon;
REVOKE ALL ON public.toth_connection_secrets FROM authenticated;
GRANT ALL ON public.toth_connection_secrets TO service_role;

-- Conferência (rodar DEPOIS do apply, não confiar no SQL acima):
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'toth_connection_secrets';
--   -- esperado: só service_role.
