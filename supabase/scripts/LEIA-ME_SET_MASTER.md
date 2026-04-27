# Definir gabrielgipp04@gmail.com como Master

## Passo a passo

### 1. Ter o usuário criado no Auth

O email **gabrielgipp04@gmail.com** precisa existir em **Authentication → Users** no Supabase.

- Se ainda não tiver conta: acesse o app, vá na tela de login e use **Cadastrar** com esse email (e uma senha).
- Ou no Dashboard: **Authentication** → **Users** → **Add user** → coloque o email e defina uma senha.

### 2. Abrir o SQL Editor no Supabase

1. Acesse [https://supabase.com/dashboard](https://supabase.com/dashboard).
2. Abra o **projeto** do app (o que está dando “Acesso Restrito”).
3. No menu da esquerda, clique em **SQL Editor**.

### 3. Rodar o script

1. Clique em **New query** (ou “Nova query”).
2. Abra o arquivo **`set_master_gabrielgipp04.sql`** (na pasta `supabase/scripts/` deste projeto).
3. Copie **todo** o conteúdo do arquivo.
4. Cole na query do SQL Editor.
5. Clique em **Run** (ou use Ctrl+Enter / Cmd+Enter).

### 4. Ver o resultado

- Se der **certo**: aparece uma mensagem de **Sucesso** (ou “Success”) no resultado.
- Se der **erro** “Usuário com email gabrielgipp04@gmail.com não encontrado”: o usuário ainda não existe no Auth; faça o passo 1 de novo e rode o script outra vez.

### 5. Entrar no app

1. No app, clique em **Fazer logout** (se estiver logado).
2. Feche a aba do app ou abra em aba anônima.
3. Entre de novo com **gabrielgipp04@gmail.com** e a senha que você usa nesse usuário.

Depois disso você deve entrar normalmente e ter acesso **master** (área master, se existir no menu).

---

**Resumo:** O script configura no banco o usuário com esse email como **master**, vincula à **organização** e garante **admin** na organização. Você só precisa ter o usuário criado no Auth, rodar o script no SQL Editor e fazer logout/login no app.
