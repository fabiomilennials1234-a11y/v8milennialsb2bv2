---
type: feature
title: Pergunta com botões (WhatsApp Menu)
status: active
created: 2026-09-21
updated: 2026-10-15
tags: [workflows, whatsapp, question-buttons]
related: []
owner: gabriel
---
# Pergunta com botões — implementação candidata

Node exclusivo de automações WhatsApp, `question_buttons`. Não altera contratos de nodes Copilot. Uma mensagem com até três opções, cada ID estável ligado a uma saída; alternativas `other_response`, `timeout` e `send_failure`. Imagem fixa opcional armazenada em bucket privado.

Ocorrência e definição congeladas antes do HTTP. Fila serializa organização, instância e telefone somente enquanto a pergunta estiver pendente. Primeiro ingresso durável elegível vence, com locks compartilhados com timeout. Prazo começa no aceite original do provedor. Envio incerto nunca autoriza reenvio; consultas limitadas por ocorrência e instância recuperam o aceite ou mantêm incerteza explícita.

Ativação valida referências e conexões no servidor. Importação exige reconectar instância/imagem; duplicação local preserva o ativo. Histórico projeta apenas estado e resultado após autorização. Excluir instância preserva ocorrências/ingressos, evitando execução órfã.

~~Gate por org em `organizations.feature_flags`~~ — **removido em 2026-10-14**: pergunta com botões é padrão para toda organização (ver seção abaixo). Migrations devem preceder publicação do webhook/worker; sem RPCs, ingresso devolve erro recuperável.

Estado em 2026-09-21: candidato local, testes unitários e contratos transacionais no banco de produção com rollback. Texto/imagem reais confirmados pelo CTO em TorqueSDR; ainda não comprovam jornada implantada completa. Não habilitar para todas as organizações com base nesses testes. Matriz Android/iOS/Web/Desktop permanece sem cobertura completa.

Fontes: `.specs/pergunta-com-botoes/` e `tests/integration/workflow-buttons/README.md`. PRD #2141; tickets #2142–#2150. Nenhum ticket encerrado por esta nota.


## Atualização do piloto

Backend implantado em produção sob autorização do CTO: migrations 60–68, webhook v107, worker v163, imagem v1. Um snapshot de teste autorizado na TorqueSDR recebeu aceite com imagem privada; aguardando resposta. Gate geral permanece desligado; frontend não publicado. PR #2153 em draft. Actions bloqueado por cobrança/limite antes de iniciar jobs. Detalhes e estado atual em `.specs/pergunta-com-botoes/implementacao-tdd.md` e evidências de deploy/piloto.

### Correção de projeção no chat

Piloto revelou envio aceito sem registro em `whatsapp_messages`. Migration 69 agora grava projeção na transação de aceite, preservando eco/status e evitando depender de callback para aparecer no chat. Piloto recuperado sem reenvio. Imagem privada recebe prévia autenticada por mensagem; componente de botões atualizado no PR, ainda sem publicação do frontend. Ver evidências de chat e limites de validação na spec.

## Acesso pelo editor — 2026-09-22

Por decisão do CTO, configuração passa a **Adicionar Nó → Ação → WhatsApp Menu**. A entrada independente em Controle de Fluxo é removida; painel e canvas usam identificação de Ação. Imagem, botões, prazo e saídas permanecem. Contrato interno `question_buttons` é preservado para compatibilidade com snapshots/executor. Menus legados não são migrados automaticamente. Esta alteração depende da publicação do frontend.

## Padrão para todas as orgs — 2026-10-14

Decisão do CTO: o WhatsApp Menu deixa de depender de feature flag por org (a org Rodrigo Gipp, sem a chave, via o painel vazio). A flag saiu de ponta a ponta — editor V5 (`src/`) e clássica (`classic/src/` via `classic.patch`), executor (`_shared/workflow-executor.ts`), API de imagem (`_shared/workflow-question-image.ts`) e SQL (`20271122000000_workflow_buttons_sem_flag.sql`, CREATE OR REPLACE de `freeze_workflow_button_definition` e `guard_workflow_button_activation` a partir do corpo de prod, com guarda de md5). A chave antiga em `feature_flags` não foi limpa: fica inerte.

- Seletor de ação: "WhatsApp Menu" sempre em Comunicação, inclusive com o nó unificado.
- Nó legado `action` + `send_whatsapp_menu` (9 nós, só Riofix, workflow inativo): cartão em leitura + botão "Converter em pergunta com botões" (`src/modules/workflows/lib/convertLegacyMenuNode.ts`). Conversão explícita: texto, até 3 rótulos (corta e avisa), instância, prazo 24h; remove a saída antiga sem handle e pede para religar; "Desfazer" no toast. Não convertido, segue executando pelo handler antigo `sendWhatsAppMenu`.
- Sem instância Uazapi na org: aviso no painel — o envio só sai por Uazapi; Evolution/NotificaMe caem na saída "Falha no envio" (sem fallback para texto).
- Guard continua recusando definição inválida (texto, 1–3 botões, rótulos/ids únicos, 4 saídas conectadas, instância Uazapi da org, override evolution, imagem privada).
- Ordem de deploy: migration → `process-workflow-executions`, `test-workflow-system`, `workflow-question-image` → front (dual). Front antes da migration = org sem chave consegue montar o nó mas a ativação ainda dá 23514.
