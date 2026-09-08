---
type: changelog
title: Carregamento dos painéis de conversas e agenda do Comando
status: active
created: 2026-09-08
tags: [dashboard, agenda, fix]
owner: gabriel
---

# Carregamento dos painéis de conversas e agenda do Comando

Corrigido o transporte das RPCs de “Aguardando resposta” e “Próximas agendas”.
Os hooks extraíam `supabase.rpc` sem preservar o receptor; o SDK lançava
`Cannot read properties of undefined (reading 'rest')` antes da requisição.
Ambas as chamadas agora preservam o cliente com `bind(supabase)`.

Mantidas as regras existentes: conversas vinculadas a leads aguardando resposta
humana; próximas agendas das cinco fontes internas (reuniões, follow-ups,
mensagens agendadas, confirmação e eventos de reunião), com o recorte da RPC.
Sem mudanças nas permissões, nas funções do banco ou nas integrações externas.

Regressão reproduzida com o SDK real e HTTP simulado: três testes falharam antes
da correção e passaram depois. Suíte focada de 50 testes passou. Consultas
autenticadas de leitura das duas RPCs em produção também responderam sem erro.
Não foi realizado teste visual em sessão autenticada de usuário.
