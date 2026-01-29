# Verificação de email (Auth)

## ⚠️ Se você desativou "Confirm email" e não consegue mais entrar

**Reverter e recuperar acesso:**

1. **Voltar a configuração:** No [Dashboard Supabase](https://supabase.com/dashboard) → seu projeto → **Authentication** → **Providers** → **Email**:
   - Ative de novo **"Confirm email"** (Enable email confirmations).
   - Confirme que o provedor **Email** está **habilitado** (não desative o provider inteiro).
   - Salve.

2. **Recuperar seu usuário:** Em **Authentication** → **Users**:
   - Encontre seu usuário pelo email.
   - Abra o usuário e confira se o email está marcado como **confirmado** (Email confirmed).
   - Se não estiver: use a opção para **confirmar o email manualmente** (ou "Confirm user").
   - Se precisar: use **"Send password reset"** para receber um link e redefinir a senha no navegador.

3. **Limpar cache do navegador:** Feche todas as abas do app, limpe dados do site (ou use uma janela anônima) e tente fazer login de novo com email e senha.

Depois disso você deve conseguir entrar de novo. Para o SDR, use o passo "Usuário SDR que já foi criado" abaixo em vez de desativar o Confirm email para todos.

---

## Desativar verificação de email para SDR/equipe interno (opcional)

O sistema **não exige** que o usuário clique no link de verificação de email para entrar. O controle de acesso continua sendo feito **só internamente**:

- **Conta ativa**: usuário em `team_members` com `is_active`
- **Organização**: `organization_id` válida
- **Subscription/plano**: `SubscriptionProtectedRoute` e `src/lib/subscription.ts` checam plano ativo, trial, expiração

### Projeto hospedado (Supabase Cloud)

1. Acesse o [Dashboard do Supabase](https://supabase.com/dashboard) e abra seu projeto.
2. Vá em **Authentication** → **Providers** → **Email**.
3. Desative a opção **"Confirm email"** (ou "Enable email confirmations").
4. Salve.

A partir daí, novos usuários (incluindo SDR criados por você) poderão fazer login com email e senha sem precisar clicar em nenhum link no email.

### Usuário SDR que já foi criado e está “pendente de verificação”

Para esse usuário específico poder entrar **sem** clicar no email:

1. No Dashboard: **Authentication** → **Users**.
2. Localize o usuário (SDR) pelo email.
3. Abra o usuário e use a opção para **confirmar o email** manualmente (por exemplo, “Confirm email” ou editar e marcar email como confirmado, conforme a interface do Supabase).

Depois disso, o SDR pode fazer login normalmente com a senha que foi definida (ou pela que ele definir no primeiro acesso, se for fluxo de invite).

### Ambiente local (Supabase CLI)

O arquivo `supabase/config.toml` já contém:

```toml
[auth.email]
enable_confirmations = false
```

Assim, em `supabase start` a confirmação de email já fica desativada localmente.

---

**Resumo:** A verificação de email no Auth pode ser desligada. O acesso continua sendo controlado pela aplicação (conta ativa, organização e plano/subscription).
