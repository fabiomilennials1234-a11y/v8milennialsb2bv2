# Ticket 19 — portabilidade de árvores de condições

## Identidades internas

Copiar, colar, duplicar ou importar gera IDs novos para cada node, edge, grupo e
regra. A recursão alcança grupos aninhados e os filhos de `business_exists`.
Operadores, combinação E/OU, ciclo, datas, expressões, posição e conexões mantêm
seu significado. `goto` e edges apontam para os novos IDs internos.

## Referências da organização

Exportação move referências para `externalReferences` e deixa o grafo sem uma
identidade reutilizável. Importação repete a sanitização; arquivo adulterado não
contorna a regra. Referências guiadas cobertas:

- tag, origem e responsáveis;
- campo personalizado e opção de campo select;
- funil e etapa, inclusive dentro de `business_exists`;
- caixa de WhatsApp ou canal em todos os quatro tipos de condição por conversa;
- produto nas três relações comerciais.

Configuração do gatilho também limpa funis e etapas. Texto livre, números, datas,
expressões e relações sem cadastro permanecem porque não identificam recurso do
tenant.

## Importação e autorização

Importação usa `create_guided_workflow_draft_with_settings`: cria atomicamente um
workflow shell inativo e um draft separado na organização autenticada. Gera novo
workflow UUID. O destino não recebe publicação, versão ativa nem `workflow_data_grants`.
Arquivos legados sem árvore guiada preservam o caminho de importação inativa já
existente; o relatório identifica os dois modos e apresenta a mensagem correta.

Dependências aparecem no relatório como pendentes. O editor mostra seletores
vazios, exigindo escolha explícita no destino. Enquanto alguma referência falta,
o contrato guiado é inválido e o endpoint público recusa publicação. Aprovação de
dados ocorre depois, pelo fluxo normal da organização destino.

Exportação pela lista lê o draft atual, evitando baixar o shell vazio. Exportação
pelo editor usa a árvore que está na tela, incluindo mudanças ainda não salvas.

Não há mudança de schema neste ticket. A RPC atômica e suas regras de autorização
já existem; portanto não há migration ou rollback novo.
