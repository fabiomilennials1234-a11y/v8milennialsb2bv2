# 03 — Configurar três botões e validar todas as saídas

## What to build

Configurar até três opções no painel e conectar seus caminhos no canvas, com rascunho incompleto permitido e ativação impedida quando qualquer saída não tiver destino. Renomear ou reordenar opções não troca decisões de perguntas já enviadas.

## Acceptance criteria

- [ ] Editor oferece texto, opções nomeadas e até três botões; cada opção aparece como saída identificável e executa seu destino em teste integrado.
- [ ] Oferecer também Outra resposta, Sem resposta e Falha no envio como conexões distintas das opções visíveis ao contato.
- [ ] Todas as saídas precisam de destino antes da ativação; conectar ao Fim é encerramento válido. Rascunho incompleto pode ser salvo e reaberto.
- [ ] Servidor aplica as mesmas validações em operações diretas, incluindo teto de três, referências e saídas, sem confiar na interface.
- [ ] Adicionar, remover, renomear e reordenar opções preserva identidades corretas e sinaliza conexões afetadas; nenhuma saída é escolhida pela posição no array.
- [ ] Execução anterior conserva versão e destinos; nova execução usa nova publicação, inclusive quando rótulos foram trocados.
- [ ] Erros aparecem junto à configuração pertinente e o editor permite teclado/foco previsível; teste de navegador verifica ações e resultados, sem pular silenciosamente elementos ausentes.
- [ ] Usar limites de texto/rótulos comprovados na investigação, sem apresentar regra de outra API como contrato Uazapi.

## Blocked by

- 02 — Executar uma pergunta simples e seguir uma única escolha.
