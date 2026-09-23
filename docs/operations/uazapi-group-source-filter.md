# Filtro de grupos na origem — implantação controlada

Status: implementado e testado localmente; **não ativado no fornecedor nem em produção**. `UAZAPI_GROUP_SOURCE_FILTER_ENABLED` vem desligada por padrão. A configuração usa `isGroupYes` somente quando tanto a intenção persistida quanto `organizations.capture_groups` são explicitamente `false`. Valor desconhecido preserva grupos. Mantemos `wasSentByApi` e os três eventos atuais (`messages`, `messages_update`, `connection`).

Contrato primário: [Uazapi v2 — Definir webhook](https://www.postman.com/augustofcs/uazapi-v2/request/so8w6vz/definir-webhook). Esse contrato documenta `excludeMessages: ["isGroupYes"]`; não prova batching nem permite assumir vários endpoints independentes. Nenhum evento global de grupos é removido. Readback com mais de um endpoint é inconclusivo, em vez de escolher silenciosamente o primeiro.

## Caminho implementado

- Criação de instância, `whatsapp-api-proxy/reconfigureWebhook` e `whatsapp-rebind-webhook` chegam ao mesmo adapter e à mesma política `_shared/uazapi-webhook-policy.ts`.
- Migration `20271021000028` guarda intenção por organização e situação por instância. As tabelas têm RLS e nenhum acesso autenticado direto. Somente RPCs service-role podem operar o protocolo.
- `prepare_uazapi_group_webhook` confere organização e instância, serializa pela organização e reserva token exclusivo antes do HTTP. Estado vira incerto imediatamente.
- POST gerenciado tem uma tentativa. Timeout/500 não dispara retry interno capaz de terminar depois de outro escritor. GET confirma URL, enabled, eventos, exclusões e flags de sufixos. Informação faltante também reprova.
- `finish_uazapi_group_webhook` exige token + revisão atuais. Só ativa captura após todas as instâncias Uazapi da organização comprovarem remoção da exclusão. Qualquer erro deixa operação bloqueada; sucesso remoto isolado não declara sucesso local.
- Trigger impede mudança direta `capture_groups=false → true/NULL` enquanto existir exclusão ou operação incerta. A política não depende de uma interface específica para bloquear esse caminho.

## Ordem de implantação

1. Aplicar migration28 antes do código. O adapter precisa da RPC mesmo com flag desligada e falha sem mutar fornecedor se a RPC estiver ausente. Publicar os três escritores: `whatsapp-api-proxy`, `whatsapp-rebind-webhook` e qualquer outro entrypoint que empacote esse adapter de criação/reconfiguração. Conferir todos os chamadores antes de ativar.
2. Manter flag OFF. Instância sem política/estado mantém a configuração legada, sem impor readback novo. Instância já gerenciada sempre usa lease e verificação, inclusive com flag OFF; desligar flag sozinho não remove filtros já instalados.
3. **Antes do primeiro enrollment**, interromper temporariamente rebind/criação da organização e drenar requisições antigas. Essa barreira é necessária porque uma versão antiga ou chamada legada já em voo não conhece a lease. Não há atomicidade entre PostgreSQL e a API externa. Não habilitar em implantação mista ou com escritores externos manuais concorrentes.
4. Canary: organização já com `capture_groups=false`, instâncias conhecidas, baseline recente de recebimento. Chamar `requestGroupCapture` abaixo para registrar intenção. Ligar flag nos writers coordenados. Reconfigurar suas instâncias pelo caminho existente. Verificar estado persistido e configuração remota antes de ampliar.
5. Reativar automações interrompidas após drenar as versões antigas. Medir entrada HTTP e mensagens privadas/edições/reações. Grupos habilitados devem continuar chegando. Contagem de logs `group_message_skipped` não substitui contagem HTTP faturada.

Flag global só permite filtrar organizações já inscritas por `requestGroupCapture`, explicitamente sem captura. Organizações sem intenção/estado persistidos mantêm comportamento legado mesmo com flag ON. Isso permite canary por organização e não substitui rollout coordenado. Preferir enrollment e reconciliação por organização; a flag não deve ser ativada sem concluir o inventário de escritores. Alteração manual da configuração no painel Uazapi está fora do protocolo e invalida a verificação: bloquear operacionalmente esse caminho durante a ativação.

## Operação autenticada

Usar o endpoint existente `whatsapp-api-proxy`, JWT do usuário e body:

```json
{"action":"requestGroupCapture","payload":{"capture_groups":true}}
```

Usuário comum precisa ser `team_members.role=admin`, ativo, na organização resolvida pelo servidor. Membro e gestor de portfólio sem cadeira admin não recebem esse privilégio automaticamente. Master ativo usa o mecanismo já existente de organização-alvo explícita e validada. O body nunca é usado para escolher outra organização para usuário comum.

Resposta `202` significa intenção registrada, **não captura já ativa**. Sem instâncias Uazapi, a mudança conclui imediatamente e retorna `200`, sem reconciliação pendente. Em seguida, executar `reconfigureWebhook` para cada instância Uazapi da organização, usando o proxy já existente com `instance_id`, ou o rebind administrativo existente escopado por organização. Nenhum cron novo é necessário. A última confirmação válida habilita `capture_groups=true`. Instância desconectada também precisa ter webhook removido/verificado: não ignorar porque está offline.

Para desabilitar captura, solicitar `capture_groups:false`. Banco desabilita a captura imediatamente, como a preferência atual; reconfiguração posterior pode economizar entrada. Falha de configuração mantém preferência persistida e exige reconciliação explícita. Mudança direta de `capture_groups` que contradiga a intenção gerenciada é recusada, inclusive desativação: usar `requestGroupCapture`. Isso impede que uma confirmação antiga reative a preferência após edição manual.

Consulta operacional, somente metadados:

```sql
SELECT s.organization_id, s.instance_id, p.desired_capture, p.filter_suspended,
       p.revision AS desired_revision, s.revision, s.excluded,
       s.lease_token IS NOT NULL AS pending_or_uncertain,
       s.lease_started_at, s.verified_at
FROM public.uazapi_group_webhook_state s
JOIN public.uazapi_group_policy p USING (organization_id);
```

Falha de criação após tentativa de provisionamento Uazapi preserva a linha local, credenciais persistidas e lease. O proxy retorna `409` com `instance_id` para reconciliação. Não criar outra instância para contornar o erro: apagar a linha perderia a identidade recuperável do fornecedor. Erro conhecido antes de qualquer chamada remota ainda limpa o placeholder escopado.

## Falha e recuperação

Lease não expira automaticamente. Mesmo após o timeout do cliente, o fornecedor pode completar uma requisição. Um segundo escritor não pode roubar a lease e declarar remoção enquanto o primeiro ainda pode reinstalar exclusão. Idade da lease serve para diagnóstico, não prova que é seguro retomá-la.

1. Confirmar interrupção do processo/request anterior e ausência de escritores antigos. Se isso não puder ser comprovado, manter bloqueado; não habilitar captura com uma suposição temporal.
2. Operador service-role usa `recover_uazapi_group_webhook(instance_id, organization_id, token_atual, true)`. A atestação exige conhecimento operacional; não é exposta ao usuário comum. RPC invalida lease/revisão e suspende filtro da organização. **Não habilita captura.**
3. Reconfigurar a instância novamente. Política suspensa exige remover exclusão, mesmo com flag ON. Verificar readback. Outras leases antigas da organização também precisarão de recuperação; revisão anterior nunca pode finalizar.
4. Nova intenção explícita via `requestGroupCapture` remove suspensão após resolver todas as leases. Se objetivo for ativar captura, solicitar true e reconciliar todas as instâncias.

Limite: não existe fencing token remoto documentado no Uazapi. Lease/CAS protege escritores desta aplicação; não impede alterações externas ou requests antigos que o fornecedor ainda processe. Não afirmar garantia distribuída absoluta nem ativar quando essa incerteza persiste.

## Reversão

Desligar flag, drenar escritores e reconciliar todas as instâncias gerenciadas para `excluded=false`, sem leases. Rollback SQL recusa execução enquanto houver exclusão ou estado incerto. Só então remover código e migration28 conforme plano de implantação. Reverter código primeiro permitiria que novas mudanças de preferência ignorassem a proteção.

## Verificação entregue

- 123 testes unitários em política/provider/client: contrato real do adapter, autorização admin positiva/negativa, master, parâmetros de escopo, readback incompleto/múltiplo, remoção, erro remoto e POST gerenciado sem retry.
- Integração PGlite: RLS/grants, acesso autenticado negado, escopo cruzado, token/revisão/CAS, lease antiga sem roubo, bloqueio de captura, confirmação em todas as instâncias, criação posterior, NULL fail-open, recuperação sem ativação indevida, rollback bloqueado/permitido e reapply.
- Preview real e teste canary do fornecedor ainda são gates de implantação. Nenhuma chamada de mutação ao fornecedor ocorreu durante esta implementação.
