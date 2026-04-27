#!/usr/bin/env python3
"""
Script para executar migration SQL no Supabase
Requer: SUPABASE_SERVICE_ROLE_KEY no .env ou variável de ambiente
"""

import os
import sys
import json
from pathlib import Path

# Adicionar diretório raiz ao path
root_dir = Path(__file__).parent.parent.parent
sys.path.insert(0, str(root_dir))

def load_env_file(env_path: str) -> dict:
    """Carrega variáveis de ambiente de um arquivo .env"""
    env_vars = {}
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    value = value.strip('"').strip("'")
                    env_vars[key] = value
    return env_vars

def execute_sql_via_api(url: str, service_key: str, sql: str) -> dict:
    """
    Tenta executar SQL via API REST do Supabase
    Nota: A API REST não suporta DDL diretamente, mas vamos tentar
    """
    import urllib.request
    import urllib.error
    
    # Para executar SQL, precisamos usar a connection string direta ou psycopg2
    # A API REST não suporta DDL (ALTER TABLE, CREATE POLICY, etc.)
    # Vamos informar o usuário que precisa executar manualmente
    return {
        "success": False,
        "message": "A API REST do Supabase não suporta execução de DDL (ALTER TABLE, CREATE POLICY, etc.). Execute manualmente no SQL Editor."
    }

def main():
    """Função principal"""
    print("🚀 Executando Migration: Separação por Responsável\n")
    
    # Carregar variáveis de ambiente
    env_path = root_dir / ".env"
    env_vars = load_env_file(str(env_path))
    
    supabase_url = os.getenv("VITE_SUPABASE_URL") or env_vars.get("VITE_SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or env_vars.get("SUPABASE_SERVICE_ROLE_KEY")
    
    if not supabase_url:
        print("❌ Erro: VITE_SUPABASE_URL não encontrado")
        sys.exit(1)
    
    if not service_key:
        print("❌ Erro: SUPABASE_SERVICE_ROLE_KEY não encontrado no .env")
        print("\n📝 Para executar a migration automaticamente:")
        print("   1. Acesse: Supabase Dashboard > Settings > API")
        print("   2. Copie a 'service_role' key (secret)")
        print("   3. Adicione no .env: SUPABASE_SERVICE_ROLE_KEY='sua_key_aqui'")
        print("\n   OU execute manualmente no Supabase SQL Editor:")
        print(f"   Arquivo: {root_dir}/ADD_USER_SEPARATION.sql")
        sys.exit(1)
    
    # Ler arquivo de migration
    migration_file = root_dir / "supabase" / "migrations" / "20260128000000_add_user_separation_complete.sql"
    
    if not migration_file.exists():
        print(f"❌ Arquivo de migration não encontrado: {migration_file}")
        sys.exit(1)
    
    print(f"📄 Lendo migration: {migration_file.name}")
    with open(migration_file, 'r', encoding='utf-8') as f:
        sql = f.read()
    
    print("⚠️  A API REST do Supabase não suporta execução de DDL (ALTER TABLE, CREATE POLICY, etc.)")
    print("📝 Execute a migration manualmente no Supabase SQL Editor:")
    print(f"   1. Acesse: {supabase_url.replace('/rest/v1', '')}/project/twoghutcvlfgemadaeez/sql/new")
    print(f"   2. Abra o arquivo: {root_dir}/ADD_USER_SEPARATION.sql")
    print("   3. Cole o conteúdo no SQL Editor")
    print("   4. Execute (Run)")
    
    sys.exit(0)

if __name__ == "__main__":
    main()
