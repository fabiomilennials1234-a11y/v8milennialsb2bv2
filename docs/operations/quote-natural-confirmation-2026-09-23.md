# Orçamento: confirmação natural e entrega

## Comportamento

- O cliente confirma o resumo com “sim”, “confirmo” ou “pode fechar”; não informa ID/código.
- Backend resolve o orçamento da organização, agente, lead e conversa autenticados.
- Resumo inclui SKU, variante, quantidades, preço unitário, ajustes e total calculado.
- Cada apresentação tem ocorrência própria e associação aos IDs dos chunks enviados.
- Geração exige evidência de aceitação de todos os chunks anterior ao inbound original.
- Saídas inicialmente queued recebem evidência pelo echo/ReadReceipt posterior. Callbacks são idempotentes.
- Eventos com ordem temporal ambígua falham fechados: reapresentar o resumo, sem alterar dados comerciais.
- Confirmação determinística não chama save nem depende de identificadores gerados pelo LLM.
- Mudanças apenas de plural nas descrições de palhetas não criam outra revisão.
- Arquivo final respeita PDF/Word configurado. Enfileiramento não é comprovação de entrega.
- CAS protege geração/entrega; resultado ambíguo do provedor exige reconciliação, não reenvio automático.

## Verificação

163 testes focados em 13 arquivos aprovados em 23/09/2026. Incluem natural confirmation,
evidência temporal, callbacks antes/depois da associação, callbacks concorrentes, todos os
chunks, tenant/instância/revisão incorretos, concorrência de workers e allowlist.

Deno check dos helpers novos, webhook e batch processor aprovado. Check completo de
agent-message/index e process-ai-actions apresenta 41 erros de tipagem também reproduzidos
no checkout limpo de origin/main (48dbd238), sem aumento. Lockfile da main está divergente
do package.json; check feito com --no-lock sem alterar dependências.

Os testes usam doubles de storage, renderer e provedor: não comprovam entrega real ao cliente.
CI remoto estava indisponível por cobrança; registrar estado efetivo no PR antes do merge.

## Publicação autorizada

1. Revisão independente aprovada e PR integrado na main (sem push direto).
2. Publicar agent-message, process-ai-actions, copilot-batch-processor e whatsapp-webhook.
3. Verificar versões/fontes publicadas; não há migração ou alteração do serviço Word/PDF.
4. Atualizar somente as instruções legadas de confirmação no prompt da Julia/Hoppe,
   preservando preços, dados obrigatórios, Pix, regras comerciais e estado de ativação.
5. Manter COPILOT_QUOTE_LIVE_SEND_ENABLED=false; liberar a Hoppe em
   COPILOT_QUOTE_LIVE_SEND_ORG_IDS. Demais organizações continuam bloqueadas por padrão.
6. Solicitar um novo resumo ao cliente de teste e confirmar depois de recebido. Resumos
   anteriores à publicação não têm evidência durável; não reutilizar confirmação antiga.

## Contenção e rollback

Retirar somente a Hoppe da allowlist para impedir novos envios de documentos. Não reenviar
revisões sending/reconcile sem conferir o provedor. Em regressão, reverter o PR pela main
e republicar as quatro funções; restaurar o prompt anterior somente com conferência de
versão para não sobrescrever edições posteriores. Não apagar histórico, pedidos ou arquivos.
