---
tags:
  - torque-crm
  - operacional
created: 2026-04-14
last_updated: 2026-04-14
status: active
---

# 🎯 Guia Completo: Criar Organização e Vincular Admin

## 🚀 Solução em 1 Passo

### Execute o Script SQL

1. **Acesse o SQL Editor:**
   - `https://supabase.com/dashboard/project/SEU_PROJECT_ID/editor`
   - Clique em **"New query"**

2. **Copie e cole TODO o conteúdo** do arquivo `CRIAR_ORGANIZACAO_ADMIN.sql`

3. **Execute o script** (Ctrl+Enter ou botão "Run")

4. **Verifique o resultado:**
   - Você verá uma tabela de verificação
   - Procure por uma linha com `status_vinculo = '✅ VINCULADO'`
   - Se aparecer, está funcionando!

---

## ✅ O que o Script Faz

1. **Cria organização** chamada "Organização Principal"
2. **Encontra automaticamente** o usuário admin (por role ou primeiro usuário)
3. **Cria ou atualiza** o team_member do admin
4. **Vincula** o team_member à organização
5. **Garante** que o usuário tem role 'admin'
6. **Mostra relatório** completo de verificação

---

## 🔍 Verificação Manual (Opcional)

Se quiser verificar manualmente, execute:

```sql
-- Ver seu team_member e organização
SELECT 
  u.email,
  tm.name,
  tm.role,
  tm.organization_id,
  o.name as org_name
FROM auth.users u
LEFT JOIN public.team_members tm ON u.id = tm.user_id
LEFT JOIN public.organizations o ON tm.organization_id = o.id
WHERE u.email = 'seu-email@exemplo.com';
```

Você deve ver:
- ✅ `organization_id` preenchido (UUID)
- ✅ `org_name` = "Organização Principal"

---

## 🔄 Depois de Executar

1. **Recarregue a página** do frontend (F5)
2. **Faça logout e login novamente** (para atualizar cache)
3. **Tente criar um lead** - deve funcionar! ✅

---

## 🐛 Se Ainda Não Funcionar

### Verificar se team_member existe:

```sql
SELECT * FROM public.team_members WHERE user_id = (
  SELECT id FROM auth.users WHERE email = 'seu-email@exemplo.com'
);
```

### Verificar se tem role admin:

```sql
SELECT * FROM public.user_roles WHERE user_id = (
  SELECT id FROM auth.users WHERE email = 'seu-email@exemplo.com'
);
```

### Verificar organização criada:

```sql
SELECT * FROM public.organizations;
```

### Se team_member não existe, criar manualmente:

```sql
-- 1. Pegar seu user_id
SELECT id FROM auth.users WHERE email = 'seu-email@exemplo.com';

-- 2. Pegar organization_id
SELECT id FROM public.organizations WHERE slug = 'organizacao-principal';

-- 3. Criar team_member (substitua os IDs)
INSERT INTO public.team_members (user_id, name, role, is_active, organization_id)
VALUES (
  'SEU_USER_ID_AQUI',
  'Seu Nome',
  'admin',
  true,
  'ORGANIZATION_ID_AQUI'
);
```

---

## 📝 Personalizar

Se quiser mudar o nome da organização, edite a linha no script:

```sql
VALUES ('SEU NOME', 'seu-slug', 'active', 'enterprise')
```

O `slug` deve ser único e sem espaços.

---

## ✅ Checklist Final

- [ ] Script executado com sucesso
- [ ] Verificação mostra "✅ VINCULADO"
- [ ] `organization_id` está preenchido
- [ ] Recarregou a página do frontend
- [ ] Fez logout e login novamente
- [ ] Consegue criar lead sem erro

Se todos os itens estão marcados, está funcionando! 🎉


## Links relacionados

- [[MOC - Features]]

- [[Gestao de Time]]

- [[Dashboard]]

- [[00 - INDEX]]
