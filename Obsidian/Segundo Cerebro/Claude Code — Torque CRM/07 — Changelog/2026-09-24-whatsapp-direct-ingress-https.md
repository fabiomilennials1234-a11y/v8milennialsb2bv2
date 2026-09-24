---
type: changelog
title: WhatsApp direto — HTTPS preparado, migração pendente
status: active
created: 2026-09-24
updated: 2026-09-24
tags: [whatsapp, ingress, uazapi, capacity]
owner: gabriel
---

# HTTPS do ingress WhatsApp preparado

DNS A de `ingress.torquecrm.com.br` aponta para `46.202.148.241` com TTL 300s.
Certificado TLS real foi emitido em 24/09/2026 e vence em 23/12/2026. Rota
Traefik vive em `services/whatsapp-ingress/deploy/traefik.yaml`, separada da
configuração gerada pelo EasyPanel. O overlay exige alias
`torque-whatsapp-ingress` após qualquer recriação de container. Access logs da
rota não registram URLs que carregam segredo.

Sondas iniciais pelo HTTPS público: `/health` 200 e `/worker-health` 200;
`/ready` 503, como esperado com admissão direta desligada. Às20:17UTC, saúde da
fila passou a 503 `dead_letter`: 204 concluídos,40 pendentes, um dead letter,
nenhum processing/lease vencido e controle não pausado na revisão6. A drenagem
anterior foi real, mas não representa o estado atual. O novo head observado é
`FileDownloaded` com `IsFromMe=false`, sem campos de mutação comercial; mensagem
exata já tem media URL. SQL37 e regra TypeScript ainda em preparo, não aplicadas.
Nova opção de roteamento está
preparada em código, desligada por padrão: após autenticação e resolução da
instância, `messages`/`connection` são encaminhados à origem Edge fixa e
`messages_update` à inbox durável. A nova imagem e a troca da URL do fornecedor
**ainda não foram implantadas**. Ambiente do guard salvo às20:17:39UTC apenas
para o UUID piloto, com presença/digest conferidos. Probe real de rebind
respondeu401; isso não comprova o 409 esperado. Nenhuma alteração do fornecedor
foi confirmada.
Nenhuma economia Edge decorre deste preparo.

O próximo passo é ensaio público de roteamento, commit antes do ACK, falhas de
banco/rede/host, carga do piloto e rollback; depois, readback de todas as rotas
e atualização única da URL do webhook existente, preservando ID, eventos,
filtros e flags. Manter Edge e fila disponíveis para retorno. A VPS passa a ser
dependência de disponibilidade também dos eventos encaminhados ao Edge.

Uazapi não garante repetição automática de entrega HTTP malsucedida em
`messages_update`. A mesma lacuna pré-commit existe na rota Edge atual; não é
veto absoluto a piloto limitado, mas impede promessa de perda zero. Recuperação
parcial só confirma delivered/read para saídas conhecidas e não recompõe ordem
de edições, exclusões, reações ou pins. Meta 1,4M mensal permanece projeção.

Estado detalhado: `docs/operations/whatsapp-direct-route-next-gates-2026-09-24.md`.
