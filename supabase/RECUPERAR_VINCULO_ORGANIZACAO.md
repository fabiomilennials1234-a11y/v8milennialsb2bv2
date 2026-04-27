# Recuperar vínculo com organização ("Acesso Restrito")

Quando aparece **"Sua conta não está vinculada a nenhuma organização"**, significa que no banco não existe um registro em `team_members` com seu `user_id` **e** com `organization_id` preenchido (ou o registro não existe).

Isso pode ter acontecido se:
- Você entrou com outro usuário (ex.: o SDR que criou) que ainda não foi vinculado à organização
- O registro em `team_members` foi apagado ou o `organization_id` ficou nulo
- Após alterações no Supabase (Auth/Users), o vínculo foi perdido

## Como corrigir (Supabase Dashboard)

Use o **SQL Editor** do projeto no [Dashboard do Supabase](https://supabase.com/dashboard) (não precisa estar logado no app).

### 1. Descobrir seu `user_id` e uma organização

Rode no **SQL Editor** (substitua o email pelo seu):

```sql
-- Seu usuário no Auth
SELECT id AS user_id, email FROM auth.users WHERE email = 'SEU_EMAIL_AQUI@exemplo.com';

-- Organizações existentes (pegue o id de uma delas)
SELECT id AS organization_id, name FROM public.organizations ORDER BY created_at LIMIT 5;
```

Anote:
- `user_id` (id do seu usuário em `auth.users`)
- `organization_id` (id de uma organização, em geral a primeira)

### 2. Ver o que existe em `team_members` para você

```sql
-- Troque 'SEU_USER_ID' pelo user_id anotado acima
SELECT id, user_id, organization_id, name, role, is_active
FROM public.team_members
WHERE user_id = 'SEU_USER_ID';
```

- Se **não retornar nenhuma linha**: seu usuário não tem registro em `team_members` → vá para o passo 3a.
- Se **retornar uma linha com `organization_id` em branco (NULL)** → vá para o passo 3b.

### 3a. Inserir seu vínculo (quando não existe linha em `team_members`)

Substitua:
- `SEU_USER_ID` = id do passo 1
- `ORGANIZATION_ID` = id da organização do passo 1
- `Seu Nome` = seu nome (ex.: "Admin" ou nome completo)
- `admin` = use `admin` se você for o dono, ou `closer`/`sdr` conforme o caso

```sql
INSERT INTO public.team_members (
  user_id,
  organization_id,
  name,
  role,
  is_active
) VALUES (
  'SEU_USER_ID',
  'ORGANIZATION_ID',
  'Seu Nome',
  'admin',
  true
);
```

Se a tabela exigir `email`, adicione também (troque o email):

```sql
INSERT INTO public.team_members (
  user_id,
  organization_id,
  name,
  role,
  is_active,
  email
) VALUES (
  'SEU_USER_ID',
  'ORGANIZATION_ID',
  'Seu Nome',
  'admin',
  true,
  'seu_email@exemplo.com'
);
```

### 3b. Só preencher `organization_id` (quando a linha já existe mas está sem organização)

Substitua `SEU_USER_ID` e `ORGANIZATION_ID`:

```sql
UPDATE public.team_members
SET organization_id = 'ORGANIZATION_ID', updated_at = now()
WHERE user_id = 'SEU_USER_ID';
```

### 4. (Opcional) Garantir que você é admin

Se você for o dono da organização e precisar de role admin:

```sql
-- Troque SEU_USER_ID
INSERT INTO public.user_roles (user_id, role)
VALUES ('SEU_USER_ID', 'admin')
ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
```

(Se der erro de constraint única, use só o `UPDATE` ou ajuste para a constraint que existir em `user_roles`.)

### 5. Testar no app

1. Feche todas as abas do app (ou use aba anônima).
2. Acesse de novo e faça login com seu email e senha.
3. A mensagem "Acesso Restrito" deve sumir e você deve entrar na organização.

---

**Resumo:** O app exige um registro em `team_members` com seu `user_id` e um `organization_id` válido. Corrigindo isso no banco (insert ou update), o vínculo volta e o acesso restrito some.
