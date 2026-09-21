# 06 — Tratar falha e reconciliar envio incerto sem duplicar

## What to build

Quando o envio falha, seguir Falha no envio com motivo claro; quando o resultado é desconhecido, reconciliar antes de repetir. O operador distingue falha comprovada, verificação em curso e aceite sem presumir entrega.

## Acceptance criteria

- [ ] Falha comprovada conclui node pela saída configurada, sem seguir Sem resposta nem converter para menu numerado.
- [ ] Timeout ou perda de resposta após possível aceite não provoca reenvio cego pelo executor, gateway ou cliente HTTP.
- [ ] Persistir tentativa e evidências de correlação suficientes para recuperar aceite após reinício; tracking não é tratado como idempotência do provedor.
- [ ] Ao recuperar aceite, preservar pergunta, prazo e vínculo de resposta corretos; não reiniciar prazo arbitrariamente pela hora de reconciliação.
- [ ] Critérios de retry/reconciliação e seu limite operacional são documentados com base no contrato observado. Esgotamento sem certeza permanece explicitamente incerto e não autoriza reenvio implícito.
- [ ] Falha tardia e resposta concorrente não geram dois resultados; estado e motivo ficam visíveis no histórico sem expor tokens ou conteúdo restrito.
- [ ] Teste integrado simula resposta HTTP perdida após aceite, falha explícita, reinício, resposta rápida e recuperação; nenhuma promessa de entrega exatamente uma vez sem suporte do provedor.
- [ ] Segurança e rate limits existentes continuam sendo aplicados em cada envio ou recuperação pertinente.

## Blocked by

- 04 — Tratar mensagens livres e vencimento sem disputar caminhos.
