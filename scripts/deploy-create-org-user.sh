#!/usr/bin/env bash
# Faz link do projeto Supabase e deploy da Edge Function create-org-user.
# Pré-requisito: rode uma vez no terminal: supabase login

set -e
cd "$(dirname "$0")/.."
PROJECT_REF="jsjsmuncfkbsbzqzqhfq"

echo "→ Vinculando projeto Supabase (ref: $PROJECT_REF)..."
supabase link --project-ref "$PROJECT_REF"

echo "→ Fazendo deploy da Edge Function create-org-user..."
supabase functions deploy create-org-user

echo "✓ Pronto. Teste em Equipe > Criar usuário com acesso."
