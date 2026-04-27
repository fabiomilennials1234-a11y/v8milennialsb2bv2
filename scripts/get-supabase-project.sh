#!/bin/bash

# Script para buscar Project ID do Supabase via API
# Requer: Personal Access Token do Supabase

echo "🔍 Buscando projeto 'torque | crm' no Supabase..."

# Verificar se o token foi fornecido
if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  echo "❌ Erro: Variável SUPABASE_ACCESS_TOKEN não definida"
  echo ""
  echo "Como obter o token:"
  echo "1. Acesse https://supabase.com/dashboard/account/tokens"
  echo "2. Crie um Personal Access Token"
  echo "3. Execute: export SUPABASE_ACCESS_TOKEN='seu-token-aqui'"
  echo "4. Execute este script novamente"
  exit 1
fi

# Buscar projetos
RESPONSE=$(curl -s -X GET 'https://api.supabase.com/v1/projects' \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json")

# Verificar se a requisição foi bem-sucedida
if echo "$RESPONSE" | grep -q '"error"'; then
  echo "❌ Erro na API do Supabase:"
  echo "$RESPONSE" | jq -r '.error.message' 2>/dev/null || echo "$RESPONSE"
  exit 1
fi

# Buscar o projeto específico
PROJECT=$(echo "$RESPONSE" | jq -r '.projects[] | select(.name == "torque | crm" or .name == "torque|crm" or .name | contains("torque")) | {id: .id, name: .name, ref: .ref, region: .region}')

if [ -z "$PROJECT" ] || [ "$PROJECT" = "null" ]; then
  echo "❌ Projeto 'torque | crm' não encontrado"
  echo ""
  echo "Projetos disponíveis:"
  echo "$RESPONSE" | jq -r '.projects[] | "  - \(.name) (ID: \(.id), Ref: \(.ref))"'
  exit 1
fi

echo "✅ Projeto encontrado!"
echo ""
echo "$PROJECT" | jq '.'
echo ""
echo "📋 Informações:"
echo "$PROJECT" | jq -r '"Project ID: \(.id)\nProject Ref: \(.ref)\nRegion: \(.region)"'
