#!/usr/bin/env python3
"""
Script para executar migration SQL diretamente no PostgreSQL do Supabase
Requer: DATABASE_URL ou SUPABASE_DB_URL no .env (connection string do PostgreSQL)
"""

import os
import sys
from pathlib import Path

root_dir = Path(__file__).parent.parent.parent

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

def main():
    """Função principal"""
    print("🚀 Executando Migration: Separação por Responsável\n")
    
    # Carregar variáveis de ambiente
    env_path = root_dir / ".env"
    env_vars = load_env_file(str(env_path))
    
    # Tentar encontrar connection string
    db_url = (
        os.getenv("DATABASE_URL") or 
        os.getenv("SUPABASE_DB_URL") or 
        env_vars.get("DATABASE_URL") or 
        env_vars.get("SUPABASE_DB_URL")
    )
    
    if not db_url:
        print("❌ Connection string do banco não encontrada")
        print("\n📝 Para executar automaticamente, você precisa:")
        print("   1. Acesse: Supabase Dashboard > Settings > Database")
        print("   2. Copie a 'Connection string' (URI mode)")
        print("   3. Adicione no .env: DATABASE_URL='postgresql://...'")
        print("\n   OU execute manualmente no Supabase SQL Editor:")
        print(f"   Arquivo: {root_dir}/ADD_USER_SEPARATION.sql")
        print(f"   URL: https://supabase.com/dashboard/project/twoghutcvlfgemadaeez/sql/new")
        sys.exit(1)
    
    # Tentar executar com psycopg2
    try:
        import psycopg2
        from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
    except ImportError:
        print("❌ Biblioteca psycopg2 não instalada")
        print("   Instale com: pip install psycopg2-binary")
        sys.exit(1)
    
    # Ler arquivo de migration
    migration_file = root_dir / "supabase" / "migrations" / "20260128000000_add_user_separation_complete.sql"
    
    if not migration_file.exists():
        print(f"❌ Arquivo de migration não encontrado: {migration_file}")
        sys.exit(1)
    
    print(f"📄 Lendo migration: {migration_file.name}")
    with open(migration_file, 'r', encoding='utf-8') as f:
        sql = f.read()
    
    print("🔌 Conectando ao banco de dados...")
    try:
        conn = psycopg2.connect(db_url)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()
        
        print("✅ Conectado! Executando migration...\n")
        
        # Executar SQL (psycopg2 executa múltiplos comandos)
        cursor.execute(sql)
        
        print("✅ Migration executada com sucesso!")
        
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Erro ao executar migration: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
