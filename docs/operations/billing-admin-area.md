# Área de assinatura e cobrança

Entrada: Configurações → Outros → Assinatura e cobrança
(`/configuracoes/outros?tab=billing`; o alias `/configuracoes/assinatura` é normalizado).
Visível apenas para administradores, seguindo a mesma identidade das demais abas.

## Entregue nesta etapa

- Plano, situação, liberação manual, valor mensal contratado, validade e renovação prevista.
- Limites reais de equipe, WhatsApp e agentes de IA via `org_resolve_all_quotas`.
- Histórico paginado, detalhes e documentos HTTPS quando presentes.
- Estados independentes de carregamento, erro e ausência de dados.
- Atendimento funcional para alteração de plano, cancelamento e dúvidas de pagamento.
- Troca de organização remonta a área; chaves de cache e consultas incluem a org atual.

Leituras usam `organizations`, `org_subscriptions`, `subscription_plans` e
`payment_history`, com RLS existente e filtro da organização autenticada. Nenhum
grant, política, migration ou dado de produção foi alterado. As permissões de leitura
existentes destas tabelas incluem membros da organização; esta etapa não redefine
essa política nem cria endpoints novos. UI admin-only não substitui RLS.

`final_amount_cents` representa valor mensal no contrato atual; exibição divide por
100. `payment_history.amount` já está em reais. Não multiplicar nem chamar o motor
de cotação para inventar próxima cobrança. Data de renovação não implica débito automático.

## Conexão seguinte com checkout

O hook `useBillingAccount` concentra as leituras; `BillingSettings` apresenta o estado
e recebe `onContactSupport`, sem dependência do gateway. O próximo passo deve adicionar
ações server-side autenticadas de contratação/renovação e retornar URL de checkout
da cobrança idempotente. Ao retornar do checkout, invalidar as chaves
`billing-account`, `billing-history` e `billing-quotas` da organização.

Não marcar pagamento pelo redirect: a confirmação vem do webhook e do provisionamento.
Não oferecer troca de cartão/cancelamento automático antes de seus endpoints existirem.
Não coletar número de cartão no Torque. Dados fiscais e alteração de contrato ainda
dependem de persistência autorizada e validação server-side; não existem formulários
locais que simulem salvamento nesta entrega.

Ainda faltam as operações financeiras, a criação da cobrança Asaas, os fluxos de
renovação/cancelamento e validação ponta a ponta do checkout. Esta área prepara a
superfície administrativa; não conclui esses itens do Jira por si só.

## Verificação

Testes cobrem restrição por papel, troca de org, falhas de histórico, ausência de
limites, atendimento, URLs de documentos e formatação de datas/valores.
Prévia visual usa dados fictícios isolados, sem autenticação ou chamadas à produção.
