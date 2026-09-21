# 09 — Validar jornada completa e preparar ativação controlada

## What to build

Demonstrar o node completo, com imagem e três destinos, mensagens livres, silêncio, falha e fila, usando um fluxo criado no editor e histórico observável. Entregar evidências para ativação controlada sem alterar Copilot, legado ou publicar em produção automaticamente.

## Acceptance criteria

- [ ] Playwright cria fluxo, salva rascunho, verifica impedimento de ativação incompleta, conecta saídas e configura imagem/prazo; ausência de elemento obrigatório falha o teste.
- [ ] Jornada integrada comprova os três botões, Outra resposta, Sem resposta, Falha no envio, clique antigo/duplicado, fila e edição durante espera.
- [ ] Evidência real confirma texto e imagem com um a três botões em Android, iOS, Web e Desktop, com versões e limitações registradas. Ausência de evidência não vira suporte presumido.
- [ ] Testes positivos/negativos cobrem organização, caixa, autorização e ativos; reexecução após falha/reinício não duplica decisão.
- [ ] Verificar regressões de menus, waits, envio comum, portabilidade e nodes Copilot existentes sem mudar seus contratos.
- [ ] Todas as validações das fatias anteriores estão concluídas; pendências reais bloqueiam ativação geral e ficam descritas sem reduzir escopo silenciosamente.
- [ ] Entregar histórico de validação, instruções de habilitar/desabilitar a capacidade e comportamento das ocorrências em andamento, preservando consistência. Nenhum deploy de produção está autorizado por este ticket.
- [ ] Usar recursos de teste autorizados, sem Docker/Supabase local e sem mensagens para clientes; registrar limpeza do que foi criado no ambiente isolado.

## Blocked by

- 07 — Serializar perguntas da conversa somente durante o node.
- 08 — Duplicar e importar perguntas sem trocar opções ou ativos.
