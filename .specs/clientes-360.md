# Clientes 360 dentro de Leads

Referência aprovada: [mockup](assets/clientes-360/mockup-aprovado.png).
Branch `codex/leads-clientes-360`, baseada na main `eedb12dbd`.

## Interface e fluxo

- Abas Todos / Leads / Clientes / Perdidos; Indefinido quando aplicável ao ERP.
- Carteira tabular com faixa, última compra, ciclo, próxima compra, atraso e negócios abertos.
- Painel Cliente 360 persistente a partir de 1024px, com primeira compra (“Cliente desde”), faixa e atraso separados, total comprado, pedidos, previsão com timeline, etapas reais dos negócios, novo negócio e compras recentes.
- “Ver todas” abre histórico completo paginado em 20 linhas; resolve estornos antes de apresentar compras. Não cria um caminho financeiro paralelo.
- No celular, botão explícito Cliente 360 e seleção de linha abrem sheet. Abertura de negócio fecha o sheet antes de mostrar o diálogo oficial. Histórico sobre o sheet usa overlay e conteúdo na mesma camada superior.
- Criação continua em `LeadCardNewDeal` → `useAbrirNegocio`, com permissões existentes e mesmo lead. Abrir negócio/cadastro usa os fluxos oficiais.
- Sem previsão antes de duas datas de compra. Ausência de segmento não vira Bronze.
- Loading, erro com retry, vazio, ações sem permissão e foco de teclado tratados. Tabela rola dentro do contêiner, sem alargar a página.

## Dados globais

`client_portfolio_page` aplica todos os filtros antes de agregar e paginar. Retorna no máximo 100 clientes (UI: 50), total do recorte, receita mensal, previstos e atrasados. Faixa/recompra não ficam limitadas à página visível.

- Receita mensal: somente `sale_events`, sem estornos, mês no fuso da organização. Pedido de carteira sem ledger não fabrica receita.
- Total comprado: CRM quando há vendas válidas; carteira aprovada como fallback. Nunca soma CRM e ERP em duplicidade.
- Ciclo: união de dias UTC das vendas e pedidos aprovados, excluindo estornos, média arredondada dos intervalos, mínimo 1 dia. Até 7 dias = recompra prevista; negativo = atrasada.
- Classificação por relacionamento usa consulta em lote equivalente ao predicado `relacao_negocios(l) = 'cliente'`, validada contra a função canônica para ganhos, perdas, históricos, etapas legadas e exclusões. ERP/Café preservam seus contratos.
- Busca literal (%, _ e barras escapados), telefone normalizado, origem, qualificação, dono da conta, UF, intervalo de cadastro, atribuição e ordenação estável com ID de desempate.
- Negócios consultados apenas para a página. Datas e agregados chegam do banco; resposta é validada por Zod. Erros não viram zeros.
- Cache por organização/filtros/página, cancelamento de RPC e invalidação Realtime. Mudança de filtro reinicia paginação e seleção removida retorna ao primeiro cliente visível.

## Segurança e performance

RPC `SECURITY INVOKER`, `search_path` vazio, execução apenas autenticada, exige `auth.uid()`. Todas as consultas têm organização explícita e preservam RLS, inclusive atribuição. Sem novas policies ou alterações de privilégios em tabelas. Organização vem de `useOrganization`; filtros não aceitam organização arbitrária.

Agregação em lote evita chamar classificações complexas por linha. `enable_nestloop=off` é local à função: estimativas de visibilidade sob RLS causavam recomputação repetida de grupos; hash/merge joins eliminaram o problema. Teste verifica restauração da configuração do chamador.

Massa sintética: 10 mil clientes, 20 mil vendas e 20 mil pedidos. Consulta local completa ficou na ordem de 65–100 ms (ERP e relacionamento); teto de regressão do teste: 5 s. Não é benchmark de produção.

## Rollout

1. Aplicar migration `20271021000014_client_portfolio_page.sql` no ambiente de homologação antes do frontend.
2. Publicar frontend e validar com sessão autenticada desse ambiente: seleção, alteração de filtro, criação de negócio e retorno à carteira.
3. Regenerar tipos pelo fluxo oficial; adaptador RPC estreito com validação runtime permite deploy aditivo sem editar `types.ts` manualmente.
4. Rollback: reverter frontend primeiro; depois executar migration correspondente em `supabase/migrations/rollback/`.

Nenhuma migration ou escrita foi executada em banco remoto nesta tarefa. Produção exige autorização explícita conforme AGENTS.md. Não há alegação de homologação remota ou escrita end-to-end em produção.

## Validação reproduzível

- `npm run test:client-portfolio:db`: cria banco e cluster PostgreSQL descartáveis em loopback, executa migration real e rollback e remove tudo. Precisa PostgreSQL 16+ disponível no PATH, ou `PG_BIN=/caminho/bin`. Fixture contém esquema mínimo e RLS representativa; não substitui aplicar toda a cadeia de migrations em homologação.
- `npm run test:client-portfolio:e2e`: seis testes Chromium/Chrome sobre `/clientes-preview.html`, reutilizando Vite na porta 5187 ou iniciando-o. Chrome precisa estar instalado. Preview usa componentes reais com fixtures; não grava dados.
- Vitest: `src/modules/leads/components/client-portfolio/`, `useClientPortfolio.test.tsx`, `useClientPortfolioPurchases*.test.*`, `reorder-cycle.test.ts`, `NewDealDialog.test.tsx`, contratos de cartões e imports da página.
- `npm run build`, `npm run lint`, `npx tsc -p tsconfig.app.json --noEmit`, `bash scripts/check-metric-antipatterns.sh`.

### Evidências — 2026-09-16

- Banco: 14 testes aprovados, incluindo RLS positiva/negativa, anon/JWT ausente, filtros globais, estornos, deduplicação, fuso, classificação canônica, carga e rollback.
- Navegador: 6 testes aprovados, desktop/notebook/mobile, filtros combinados, teclado, tema claro, 360 visível, histórico completo e transições entre modais.
- Aceite Vitest: 79 testes em 11 arquivos; mais 25 testes dos contratos existentes de negócios em 3 arquivos. Total específico: 124 testes aprovados, contando banco e navegador.
- Build aprovado. Lint geral: zero erros; avisos legados permanecem.
- Suíte geral antes do último refinamento visual do 360: 12.735 passaram / 302 falharam. As mesmas 302 falhas ocorrem na main limpa; 315 assinaturas de falha idênticas (inclui falhas de suites). Ajustes finais revalidados no aceite focado.
- TypeScript: 531 diagnósticos contra 536 na main limpa; nenhum novo, cinco removidos. Diagnósticos legados fora do escopo permanecem.
- Capturas: [desktop](assets/clientes-360/implementacao-desktop.png), [mobile](assets/clientes-360/implementacao-mobile.png).


Homologação remota concluída em 16/09: carteira/360, RLS, paginação, criação de negócio e rollback aprovados em branch Supabase descartável, já excluída. Corrigidas colisão de canais Realtime e data prevista na lista. Evidências e limites: `.specs/clientes-360-homologacao.md`. Produção não alterada.
