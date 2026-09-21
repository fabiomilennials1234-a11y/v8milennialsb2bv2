# 08 — Duplicar e importar perguntas sem trocar opções ou ativos

## What to build

Copiar, duplicar, exportar e importar um fluxo com Pergunta com botões preservando os destinos e validando ativos e referências. Editar a cópia não modifica a original nem uma execução que já está aguardando resposta.

## Acceptance criteria

- [ ] Copiar/colar e duplicar preserva rótulos e conexões das opções e das três saídas auxiliares, sem compartilhar identidade de uma ocorrência em execução.
- [ ] Exportar/importar o contrato mantém configuração representável; servidor aplica teto, saídas obrigatórias e validação de referências.
- [ ] Imagem autorizada pode ser reutilizada conforme regra existente; importação não concede acesso a ativo de outra organização nem copia credenciais.
- [ ] Referência ausente/inacessível impede ativação com orientação clara, preservando rascunho em vez de selecionar outro recurso silenciosamente.
- [ ] Reordenar e renomear botões em fluxo novo não altera versão e caminhos de perguntas antigas; excluir destino não causa fallback por posição.
- [ ] Testes percorrem duplicação/importação até execução e resposta, complementados por editor; fluxo legado não sofre migração automática.

## Blocked by

- 05 — Enviar imagem fixa com a pergunta e seus botões.
