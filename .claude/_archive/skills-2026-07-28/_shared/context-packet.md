# Context Packet (CP) — contrato entre papéis do harness

Fonte única da verdade do formato. Os papéis (`diagnosticador`, `arquiteto`, `engenheiro`, `design`, `revisor`, `qa`) carregam um contrato compacto inline; este arquivo é o detalhe quando houver dúvida.

## Problema que ele resolve

Subagentes Claude Code não compartilham contexto. Cada hop do pipeline nasce frio e re-explora o repo do zero. Medido nas sessões do harness: **197 leituras para 19 edições (10:1)** numa sessão, e **56% do wall-clock queimado dentro de subagente**. O diagnosticador lê, o engenheiro relê o mesmo arquivo, o revisor relê, o qa relê.

O CP é o pacote de estado que viaja com a task. Ele não substitui a leitura — ele **remove a releitura redundante**.

## Formato

Bloco único, no fim do output de cada papel:

```markdown
## CONTEXT PACKET — CP-v<N>

### Alvo
<arquivos/objetos DB/edge fns no escopo. Paths exatos, um por linha.>

### Mapa verificado
<`arquivo:linha` → o que é / o que faz. SÓ o que foi lido e confirmado nesta execução ou herdado de CP anterior.>

### Achados
<fatos provados, um por linha, cada um com como foi provado. "X porque query Y retornou Z".>

### Descartado
<hipótese eliminada → por que foi eliminada (evidência). Impede re-investigação.>

### Comandos que valem
<comandos exatos já validados: query SQL, npm run X, path de log, invocação de edge fn, seletor Playwright.>

### Área frágil
<Copilot | WhatsApp/Uazapi | Permissões | RLS | multi-tenant | PII | payment | auth | secrets | CORS — ou "nenhuma". Rubric de segurança exigido: sim/não.>

### Aberto
<o que NÃO foi verificado. Quem consumir precisa cobrir ou declarar fora de escopo.>

### Trilha
CP-v<N> por <papel> — <o que este papel acrescentou>
```

Pule seção vazia. Não preencha com fluff.

## Regras do consumidor

1. **Leia o CP antes de tocar o repo.** É a primeira coisa.
2. **Não releia o que está em `Mapa verificado`** só pra confirmar. Já foi confirmado.
3. **Não re-investigue o que está em `Descartado`.** A eliminação tem evidência anexada.
4. **Use `Comandos que valem`** em vez de redescobrir a query/rota/log.
5. **Discordar é permitido — com evidência nova.** Marque o item `CONTESTADO`, mostre a prova, e siga. CP errado herdado é pior que CP ausente, então contestar é dever, não atrito.
6. **`Aberto` é sua responsabilidade** se cair no seu escopo. Cubra ou declare fora de escopo explicitamente.

## Regras do emissor

1. **Anexe o CP atualizado no fim do output**, versão +1.
2. **Só entra o que você provou.** CP não é lugar de hipótese — hipótese vai no corpo do output.
3. **Enxuto.** Paths, `arquivo:linha`, fato de uma linha. Teto prático: ~60 linhas. Se passar disso, você está colando conteúdo em vez de indexar.
4. **Nunca cole código no CP.** Aponte `arquivo:linha`. O consumidor lê o trecho se precisar mexer nele.
5. **Nunca apague item herdado.** Acrescente, corrija com `CONTESTADO`, ou marque `RESOLVIDO`. O CP é append-oriented — a trilha é o valor.
6. **`Descartado` é o campo mais valioso.** Toda hipótese que você eliminou e não registrou vira re-trabalho do próximo papel.

## Custódia

O **orchestrador** é o custodiante. Ele:
- inclui o CP **verbatim** em todo brief que despacha;
- nunca deixa o CP cair entre hops;
- em fan-out paralelo, entrega o **mesmo** CP-vN para os dois papéis e **funde** os dois CPs de volta (união dos campos; conflito vira `CONTESTADO` com os dois lados);
- em loop de volta pro engenheiro, o CP vai com o feedback anexado — o engenheiro não redescobre o que o revisor/qa já mapeou.

## Anti-patterns

| Sintoma | Correção |
|---------|----------|
| CP com trechos de código colados | Aponte `arquivo:linha`; CP indexa, não armazena |
| `Descartado` vazio numa investigação longa | Registre o que eliminou — é o campo que mais poupa tempo |
| Consumidor relendo tudo "pra ter certeza" | Confie no `Mapa verificado`; conteste com evidência se duvidar |
| CP de 200 linhas | Você está dumpando. Indexe. |
| Orchestrador resumindo o CP no brief | Verbatim. Resumo perde o `arquivo:linha` que é o valor. |
| Apagar item herdado que virou falso | Marque `CONTESTADO` com a prova — a trilha importa |
