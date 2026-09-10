# Ticket 20 — migração explícita do legado

## Fronteira operacional

Abrir uma automação legada executa somente leituras. O editor inventaria cada
condição e mostra Antes, Novo e a diferença semântica. A definição em
`workflows.definition`, a ativação e execuções existentes não são modificadas.

`Criar rascunho para revisão` é a primeira escrita. Ela usa
`save_guided_workflow_draft_with_settings` com revisão esperada zero e cria o
draft separado na automação existente. Não cria grant, publicação ou versão.
Conflito significa que outra pessoa iniciou a revisão; o cliente recarrega o
draft vencedor.

Publicação continua passando pela validação completa, autorização explícita e
finalizador versionado. Execuções criadas antes da primeira publicação mantêm
`guided_version_id = null` e continuam no contrato legado; não recebem versão
histórica fabricada. Retry legado preserva `null`. Execuções novas, depois da
publicação, recebem a versão publicada pelo trigger de pinagem imutável.

## Inventário e transformação

| Legado | Rascunho proposto | Tratamento |
|---|---|---|
| Nome, empresa, email, telefone, segmento, urgência, faturamento e UTM | Campo guiado equivalente | Mostra que a nova comparação também ignora acentos |
| Score ou valor do negócio | Número tipado | Mostra que ausência deixa de ser zero; valor passa a usar o negócio exato do gatilho |
| Está vazio / preenchido | Operador sem valor | Mantém vazio separado de zero e texto |
| Tag por nome | Tag sem `tagId` | Exige seleção do cadastro atual; homônimo não prova identidade |
| Origem por slug/texto | Origem sem `originId` | Exige seleção por identidade, salvo vazio/preenchido |
| Custom por nome | Campo sem `fieldId` | Exige seleção do UUID e confirmação do tipo |
| Etapa por key, nome ou UUID isolado | Funil e etapa vazios | Exige seleção do par canônico |
| `sdr_id` / responsável genérico | Função e pessoa vazias | Exige escolha entre pré-vendas e vendas e depois UUID |
| Regex, listas e capacidade sem equivalente | Regra guiada incompleta | Não promete conversão; exige reconstrução |
| `time_window` pausante | Permanece legado | Bloqueia publicação guiada até redesenho explícito com Janela Comercial |

Saídas antigas reconhecíveis (`true/false`, `yes/no`, `a/b`) viram `yes/no` no
draft. IDs de nodes e edges permanecem porque o rascunho é nova versão da mesma
automação; IDs internos das novas regras são gerados de novo.

## Exemplos

- `name contains ÁGUA` vira `lead.name contains ÁGUA`, com aviso de que `agua`
  também passa a casar.
- `score equals 0` vira número zero, com aviso de que ausência não é mais zero.
- `tags has_tag VIP` mantém “VIP” apenas como pista visual; `tagId` nasce vazio.
- `stage in_stage proposta` não escolhe uma etapa homônima; funil e etapa nascem
  vazios.
- regex `^ind` não vira `contém ind`.
- horário 08:00–18:00 continua pausando somente na execução legada. O novo
  condicional nunca passa a esperar.

Não há schema ou migration nova. O ticket usa draft, versão, autorização e
pinagem já entregues.
