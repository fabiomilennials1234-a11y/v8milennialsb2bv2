# O que esta feature faz

**Nome interno:** Vínculo user ↔ instância de escrita WhatsApp
**Status:** Aplicada em DEV. Cutover em PROD pendente UAT presencial.

---

## Em uma frase

Cada vendedor tem o seu próprio número de WhatsApp dentro da empresa, e cada lead tem um vendedor responsável — então toda mensagem que sai pra esse lead sai pelo número desse vendedor, sem confusão.

---

## O problema que resolve

Hoje, quando uma empresa tem mais de um vendedor compartilhando uma mesma instância de WhatsApp, qualquer um pode responder qualquer lead pelo mesmo número. Isso causa:

- Cliente recebe mensagem de "número desconhecido" porque trocou de vendedor sem aviso.
- Disputa interna sobre quem fechou a venda — comissão fica turva.
- Vendedor A responde lead de vendedor B sem rastreabilidade.
- Quando alguém sai da empresa, ninguém sabe quem assume os leads daquele número.
- Auditoria do passado é impossível — não dá pra reconstruir "quem mandou o quê de qual número".

---

## O que muda na prática

### Para o vendedor

- Você é dono de **um número de WhatsApp** dentro da sua empresa.
- Quando abre uma conversa de um lead seu, o composer está habilitado normalmente.
- Quando abre uma conversa de um lead de outro vendedor, vê:
  > "Esta conversa pertence ao número do João. Você pode ler e adicionar notas internas."
  Composer desabilitado. Sem possibilidade de enviar mensagem indevida.
- Se tentar mandar pelo backend (via API), recebe `403 Forbidden`.

### Para o admin da org

- Botão novo no chat: **Vincular número**.
- Modal lista todos os números da org separados por:
  - **Disponível** (sem dono, badge verde)
  - **Em uso** (já tem dono, badge amarelo)
  - **Atual** (já é desse vendedor, badge azul)
- Atribui o número ao vendedor com 1 clique.
- Se o número já tem dono, modal pede confirmação destructive ("Substituir vínculo?").
- Se o número está desconectado, banner amarelo avisa antes de atribuir.
- Cada troca fica registrada em auditoria com timestamp + quem mudou + razão.

### Para o master (plataforma)

- Mesmo poder do admin em qualquer org.
- Pode reatribuir números sem restrição.

### Para os automatismos (copilot, workflows, campanhas)

- Cron de copilot, followups, workflows, regras de pipe e campanhas agora respeitam o vínculo: a mensagem sai pelo número do responsável do lead.
- Se o responsável não tem número vinculado, dispara erro `NO_INSTANCE` no log e a mensagem **não é enviada** (sem fallback silencioso pra outro número).
- Broadcast (envio em massa) continua escolhendo a instância como antes — não tem responsável único, é exceção arquitetural.

---

## Quem ganha o quê

| Stakeholder | Ganho |
|-------------|-------|
| **CTO** | Auditoria completa (quem mandou de qual número, quando, quem trocou owner). Modelo de dados explícito, índice único garantindo invariante 1:1. |
| **Admin da org** | UI clara para gerenciar quem usa qual número. Histórico de trocas. Sem mais "ninguém sabe quem é dono daquele número". |
| **Vendedor** | Identidade própria. Cliente vê sempre o mesmo número. Sem tomar mensagem que não é dele. |
| **Cliente final** | Atendimento consistente. Sempre o mesmo número, mesma pessoa. |
| **Compliance/Suporte** | Reconstrução de incidentes possível via `whatsapp_instance_owner_history`. |

---

## Como liga / desliga

A feature vive atrás de uma flag chamada `user_write_instance_strict`. Default = **OFF** em todas as orgs hoje. Comportamento legado preservado byte-a-byte enquanto OFF.

**Cutover por org** (admin da plataforma):
```sql
INSERT INTO organization_features (organization_id, feature_key, enabled, created_at)
VALUES ('<org_id>', 'user_write_instance_strict', true, now())
ON CONFLICT (organization_id, feature_key) DO UPDATE SET enabled = true;
```

**Rollback** (1 query, propaga em ~90s):
```sql
UPDATE organization_features SET enabled = false
WHERE organization_id = '<org_id>'
  AND feature_key = 'user_write_instance_strict';
```

---

## O que NÃO muda

- Como mensagens são **recebidas** (webhooks, conversas, histórico).
- Schema de `conversations`, `conversation_messages`, `channel_messages`.
- Provider Uazapi/Evolution por baixo — abstração continua igual.
- Broadcast (mass-send) — segue lógica de campanha como sempre foi.
- Permissões de admin/master — admins e masters continuam podendo escrever em qualquer instância da org (bypass por desenho).

---

## Onde isto vive no código

- **Schema + RPCs**: [supabase/migrations/20260930000000_user_write_instance.sql](../../../supabase/migrations/20260930000000_user_write_instance.sql)
- **Backend guard**: [supabase/functions/_shared/instance-write-guard.ts](../../../supabase/functions/_shared/instance-write-guard.ts)
- **Composer (estados)**: [src/components/chat/composer/ChatComposerShell.tsx](../../../src/components/chat/composer/ChatComposerShell.tsx)
- **Modal admin**: [src/components/chat/admin/InstanceOwnerModal.tsx](../../../src/components/chat/admin/InstanceOwnerModal.tsx)
- **Hook de estado**: [src/hooks/useLeadWriteInstance.ts](../../../src/hooks/useLeadWriteInstance.ts)
- **Send hook**: [src/hooks/chat/useWhatsAppSend.ts](../../../src/hooks/chat/useWhatsAppSend.ts)
- **Detalhes técnicos completos**: [feature-overview.md](feature-overview.md)
- **Status de QA**: [qa-report.md](qa-report.md)
- **Plano de rollout**: [e-rollout-toolkit.md](e-rollout-toolkit.md)

---

## Estado atual (2026-05-11)

- ✅ Aplicada em DEV (`bcfadphgsibjzivtbjvc`).
- ✅ Backend, frontend, modal admin, testes, docs prontos.
- ✅ 3 bugs críticos identificados em QA — todos corrigidos.
- ❌ PROD intocada. Cutover requer: aplicar migration em PROD + UAT presencial F1-F8 + atribuir owners + ligar flag por org gradualmente, começando por Milennials (org piloto).
