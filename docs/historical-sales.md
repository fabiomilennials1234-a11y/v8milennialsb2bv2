# Registro de vendas anteriores ao CRM

Na aba Negócios do lead, **Registrar Venda** abre uma lista com valor positivo
em reais e data da compra (até hoje, no fuso da organização). **Próxima venda**
valida a linha atual e acrescenta outra. **Salvar vendas** registra a lista
inteira ou nenhuma linha e fecha a janela após a confirmação. Limite: 100 vendas.

Cada linha cria um `deals` ganho, sem `pipeline_entries`, um pedido aprovado da
carteira (`source = historical`) e um único `sale_events` vinculado a ambos.
O evento usa a data informada. O trigger do pedido encontra a mesma chave
`producer/origin_record_id/event_type`, evitando receita duplicada. A gravação
explícita também funciona quando a emissão automática da carteira está desligada.

O cliente da carteira é reaproveitado por organização/lead ou criado se necessário.
Pedidos alimentam as métricas de carteira; a coluna Recompra do lead já une as
datas do ledger e dos pedidos, colapsando compras no mesmo dia. Com menos de duas
datas não há intervalo observado; o cadastro da carteira mantém seu fallback
de ciclo, enquanto a coluna do lead indica histórico insuficiente.

Pedidos históricos não podem ter valor/data/cliente alterados pela edição genérica
de Pedidos: essa operação não corrige o ledger e o negócio. Um fluxo específico de
correção/estorno não faz parte desta entrega. Eventos anteriores já existentes
mantêm seus snapshots de atribuição e de aquisição/recompra.

## Segurança e recuperação

A RPC recebe somente lead, lista e chave de idempotência. Resolve a organização
pelo lead, verifica associação, acesso ao lead e papel ativo admin/member ou master.
Revoga execução anônima; a tabela de lotes tem RLS e não admite escrita direta
de usuários. A mesma chave e payload retornam os mesmos IDs, sem novos lançamentos.
Uma resposta incerta mantém chave/lista em sessionStorage por usuário/org/lead,
permitindo confirmar o resultado mesmo depois de fechar e reabrir o modal.

## Testes de banco isolado

`tests/fixtures/historical-sales-schema.sql` contém constraints e funções de
receita/ciclo capturadas do banco em 2026-09-08. Identidades e helpers de acesso
são reduzidos ao contrato do teste; não é um clone integral de produção.

Em um container descartável `postgres:16-alpine`, executar via `psql -v ON_ERROR_STOP=1`:

1. `tests/fixtures/historical-sales-schema.sql`
2. `supabase/migrations/20271018000002_registrar_vendas_historicas.sql`
3. `tests/integration/historical-sales.sql`

Verifica negócio ganho, ausência de card, datas, receita única, ciclo, idempotência,
validação atômica, acesso entre organizações, grants e bloqueio de edição isolada.
Os testes React cobrem montagem da lista, cancelamento, confirmação e recuperação.

Aplicar a migration antes de publicar o frontend. Não existe backfill automático.
