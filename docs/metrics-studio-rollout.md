# Estúdio — rollout sem substituir painéis existentes

Estado em 2026-09-08: preparado para revisão, **não executado em produção**.
PR de trabalho: #2040. Produção exige autorização explícita do CTO na sessão,
review e CI verde. O erro histórico do bootstrap de CI em
`20270925000000_aposenta_calor_e_rating.sql` segue um bloqueio separado;
nunca corrigir editando uma migration já aplicada.

## Contrato de preservação

- `metrics_studio_panels.id`, organização, nome, ordem, autoria, timestamps e
  `layout` dos painéis existentes ficam intactos. Inclui abas vazias, repetidas
  e métricas personalizadas: não são lixo nem autorização para deduplicar.
- Templates são novas linhas, adicionadas depois das existentes. Não aplicar
  templates com UPDATE, não recriar abas existentes, não renumerar o legado.
- `template_key` indica origem, nunca autorização para restaurar/sobrescrever.
- O frontend não cria abas automaticamente ao ler uma lista vazia ou com erro.
  Apagar a última aba deve continuar resultando em nenhuma aba após recarregar.
- O modo demonstração e seus dados fictícios não entram em produção.

## Antes de autorizar

1. Identificar organização e horário do sumiço relatado, versão efetivamente
   servida e requisição de salvamento. A reprodução local de uma corrida não
   comprova sozinha a causa do incidente real.
2. Inventariar por org os IDs, nomes, ordens, `template_key`, número de cards e
   hash do JSON completo. Conferir também `metric_custom_definitions`: os
   layouts contêm referências a essas definições.
3. Executar `scripts/backup-metrics-studio-before-rollout.sql`: cópias integrais
   de ambas as tabelas no schema privado `backup`, com RLS e sem grants para
   anon/authenticated/service_role. O script recusa sobrescrever snapshot
   anterior; registrar recibo, horário e responsável. Mantém configurações de
   clientes no domínio de backup do banco, sem exportar dados para um laptop.
   Ensaiar antes com `.specs/project/studio-preview-restore-proof.sql` e fixtures
   sintéticas. Retenção: não remover os snapshots antes de aprovação do CTO.
4. Ensaiar schema + seed + frontend com organizações sintéticas: painel autoral
   preenchido, vazio, nomes repetidos, múltiplas abas e métricas personalizadas.
   Verificar RLS admin positivo, member negativo e isolamento entre duas orgs.
   Validar erro de save/retry, leitura atrasada, troca rápida de abas/org,
   refresh, ausência de catálogo e exclusão cancelada/confirmada/última aba.
5. Usar `supabase-preview-lifecycle.mjs` com cleanup no `finally`; excluir a
   branch efêmera imediatamente após o ensaio e confirmar sua ausência. Não
   criar outra sem conferir a propriedade/uso das existentes. Nenhuma branch
   nova foi necessária para os testes de frontend deste ajuste.

## Ordem de publicação

1. Conferir no ledger de produção que `20271001000000` (abas) já foi aplicada;
   não reaplicá-la. Conferir compatibilidade do bundle servido: escrita por
   `id`, nunca pelo antigo UNIQUE de `organization_id`.
2. Após autorização, aplicar somente a migration DDL revisada
   `20271017113742_dashboards_viram_templates.sql`, sem `db push` indiscriminado.
   Conferir privilégios das duas funções privadas e trigger de nova org.
3. Com backup fresco e janela breve sem edição, executar **uma única vez**
   `scripts/seed-metrics-studio-templates.sql`. A transação bloqueia escritores,
   captura todas as linhas anteriores e aborta se qualquer campo de uma delas
   mudar/desaparecer. Timeouts curtos impedem lock indefinido. A captura TEMP é
   apenas a asserção transacional, não substitui o backup privado durável.
4. Conferir hashes/contagens anteriores e posteriores. Deve haver zero IDs
   antigos ausentes e zero linhas antigas diferentes; somente novos templates.
   Se o seed já concluiu, NÃO repetir para "corrigir" abas ausentes: uma aba pode
   ter sido excluída intencionalmente depois do rollout.
5. Publicar o frontend revisado. Validar primeiro com CTO na org canário:
   painel legado, templates, criar/editar/recarregar e excluir apenas aba de QA.
   Não testar destrutivamente no painel de um cliente.
6. Monitorar erros de leitura/gravação e relatos nas primeiras 24h. A versão nova
   mostra falhas de save e mantém a edição para retry; não aceitar sucesso apenas
   porque o indicador "Salvando" desapareceu.

## Rollback e recuperação

- Preferir roll-forward. Não voltar ao bundle que grava por `organization_id`
  ou que ignora falhas de persistência.
- Reverter frontend somente para versão compatível com múltiplas abas; manter
  os dados. Não derrubar a tabela nem restaurar o dump inteiro sobre produção.
- O rollback SQL de templates deve ser revisado contra o estado atual. Mesmo
  templates sem alteração podem estar em uso: não removê-los automaticamente.
- Recuperação de layout é por ID + organização, comparando estado atual com
  snapshot e confirmando com o CTO. Restaurar só os IDs afetados para não apagar
  edições válidas posteriores ao backup. Preservar cópia do estado pré-reparo.

## Diagnóstico registrado

Leitura READ ONLY de produção em 2026-09-08: 32 abas em 19 orgs, 20 vazias.
Vazio não demonstra perda. Há abas homônimas; nenhuma foi removida/renomeada.
O único trigger encontrado na tabela atualiza `updated_at`; não há histórico
de versões de layout nessa tabela. Não é possível reconstruir o conteúdo
anterior só com a linha atual.

Reproduzido no hook real: uma releitura iniciada antes da edição retorna tarde,
substitui o cache por layout antigo e, ao voltar à aba, o canvas perde cards.
Correção: cancelar leituras anteriores ao salvar e preservar o rascunho nas
releituras durante debounce, escrita ou retry. Teste falhou antes e passou depois.
Catálogo ausente também ocultava cards salvos: agora mantém o espaço e explica
indisponibilidade, sem excluir o layout. A causa do incidente específico de
produção ainda depende da identificação da org/horário e evidência de rede.

Limite ainda existente: edições simultâneas do mesmo painel por dois admins
seguem last-write-wins. Controle de versão otimista + histórico de layouts é
recomendado como próxima proteção, com migration própria, revisão e ensaio de
RLS; não foi incluído silenciosamente nesta publicação.
