# Editor — implementação local, 2026-09-21

Implementado na branch `codex/whatsapp-question-buttons`, base `0d20ce8b8`. Nenhum deploy, toggle de organização ou envio foi feito nesta fatia.

## Comportamento

- Node `question_buttons` com texto, 1–3 botões de identidade estável e prazo de resposta (24h inicial, permite frações positivas).
- Reordenar/renomear preserva IDs. Remover opção remove suas edges no editor, preservando auxiliares.
- Canvas oferece `button:<id>`, `other_response`, `timeout`, `send_failure`.
- Padrão para toda organização desde 2026-10-14 (`20271122000000_workflow_buttons_sem_flag.sql`): a feature flag por org saiu do editor (V5 e clássica), do executor, da API de imagem e das funções SQL `freeze_workflow_button_definition`/`guard_workflow_button_activation`. "WhatsApp Menu" aparece sempre em "Comunicação" do seletor de ação, inclusive com o nó unificado. A chave antiga em `organizations.feature_flags` ficou inerte (não foi limpa). O servidor conserva sua própria validação e autorização.
- Nó legado `action` + `send_whatsapp_menu`: cartão em leitura + conversão explícita (`convertLegacyMenuNode`: texto de `menuText`/`messageTemplate`, rótulo antes do `|`, até 3 botões com id novo, instância preservada, prazo 24h; remove a saída antiga sem handle e pede para religar; desfazer volta). Escolher "WhatsApp Menu" no seletor usa a mesma função. Não convertido, segue executando pelo handler antigo `sendWhatsAppMenu`.
- Sem instância Uazapi na org, o painel avisa que o fluxo segue pela saída "Falha no envio" (não há fallback para texto).
- Contrato existente `findNodeConfigIssues(nodes, edges)` valida configuração e exatamente um destino existente por saída. Gate de save ativo e ativação da listagem já consomem esse contrato. Rascunho incompleto continua salvável.
- IDs aceitam ASCII alfanumérico, underscore e hífen. Rótulos não aceitam pipe/quebras de linha, pois esses caracteres alteram o protocolo de escolhas Uazapi. Não são limites importados da API Meta.
- Painel indica erros de configuração; canvas mostra a pendência marcada pela tentativa de salvar ativo.
- Seleção de instância usa `useWhatsAppInstancesForUser`: filtro da organização e vínculos do usuário existentes, somente Uazapi. Pode usar instância da conversa ou escolher explicitamente. Gatilhos sem conversa precisam da seleção explícita. Carregamento/erro/referência indisponível têm feedback. Imagem fixa adicionada em fatia posterior; ver `imagem-fixa-tdd.md`.

## TDD

Treze testes passaram em quatro arquivos: painel/canvas/seletor (6), menu com gate (1), contrato público de publicação (3), editor completo (3). Cenários novos tiveram falha observada antes da implementação correspondente. Fronteiras UI React reais e contrato público existente; nenhum colaborador interno foi mockado. Seletor e editor completo usam hooks reais, providers reais e HTTP Supabase simulado, sem acesso ao serviço real. jsdom recebe apenas polyfills das APIs de navegador ausentes.

Editor completo comprova remoção de botão e respectiva edge no payload de persistência, preservação das outras saídas, bloqueio de ativação com flag OFF e bloqueio de configuração sem destino mesmo após salvar rascunho. Ainda não comprovado nesta fatia: publicação no servidor/banco real, navegação real com teclado, inspeção visual no browser e execução de cada saída. Testes com HTTP simulado não substituem esses aceites.

## Design aplicado

Referências do padrão da casa: Linear para densidade do painel; Stripe para mensagens de validação acionáveis; Vercel para hierarquia com acento restrito. Tokens existentes `card`, `foreground`, `muted-foreground`, `primary`, `destructive`, `border`; nenhum token paralelo. Labels ligados aos inputs, nomes acessíveis nas ações de reordenação/remoção; botões nativos suportam foco/teclado. Sem animação nova. Canvas mantém pergunta e saídas em lista vertical para não comprimir seis conexões numa única base.

Validação visual em navegador permanece pendente; não declarar aprovação estética ou acessibilidade integral apenas por jsdom.
