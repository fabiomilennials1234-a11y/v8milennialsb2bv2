# Nome do negócio e nome do lead

No painel do negócio, o lápis ao lado do título permite editar o nome do negócio.
Depois de informar o novo nome e clicar em **Salvar nome**, a pergunta
**“Deseja alterar também o nome do lead?”** oferece:

- **Só o negócio**: salva o título e preserva o nome do lead.
- **Negócio e lead**: salva o título e aplica o mesmo nome ao lead vinculado.
- **Cancelar**: descarta a edição sem salvar nenhum dos nomes.

A pergunta mostra o nome atual do lead e o nome que ele receberá. Nomes vazios
não são aceitos. Durante a gravação, os controles ficam desabilitados; se houver
falha, o texto digitado permanece disponível para nova tentativa.

O título pertence a `deals.title`; o nome da pessoa ou empresa pertence a
`leads.name`. As duas escritas são independentes. Se a alteração do negócio
funcionar, mas a do lead falhar, a tela informa esse resultado parcial e
atualiza os dados já salvos. A opção de tentar novamente continua disponível.

Cards antigos sem uma linha em `deals` reutilizam `garantir_negocio_da_entrada`:
a edição preserva a entrada existente no funil. Não há mudança de schema.
