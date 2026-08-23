# Os guardrails do disparo oficial são dinheiro, ritmo observado e tier descoberto

**Status:** accepted (2026-08-21)

Companheiro do ADR-0028 (motor). Estende ADR-0003 (Orçamento Diário de Disparo).

## Context

No chip, o que se protege é o número: o risco é ban, e os guardrails existentes falam essa língua — teto de pessoas por dia, jitter para parecer humano, quarentena por sinal de reputação. No canal oficial nada disso é o risco. Ninguém está fingindo ser humano numa API declarada, e o número não é banido: a conta é **cobrada**, e a conta é **rebaixada**.

O que a documentação da Meta e do NotificaMe diz, lido em 2026-08-21:

- **Preço no Brasil, por mensagem entregue**: marketing **R$ 0,3217**, utility **R$ 0,0350**, e utility entregue **dentro** da janela de 24 horas é **grátis**. Marketing custa **9,2×** utility e **não tem desconto por volume em nenhum patamar** (`tier_list` vazia na tabela de preços). Um disparo de 235 pessoas custa R$ 75,60 em marketing e R$ 8,22 em utility.
- **Quem classifica o template é a Meta, não quem o escreve.** Desde 09/04/2025, template submetido como utility que ela julgue marketing é **aprovado como marketing**; e desde 16/04/2025, depois de um aviso de uso indevido, **a mudança de categoria é instantânea, sem as 24 horas de cortesia**. Um template aprovado hoje pode ser cobrado como marketing amanhã sem ninguém editar nada.
- **O limite de envio é do portfólio de negócio, não do número**: 250 → 2.000 → 10.000 → 100.000 → ilimitado, contando destinatários únicos fora da janela num período móvel de 24 horas. Adicionar número não multiplica cota. O critério de **rebaixamento não está documentado em página nenhuma** — a máquina de estados antiga (Flagged/Restricted) foi descontinuada em 07/10/2025 e nada a substituiu.
- **O NotificaMe não expõe o tier.** O endpoint `/v2/meta/health_status` devolve `quality_rating` (verde/amarelo/vermelho) e o nível de throughput, e **não** devolve o messaging limit. Saber o tier exige WhatsApp Manager ou Graph API direto.
- **O NotificaMe não publica rate limit algum.** A tabela de erros dele tem cinco linhas — 400, 401, 404, 409, 500 — e **não existe um 429**. Do lado da Meta, o teto é 80 mensagens/s por número, e a política de retentativa recomendada **não existe**: a doc diz "tente mais tarde", sem número. A única espera quantificada em toda a documentação é a do erro 131049: 24 horas.
- **Opt-out**: a política exige respeitar pedidos de saída **dentro e fora** do WhatsApp. Quando o usuário desliga "ofertas e novidades" pelo lado dele, a API **aceita a requisição e não entrega**, devolvendo o erro **131050**. Botão de descadastro no template não é exigido por nenhuma página.

Medição em produção (2026-08-21): a tabela `consent_records` existe, com `lead_id`, `granted`, `granted_at`, `revoked_at`, `source`, `ip_address` e `user_agent` — e tem **zero linhas**. Foi construída para a chamada de voz e nunca ganhou um produtor.

## Decisões

1. **A trava de conteúdo é um Teto de Gasto em dinheiro, não uma allowlist de categoria.** Qualquer template aprovado pode ser disparado; a tela mostra a categoria vigente, o preço unitário e o total estimado antes da confirmação. O limite que recusa é em reais, por disparo e por dia.

   O motivo é que a allowlist não protege: proibir marketing não impede que o utility de hoje seja reclassificado como marketing amanhã, instantaneamente e sem aviso. Uma regra escrita em categoria não limita gasto nenhum — dá a sensação de limitar. Avaliado e descartado permitir apenas utility (empurraria a cliente de volta ao chip, que é o canal com risco de ban, para fazer exatamente o que ela quer fazer) e exigir aprovação de admin a cada disparo promocional (atrito em toda campanha, e contraria o ADR-0002, cujo guardrail declarado é teto e não permissão).

   O Teto de Gasto **convive** com o Orçamento Diário de Disparo e mede outra coisa: aquele conta pessoas por dia para proteger um chip de ban; este conta dinheiro para proteger a Organization de uma fatura que ela não pretendia.

2. **O ritmo é adaptativo entre um piso e um teto, não um número fixo.** O worker começa no piso, sobe enquanto as entregas voltam limpas e recua ao primeiro sinal ruim. Um número fixo escolhido hoje estaria errado amanhã e ninguém o revisitaria.

   Ressalva registrada porque afeta a implementação: o sinal de erro do fornecedor é ruim. Não há 429; o que existe é um `INTERNAL_ERROR` 500 genérico que eles mesmos retentam. Portanto o recuo dispara em **qualquer 5xx e em qualquer erro de limite da Meta**, não num código específico — mais tosco que um controle adaptativo clássico, e é o que a fonte permite.

3. **A qualidade é lida; o tier é descoberto pelo erro.** Antes de cada disparo e periodicamente durante, o produto consulta `health_status`: em **vermelho** o disparo não parte, e pausa se já estiver correndo; em **amarelo**, avisa e segue. O messaging limit não é legível pelo NotificaMe, então o estouro do teto de 24 horas se manifesta como erro da Meta — e a resposta é suspender e retomar no dia seguinte, o que o Plano de Disparo já sabe fazer, porque já fatia público grande em lotes diários.

   Descartado pedir à cliente que informe o tier na configuração: é um número que ela preenche errado ou preenche uma vez e nunca mais, enquanto o tier sobe sozinho quando a conta se comporta — viraria um teto fixo estrangulando uma conta que já podia mandar dez vezes mais.

4. **Existe uma Lista de Supressão, e ela tem três produtores reais.** Todo disparo filtra contra ela, independentemente do Público. Ela é alimentada pelo erro **131050** devolvido pela Meta (supressão automática; nunca retentar), por **pedido de saída no inbound** — que o webhook já lê integralmente — e por **marcação manual** no lead. `consent_records` passa a ser o registro auditável, com origem e momento da revogação.

   Avaliado e descartado exigir opt-in previamente registrado para disparar: com zero registros em produção, isso travaria 100% dos disparos de todas as Organizations no dia um, até alguém construir a coleta e refazer a base — impedir o produto de existir para proteger de um risco que a Meta já pune por outro caminho. Descartado também não construir nada e confiar na Meta: ela bloqueia quem desligou marketing pelo lado dela, mas não sabe de quem pediu para sair **por mensagem**, que é como se pede de verdade — e é exatamente esse pedido ignorado que derruba o quality rating, que por sua vez trava o upgrade de tier.

## Consequências

- Erros de envio deixam de ser texto e viram decisões: 131050 suprime para sempre, 131049 espera 24 horas, 132015 sinaliza template pausado por qualidade e 132016 é irrecuperável, 131042 (falha de pagamento) para a campanha inteira.
- `consent_records` deixa de ser um gate sem produtor.
- A economia do produto depende de manter template em utility sempre que for legítimo, e a reclassificação silenciosa da Meta é um **risco de margem**, não de compliance: merece alarme, não só registro.
