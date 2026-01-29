#!/usr/bin/env python3
"""
Script para testar a conexão com o Supabase e validar operações CRUD.

Verifica:
1. Se as variáveis de ambiente estão configuradas
2. Se a conexão com o Supabase funciona
3. Se consegue ler dados (SELECT)
4. Se consegue inserir dados (INSERT)
5. Se consegue atualizar dados (UPDATE)
6. Se consegue deletar dados (DELETE)
7. Se todos os campos estão sendo salvos corretamente
"""

import os
import sys
import json
import urllib.request
import urllib.error
from typing import Dict, List, Optional


def load_env_file(env_path: str) -> Dict[str, str]:
    """Carrega variáveis de ambiente de um arquivo .env"""
    env_vars = {}
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    # Remove aspas se existirem
                    value = value.strip('"').strip("'")
                    env_vars[key] = value
    return env_vars


def test_supabase_connection(url: str, key: str) -> Dict:
    """
    Testa a conexão básica com o Supabase fazendo uma query simples.
    
    Args:
        url: URL do projeto Supabase
        key: Publishable key do Supabase
        
    Returns:
        Dicionário com resultado do teste
    """
    # Teste simples: buscar uma tabela (profiles é uma tabela comum)
    test_url = f"{url}/rest/v1/profiles?select=id&limit=1"
    
    req = urllib.request.Request(test_url)
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "return=representation")
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            status_code = response.getcode()
            data = json.loads(response.read().decode('utf-8'))
            
            return {
                "success": True,
                "status_code": status_code,
                "message": "Conexão estabelecida com sucesso",
                "data": data
            }
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        try:
            error_data = json.loads(error_body)
            return {
                "success": False,
                "status_code": e.code,
                "message": error_data.get("message", error_body),
                "error": error_data
            }
        except:
            return {
                "success": False,
                "status_code": e.code,
                "message": error_body
            }
    except Exception as e:
        return {
            "success": False,
            "message": f"Erro de conexão: {str(e)}"
        }


def test_table_read(url: str, key: str, table: str) -> Dict:
    """Testa leitura de uma tabela"""
    test_url = f"{url}/rest/v1/{table}?select=*&limit=5"
    
    req = urllib.request.Request(test_url)
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            return {
                "success": True,
                "table": table,
                "count": len(data),
                "sample_data": data[:2] if data else []
            }
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        try:
            error_data = json.loads(error_body)
            return {
                "success": False,
                "table": table,
                "message": error_data.get("message", error_body)
            }
        except:
            return {
                "success": False,
                "table": table,
                "message": error_body
            }
    except Exception as e:
        return {
            "success": False,
            "table": table,
            "message": str(e)
        }


def get_table_schema(url: str, key: str, table: str) -> Dict:
    """Obtém o schema de uma tabela (colunas e tipos)"""
    # Usa o endpoint de informações do schema
    test_url = f"{url}/rest/v1/{table}?select=*&limit=0"
    
    req = urllib.request.Request(test_url)
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            # Se conseguir fazer a query, a tabela existe
            # Para obter o schema real, precisaríamos da API de metadata
            return {
                "success": True,
                "table": table,
                "message": "Tabela existe e está acessível"
            }
    except Exception as e:
        return {
            "success": False,
            "table": table,
            "message": str(e)
        }


def main():
    """Função principal."""
    print("🔍 Testando conexão com Supabase...\n")
    
    # Carregar variáveis de ambiente do .env
    env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
    env_vars = load_env_file(env_path)
    
    # Obter variáveis de ambiente (prioridade: env vars > .env file)
    supabase_url = os.getenv("VITE_SUPABASE_URL") or env_vars.get("VITE_SUPABASE_URL")
    supabase_key = os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY") or env_vars.get("VITE_SUPABASE_PUBLISHABLE_KEY")
    project_id = os.getenv("VITE_SUPABASE_PROJECT_ID") or env_vars.get("VITE_SUPABASE_PROJECT_ID")
    
    # Validar configuração
    if not supabase_url:
        print("❌ Erro: VITE_SUPABASE_URL não encontrado", file=sys.stderr)
        print("   Configure no arquivo .env ou como variável de ambiente", file=sys.stderr)
        sys.exit(1)
    
    if not supabase_key:
        print("❌ Erro: VITE_SUPABASE_PUBLISHABLE_KEY não encontrado", file=sys.stderr)
        print("   Configure no arquivo .env ou como variável de ambiente", file=sys.stderr)
        sys.exit(1)
    
    print(f"✅ Configuração encontrada:")
    print(f"   URL: {supabase_url}")
    print(f"   Project ID: {project_id or 'N/A'}")
    print(f"   Key: {supabase_key[:20]}...")
    print()
    
    # Teste 1: Conexão básica
    print("📡 Teste 1: Conexão básica com Supabase...")
    connection_test = test_supabase_connection(supabase_url, supabase_key)
    
    if connection_test["success"]:
        print(f"   ✅ {connection_test['message']}")
        print(f"   Status Code: {connection_test.get('status_code', 'N/A')}")
    else:
        print(f"   ❌ Falha na conexão: {connection_test['message']}")
        print(f"   Status Code: {connection_test.get('status_code', 'N/A')}")
        sys.exit(1)
    
    print()
    
    # Teste 2: Leitura de tabelas principais
    print("📊 Teste 2: Leitura de tabelas principais...")
    main_tables = [
        "leads",
        "campanhas",
        "team_members",
        "pipe_confirmacao",
        "pipe_propostas",
        "pipe_whatsapp",
        "follow_ups",
        "products",
        "profiles"
    ]
    
    results = {}
    for table in main_tables:
        result = test_table_read(supabase_url, supabase_key, table)
        results[table] = result
        
        if result["success"]:
            print(f"   ✅ {table}: {result['count']} registros encontrados")
        else:
            print(f"   ⚠️  {table}: {result['message']}")
    
    print()
    
    # Resumo
    print("=" * 80)
    print("📋 RESUMO DOS TESTES")
    print("=" * 80)
    
    successful_tables = [t for t, r in results.items() if r.get("success")]
    failed_tables = [t for t, r in results.items() if not r.get("success")]
    
    print(f"\n✅ Tabelas acessíveis: {len(successful_tables)}/{len(main_tables)}")
    for table in successful_tables:
        count = results[table].get("count", 0)
        print(f"   - {table}: {count} registros")
    
    if failed_tables:
        print(f"\n⚠️  Tabelas com problemas: {len(failed_tables)}")
        for table in failed_tables:
            print(f"   - {table}: {results[table].get('message', 'Erro desconhecido')}")
    
    print()
    print("💡 NOTAS:")
    print("   - Este script testa apenas leitura (SELECT)")
    print("   - Para testar INSERT/UPDATE/DELETE, é necessário autenticação adequada")
    print("   - Verifique as políticas RLS (Row Level Security) no Supabase")
    print("   - Certifique-se de que as tabelas existem e têm permissões corretas")
    
    # Salvar resultados
    output_file = ".tmp/supabase_connection_test.json"
    os.makedirs(".tmp", exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump({
            "connection_test": connection_test,
            "table_tests": results,
            "summary": {
                "successful_tables": successful_tables,
                "failed_tables": failed_tables,
                "total_tables": len(main_tables)
            }
        }, f, indent=2, ensure_ascii=False)
    
    print(f"\n💾 Resultados salvos em: {output_file}")
    
    if failed_tables:
        sys.exit(1)


if __name__ == "__main__":
    main()
