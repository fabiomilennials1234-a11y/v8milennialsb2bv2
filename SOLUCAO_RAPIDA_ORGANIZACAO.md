# 🚀 Solução Rápida: Vincular Usuário à Organização

## ❌ Erro Atual
```
Você precisa estar vinculado a uma organização. Entre em contato com o administrador.
```

## ✅ Solução em 3 Passos

### Passo 1: Acessar SQL Editor
1. Abra o SQL Editor do seu projeto Supabase: `https://supabase.com/dashboard/project/SEU_PROJECT_ID/editor`
2. Clique em **"New query"**

### Passo 2: Executar o Script
Copie e cole TODO o conteúdo do arquivo `VINCULAR_ORGANIZACAO.sql` e execute.

O script vai:
- ✅ Criar uma organização chamada "Minha Empresa"
- ✅ Vincular automaticamente TODOS os team_members que não têm organização
- ✅ Mostrar um relatório de verificação

### Passo 3: Verificar
Após executar, você deve ver na última query uma tabela mostrando:
- Seu nome
- Seu email
- **organization_name**: "Minha Empresa" ✅
- **organization_id**: um UUID ✅

Se ambos estiverem preenchidos, está funcionando!

---

## 🔄 Depois de Executar

1. **Recarregue a página** do frontend (F5)
2. **Faça logout e login novamente** (para atualizar o cache)
3. **Tente criar um lead** - deve funcionar agora! ✅

---

## 🐛 Se Ainda Não Funcionar

Execute esta query para verificar:

```sql
-- Verificar seu team_member
SELECT 
  tm.id,
  tm.name,
  tm.role,
  u.email,
  tm.organization_id,
  o.name as org_name
FROM public.team_members tm
LEFT JOIN auth.users u ON tm.user_id = u.id
LEFT JOIN public.organizations o ON tm.organization_id = o.id
WHERE u.email = 'seu-email@exemplo.com';
```

Se `organization_id` estiver NULL, execute novamente o script `VINCULAR_ORGANIZACAO.sql`.

---

## 📝 Personalizar Nome da Organização

Se quiser mudar o nome da organização, edite a primeira linha do script:

```sql
INSERT INTO public.organizations (name, slug, subscription_status, subscription_plan)
VALUES ('SEU NOME AQUI', 'seu-slug-aqui', 'active', 'pro')
```

O `slug` deve ser único e sem espaços (use hífens).
