# Homologação Clientes 360 — 2026-09-16

## Resultado

Aprovado no escopo da carteira e Cliente 360. Aplicação real conectada a uma branch Supabase descartável, com autenticação GoTrue, PostgREST, RLS e fluxo oficial de abertura de negócio. Dados exclusivamente sintéticos. Nenhuma escrita ou implantação em produção.

## Ambiente e encerramento

- Branch `qa-clientes-360`, ref `wlmpcwzurgvrttelcvyt`, ID `1c77490f-9612-4137-ba0f-fb6d2948a99c`, organização `rovcfbcyfmmrxadzovvf`.
- Custo confirmado antes da criação: US$ 0,01344/hora. Não é o valor da fatura final.
- Branch excluída após testes; inventário remoto confirmou ausência. Branches `condicional-guiado` e `copilot-v3-waves-0-2` preservadas.
- Servidor QA 5287 encerrado; credenciais e seed temporários removidos. Preview visual 5187 preservado.
- Checkout: `codex/leads-clientes-360`, base `eedb12dbd`. Sem merge/push em main.

## Preparação do banco

Branch iniciou sem tabelas públicas, apesar do ledger. Aplicados baseline completo e todas as 424 migrations posteriores ativas, seguidos da migration `20271021000014_client_portfolio_page`. Não foi usado somente o esquema mínimo dos testes locais.

CLI sem credencial de Management API: aplicação ocorreu pelo conector autenticado, sempre com ref explícita da branch. Baseline dividido em 12 lotes de instruções SQL completas por limite de payload. Crons desativados na branch.

Adaptações restritas ao provisionamento descartável, sem editar migrations históricas:

- Índices `CONCURRENTLY` executados sem essa opção, pois conector aplica dentro de transação e banco ainda não tinha tráfego/dados.
- `20260916163244` adiada até existir `from_pipeline_id`.
- Schema `backup` criado sem acesso a PUBLIC/anon/authenticated antes de `20260916164400`.
- Conflito de tipo de retorno de `get_conversations_awaiting_human_reply` resolvido recriando função e reaplicando definição posterior. Falhas de lote foram revertidas atomicamente.

Funções críticas de negócio, classificação e permissões comparadas com produção por leitura: definições equivalentes; `api_create_deal` diferia apenas em CRLF/LF. `get-member-permissions` implantada somente na branch.

## Casos remotos aprovados

| Área | Evidência |
| --- | --- |
| Autenticação | Login GoTrue real; chamadas anônimas rejeitadas |
| Organização | Admin de A obtém zero clientes consultando B |
| Atribuição | Membro restrito enxerga seu cliente; não enxerga clientes do admin nem receita deles |
| Recompra | Duas compras, intervalo de 28 dias; previsão 11/09 e atraso de 5 dias em 16/09 |
| Classificação | Ouro consistente; filtro global encontra cliente fora da primeira página |
| Paginação | 55 clientes, páginas de 50 + 5, sem repetição |
| Agregados | Receita mensal global R$ 530, igual entre páginas; membro restrito R$ 0 |
| Navegador real | Leads → Clientes → 360 → histórico completo → Novo negócio → Funil de Vendas |
| Persistência | Uma nova entrada no funil vinculada ao mesmo lead; total de clientes preservado em 55; reload conserva carteira e negócio |
| Reversão | RPC removida pelo rollback, ausência confirmada por catálogo; migration original reaplicada e API/UI revalidadas |

Autenticação do navegador usa sessão real obtida por GoTrue, inserida no storage normal do cliente Supabase. Não cobre digitação da tela de login. Sem mocks de API no fluxo remoto. Anúncios de suporte foram fechados pelos controles da interface.

## Defeitos encontrados e corrigidos

1. `useRealtimeChannel`: nome baseado em milissegundos colidia entre consumidores simultâneos/StrictMode; Supabase tentava adicionar callbacks em canal já inscrito e derrubava a página. Nome agora usa UUID. Teste cobre montagem simultânea e remontagem imediata.
2. Coluna “Próxima compra” usava `lastPurchaseAt`. Agora usa `nextPurchaseAt`, com fallback pelo ciclo. Teste reproduziu falha antes da correção; depois passou. Conferência no navegador confirma última compra 14/08 e previsão 11/09, coerente com 360.

## Verificação final e limites

- 79 testes passaram em 12 arquivos na execução final: carteira, compras, ciclo, diálogo de negócio e Realtime. Complementam os testes anteriores documentados em [clientes-360.md](clientes-360.md); contagens não devem ser somadas por haver sobreposição.
- Build de produção aprovado após ambas as correções; lint dos arquivos alterados sem erros; `git diff --check` limpo.
- Testes locais anteriores: 14 de PostgreSQL, 6 de navegador responsivo e 25 de contratos existentes de negócio aprovados.
- Suíte geral tem 302 falhas preexistentes reproduzidas na main limpa. TypeScript possui diagnósticos legados; comparação anterior não identificou novos. Isso impede afirmar que todo o repositório está verde.
- Carga local validada anteriormente com 10 mil clientes; não foi feito teste de carga em produção nem com dados reais de clientes.
- Produção ainda exige PR/review e autorização explícita para implantação. Ordem: migration primeiro, frontend depois. Rollback: frontend anterior antes de remover RPC.

## Evidências

- [Carteira autenticada, 360 e negócio persistido](assets/clientes-360/homologacao/carteira-autenticada.png)
- [Resultados PostgREST](assets/clientes-360/homologacao/postgrest.json)
- [Execução navegador](assets/clientes-360/homologacao/browser.txt)
- [Revalidação após restauração e correção de data](assets/clientes-360/homologacao/browser-restored.txt)
- [Testes finais](assets/clientes-360/homologacao/unit-final.txt)

Script `scripts/verify-client-portfolio-preview.mjs` exige fixture temporária explícita e ref descartável; rejeita produção e dev aposentado. Credenciais da execução foram descartadas com a branch.

## Preparação para produção

Main incorporou `20271021000013_isolate_whatsapp_notifications` após a homologação. Migration da carteira renumerada de `20271021000013` para `20271021000014`, sem alterar SQL. A branch descartável usou o número anterior. Revalidação local inclui apply e rollback com o novo nome.

## Publicação autorizada — PR #2128

Usuário solicitou explicitamente abrir PR e fazer merge para main em 16/09. Migration aplicada antes do frontend, em produção `jsjsmuncfkbsbzqzqhfq`, às 19:21:59 UTC. SHA-256: `00b7d0a8cd6138b0966eec5cefe573356bddf44a3f299ad77432152c0e3eccf4`. Sem alterações em registros de clientes.

Conector gravou inicialmente versão `20260916192159`. Ledger normalizado para `20271021000014`, condicionado ao nome e hash do corpo da função, e conferido novamente. Sem reaplicar SQL. Grants verificados no alvo: anon=false, authenticated=true, service_role=true; SECURITY INVOKER e search_path vazio. Smoke com papel authenticated sem vínculo retornou zero clientes.

GitHub Actions não iniciou jobs por cobrança/limite da conta (anotação do check Lint & Build). Validação local substitui execução remota nesta publicação; nenhuma configuração de proteção foi alterada. Ratchet de testes reproduziu exatamente as mesmas 167 falhas fora do baseline na main limpa `cb797d5c0`; os logs completos dos dois ratchets são idênticos. Gitleaks no intervalo de commits: nenhum segredo. Self-test detecta achado herdado em `scripts/ops/repair-loofting-bulk-pipeline-move.sql:18`, arquivo sem alteração neste PR; não foi incluído segredo nos relatórios.

Review final: ratchet de TypeScript lista as mesmas 65 assinaturas fora do baseline na branch e main limpa, nenhuma adicionada. Lint e dependências passaram. Transição mobile corrigida: histórico controlado pelo painel e somente uma instância do 360 montada; Escape rápido fecha só histórico, inclusive antes do registro da camada Radix. Cinco execuções consecutivas desse cenário passaram; teste agora exige histórico fechado e 360 preservado.
