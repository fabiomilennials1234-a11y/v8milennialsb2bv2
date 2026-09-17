# Widgets de métricas — piloto TorqueCRM

Dashboard → Visão Geral. Seis indicadores existentes, sem mudar consultas, permissões ou cálculos.

## Layout e interação

Grade do componente fornecido, adaptada ao Framer Motion já instalado. Receita e conversão ocupam duas colunas; os demais indicadores ocupam uma. Até quatro colunas, uma em telas estreitas. Altura de linha de 164 px, intervalo de 16 px, raio de 20 px. Tokens de card, texto, borda e primary existentes. Sem fotos ou dados simulados na tela real.

Receita recebe fundo primary/6 e filete lateral. Valores com números tabulares, títulos pequenos e descrições auxiliares. Referências conceituais: hierarquia de Stripe, densidade de Linear, contenção visual de Apple. Preview de Storybook usa valores demonstrativos explicitamente separados dos dados reais.

Organizar widgets ativa edição. Mouse/pen arrastam; touch exige pressionar; Alt + setas reordenam. Concluir encerra edição. Restaurar recupera ordem inicial. Preferência local por organização e usuário, apenas IDs persistidos; armazenamento inválido retorna ao padrão. Falha de armazenamento mantém sessão utilizável e anuncia limitação. Motion respeita preferência de movimento reduzido.

## Rollout

Flag `organizations.feature_flags.dashboard_draggable_widgets`, via `useFeatureFlag`, ativada somente por boolean true. Ausência/loading mantém KPIs legados. Migration limita ativação ao UUID verificado da TorqueCRM e ao nome exato; preserva todas as outras flags. Não aplicada remotamente nesta tarefa.

Rollback operacional: definir essa chave como false na mesma organização. Preferências locais podem permanecer: não alteram dados nem habilitam a flag.

## Verificação

- Testes de teclado, edição desligada, restauração, dados atualizados e coluna única.
- Testes de isolamento de armazenamento, dados inválidos e flag ligada/desligada.
- Preview visual dark/light, desktop/mobile e arraste real no navegador.

## Resultado da validação

11 testes passaram; lint dos arquivos alterados passou. Arraste real salvou nova ordem e recarregamento a preservou. Mobile em 390 px sem overflow horizontal. Revisados dark, light e preferência de movimento reduzido em preview isolado.

Build global bloqueado por `useConnectWhatsAppCloud` ausente no barrel de communication, importado por WhatsAppSettings. Typecheck global também falha em erros fora dos arquivos alterados; nenhum diagnóstico nos novos widgets ou em TabVisaoGeral na execução realizada. Não houve deploy nem alteração remota das flags.

Validação para merge: build de produção passou em worktree isolado sobre main. Migração renumerada para `20271021000015_dashboard_widgets_torquecrm_pilot.sql` após verificar as versões atuais da base.
