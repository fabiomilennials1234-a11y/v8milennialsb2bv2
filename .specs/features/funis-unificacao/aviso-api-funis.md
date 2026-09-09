# Aviso — API do Torque: funis unificados

> **Rascunho para envio pelo CTO.** Audiência: orgs com chave de API ativa
> (22 orgs usaram a API nos últimos 30 dias; 49 têm chave emitida).
> Canal e data de envio: decisão do CTO.

---

## Novidade na API: funil custom agora é cidadão pleno

Olá!

Concluímos uma atualização estrutural no Torque: **todo funil agora se
comporta do mesmo jeito** — os funis padrão (WhatsApp, Confirmação,
Propostas) e os funis personalizados que você cria.

**Nada quebrou.** Todas as integrações existentes continuam funcionando
exatamente como antes — os nomes antigos (`whatsapp`, `confirmacao`,
`propostas`) seguem aceitos em todos os endpoints e webhooks.

O que muda a seu favor:

- **Funil personalizado na API.** Criar e mover negócios agora funciona em
  qualquer funil, incluindo os personalizados — referencie pelo `id` (UUID)
  ou pelo `slug` do funil, nos endpoints de negócios (`POST /v1/deals`,
  move de etapa) e no webhook de entrada de leads (`place_in_pipe`).
- **Erros mais claros no move.** Ao mover um negócio para um funil que não
  existe na organização, a API responde `404`; para um funil inativo,
  `409`. Antes, esses casos falhavam de forma silenciosa ou genérica —
  agora o erro chega na hora, sem duplicar nada no retry.
- **Evento novo de webhook: `negocio.stage_changed`.** Um único evento de
  mudança de etapa que cobre qualquer funil (substitui os seis eventos
  antigos por funil, que seguem documentados como descontinuados). Assine
  esse evento para acompanhar movimentações em funis personalizados também.
- **OpenAPI atualizado.** A especificação da API já reflete tudo acima.

Nenhuma ação é necessária da sua parte. Se quiser migrar suas integrações
dos nomes antigos para o `id` do funil, pode fazer aos poucos — os dois
formatos vão continuar funcionando.

Qualquer dúvida, respondam este e-mail ou abram um chamado no Torque.

Abraço,
Equipe Torque CRM
