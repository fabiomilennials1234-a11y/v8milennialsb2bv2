# Jrtex: primeiro contato humano move o negócio

Ativada em produção em 2026-10-23 às 10:38:20 de Brasília, a pedido do usuário.
No **Funil de Vendas - JRtex**, a primeira nova mensagem humana enviada com
sucesso pelo **WhatsApp Principal** move o negócio atual de **Novo** para
**Em conversa**. Esse é o nome existente da etapa chamada de “Conversando” no
pedido. Funis Profit, Opala e Charger não foram habilitados.

## Comportamento

- A regra começa na ativação; não migra negócios usando o histórico antigo.
- Considera `manual`, saída, sem IA, com status `sent`, `delivered` ou `read`.
  Mensagens enviadas pelo aparelho também contam, mesmo sem autor identificado.
- Ignora entrada, automação, histórico sincronizado, grupos, edições, mensagens
  apagadas, envios pendentes e falhas. Uma confirmação posterior pode concluir
  um envio pendente. O vínculo tardio de um envio novo a um lead também funciona.
- Move somente o negócio aberto atual do lead naquele funil, com a mesma ordem
  de prioridade do handler `move-stage`. Não cria lead, negócio ou mensagem.
- Exige etapa inicial, negócio aberto e lead ativo da mesma organização.
  Etapas posteriores e negócios ganhos, perdidos, encerrados ou excluídos ficam
  preservados. Uma mensagem anterior à criação do negócio não o movimenta.
- Grava `pipeline_entries.metadata.first_human_outbound_stage` com a mensagem,
  conexão, horário e etapas. Esse marcador impede repetição, inclusive se alguém
  voltar o card manualmente para Novo. Os gatilhos existentes mantêm o histórico.
- Preserva responsáveis, outros metadados e isolamento por lead. Inserções de
  fallback do navegador precisam passar pelo `can_see_chat_scope` do lead exato.

## Instalação e configuração

Migration: `20271214000002_whatsapp_first_human_outbound_stage.sql`.
O gatilho fica inerte sem configuração explícita por funil. A função fica no
schema privado, com search_path vazio e execução revogada de anon/authenticated.
Nenhuma organização ou ID de cliente está fixado no código da função.

A configuração operacional foi salva em `pipelines.config.first_human_outbound_stage`:

```json
{
  "enabled": true,
  "enabled_at": "2026-10-23T13:38:20.11249+00:00",
  "instance_id": "859ee852-2102-4a5d-b249-98a6fe0b601c",
  "from_stage_id": "cfd13158-6b9e-4f09-9714-30fe40700972",
  "to_stage_id": "58bb25fe-d843-48e6-ba49-7cfdf6d2c24c"
}
```

Organização: `30bb5c27-88f4-4f91-9493-835405ae2e11`.
Funil: `29a9ade8-0273-4893-8ef4-5d290e98f419`.
Essa automação é um gatilho de banco configurado no funil; não aparece como
workflow do editor visual. A migration não altera o workflow de qualificação.

## Verificação

`node --test tests/integration/first-human-outbound-stage.test.mjs`: 37 testes
passaram no PostgreSQL embarcado PGlite, incluindo as funções reais de espelho
de etapa e histórico capturadas da produção. Cobrem filtros, vínculo tardio,
confirmação, repetição, autoria, isolamento, configuração inválida e múltiplos
negócios. Não houve branch Supabase efêmera disponível nesta execução.

Em produção, um teste transacional com ROLLBACK confirmou: contexto de membro
sem acesso não move o lead; envio pendente não move; confirmação move para
Em conversa; leitura posterior não repete; responsáveis e metadados anteriores
são preservados; histórico de etapa é criado. O teste não chamou API de envio.
Após o rollback, zero mensagens sintéticas permaneceram e o card continuava
em Novo. A checagem final confirmou apenas um funil habilitado, com os controles
de acesso anteriores preservados. Naquele momento ainda não havia movimentação
real após a ativação.

Aplicada pelo MCP com versão gerada `20261023133612`; somente esse registro do
ledger foi reconciliado para `20271214000002`, correspondente à ordem do repo.
As demais migrations e seus conteúdos não foram alterados.

## Desativar

Desabilitar a configuração é suficiente e preserva o histórico dos movimentos:

```sql
UPDATE public.pipelines
SET config = jsonb_set(config, '{first_human_outbound_stage,enabled}', 'false')
WHERE id = '29a9ade8-0273-4893-8ef4-5d290e98f419'
  AND organization_id = '30bb5c27-88f4-4f91-9493-835405ae2e11';
```

Não remover marcadores nem retroceder negócios ao desativar. Para um novo
ciclo comercial, criar um novo negócio pelo fluxo normal do produto.
