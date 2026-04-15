---
tags:
  - torque-crm
  - operacional
created: 2026-04-14
last_updated: 2026-04-14
status: active
---

# 🔧 Solução para Erros 500

## ⚠️ Se você está vendo erros 500 no console:

Os erros 500 indicam que as políticas RLS estão bloqueando as queries. Siga estes passos:

---

## 📋 SOLUÇÃO EMERGENCIAL (Execute AGORA):

### PASSO 1: Execute o Script SQL Emergencial

1. Acesse o SQL Editor do seu projeto: `https://supabase.com/dashboard/project/SEU_PROJECT_ID/editor`
2. Clique em **"New query"**
3. Copie TODO o conteúdo do arquivo **`SOLUCAO_EMERGENCIAL_RLS.sql`**
4. Execute
5. **Verifique:** Deve mostrar seu team_member

---

### PASSO 2: Limpar Cache e Recarregar

1. No Console do navegador (F12), execute:
```javascript
localStorage.clear();
sessionStorage.clear();
location.reload();
```

2. Faça **logout** e **login** novamente

---

### PASSO 3: Verificar no Console

1. Abra o Console (F12)
2. Procure por mensagens que começam com `❌ useCurrentTeamMember: Erro ao buscar:`
3. **Me envie a mensagem completa** que aparece, especialmente:
   - `code`
   - `message`
   - `details`
   - `hint`

---

## 🔍 Diagnóstico:

### Se o erro mostrar:
- **`code: "42501"`** → Problema de permissão RLS
- **`code: "PGRST301"`** → Política RLS bloqueando
- **`message: "permission denied"`** → RLS bloqueando

**Solução:** Execute o script `SOLUCAO_EMERGENCIAL_RLS.sql`

---

### Se o erro mostrar:
- **`code: "23503"`** → Foreign key constraint (organization_id não existe)
- **`message: "foreign key"`** → Organização não encontrada

**Solução:** Execute o script `FORCAR_VINCULO_ORGANIZACAO.sql`

---

## ✅ Verificação Manual:

Execute esta query no Supabase para verificar:

```sql
-- Verificar se consegue ver seu team_member
SELECT 
  id,
  name,
  user_id,
  organization_id,
  role
FROM team_members 
WHERE user_id = auth.uid();
```

**Se retornar seu team_member com `organization_id` preenchido, está OK!**

---

## 🚨 Se AINDA não funcionar:

Execute esta query para verificar as políticas:

```sql
SELECT 
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'team_members';
```

**Me envie o resultado** para eu verificar se há políticas conflitantes.

---

## 📝 Próximos Passos:

1. Execute `SOLUCAO_EMERGENCIAL_RLS.sql`
2. Limpe cache e recarregue
3. Faça logout/login
4. Tente criar lead
5. Se ainda não funcionar, me envie:
   - Mensagem de erro completa do console
   - Resultado da query de verificação


## Links relacionados

- [[MOC - Operacional]]

- [[Gestao de Time]]

- [[Permissoes Sistema]]

- [[Dashboard]]

- [[00 - INDEX]]
