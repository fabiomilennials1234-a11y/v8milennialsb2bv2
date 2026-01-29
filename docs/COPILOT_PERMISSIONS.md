# Permissões do Copilot (IA)

Este documento descreve quem pode **criar** copilots, **vincular** um copilot a um número/funil e **ativar/desativar** a IA em uma conversa.

---

## 1. Criar Copilots

- **Quem:** apenas **administradores** (com assinatura ativa para a organização).
- **Onde:** menu **Copilot** → botão **Novo Copilot**.
- **Comportamento:** não-admins são redirecionados para Configurações (assinatura) ao tentar criar.

---

## 2. Vincular Copilot a um número / funil (WhatsApp)

- **Quem:** apenas **administradores**.
- **Onde:**
  - **Configurações** → **WhatsApp** → em cada número, configurar qual agente (copilot) responde naquele número.
  - Ou no **Copilot** → abrir um agente → **Configurações** do agente → vincular a uma instância WhatsApp.
- **Comportamento:** só o admin define qual copilot está ativo em cada número; vendedores não alteram essa vinculação.

---

## 3. Ativar ou desativar a IA na conversa (por lead)

- **Quem:** qualquer **vendedor (SDR/Closer)** que tenha permissão de **ver e editar** aquele lead.
- **Onde** o vendedor pode ligar/desligar a IA:
  1. **No chat:** no cabeçalho da conversa (ícone IA + switch), quando a conversa está vinculada a um lead.
  2. **No painel do lead:** ao abrir o painel do lead (detalhes) no WhatsApp ou no funil, o switch “IA Copilot” aparece no topo.
  3. **No kanban (Funil WhatsApp):** no card do lead, o componente de toggle de IA.
- **Comportamento:**
  - **IA ativada:** o Copilot continua respondendo mensagens daquele lead nesse número.
  - **IA desativada:** o Copilot deixa de responder; apenas humanos (vendedores autorizados naquele número) podem responder.
- **Regra de permissão:** quem pode **atualizar** o lead (RLS: admin, ou “ver todos”, ou “ver por responsabilidade/equipe” conforme permissões da org) pode alterar o campo “IA desativada” desse lead. Ou seja, quem pode editar o lead pode ativar/desativar a IA na conversa.

---

## Resumo

| Ação | Quem | Onde |
|------|------|------|
| **Criar** copilot | Apenas admin (com assinatura) | Copilot → Novo Copilot |
| **Vincular** copilot a número/funil | Apenas admin | Configurações → WhatsApp ou Copilot → Configurações do agente |
| **Ativar/desativar** IA na conversa | Vendedores que podem ver/editar o lead | Cabeçalho do chat, painel do lead, card no kanban |

Assim, apenas o admin cria e define em qual funil/número cada copilot atua; os vendedores controlam, por conversa (lead), se a IA está ligada ou desligada naquele contato.
