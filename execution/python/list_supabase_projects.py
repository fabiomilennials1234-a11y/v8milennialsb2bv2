#!/usr/bin/env python3
"""
Script para listar todos os projetos do Supabase usando a Management API.

Requer:
- Personal Access Token do Supabase configurado na variável de ambiente SUPABASE_ACCESS_TOKEN
- Obter o token em: https://supabase.com/dashboard/account/tokens

Uso:
    export SUPABASE_ACCESS_TOKEN='seu-token-aqui'
    python list_supabase_projects.py
"""

import os
import sys
import json
import urllib.request
import urllib.error
from typing import List, Dict, Optional


def get_supabase_projects(access_token: str) -> List[Dict]:
    """
    Busca todos os projetos do Supabase usando a Management API.
    
    Args:
        access_token: Personal Access Token do Supabase
        
    Returns:
        Lista de projetos com suas informações
        
    Raises:
        urllib.error.HTTPError: Se a requisição falhar
    """
    url = "https://api.supabase.com/v1/projects"
    
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {access_token}")
    req.add_header("Content-Type", "application/json")
    
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode('utf-8'))
            return data.get("projects", [])
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        try:
            error_data = json.loads(error_body)
            raise Exception(f"HTTP {e.code}: {error_data.get('message', error_body)}")
        except:
            raise Exception(f"HTTP {e.code}: {error_body}")


def format_project_info(project: Dict) -> Dict:
    """
    Formata as informações do projeto para exibição.
    
    Args:
        project: Dicionário com dados do projeto
        
    Returns:
        Dicionário formatado com informações relevantes
    """
    return {
        "id": project.get("id"),
        "name": project.get("name"),
        "ref": project.get("ref"),
        "region": project.get("region"),
        "organization_id": project.get("organization_id"),
        "created_at": project.get("created_at"),
        "database": {
            "host": project.get("database", {}).get("host"),
            "version": project.get("database", {}).get("version")
        },
        "status": project.get("status"),
        "api_url": f"https://{project.get('ref')}.supabase.co" if project.get('ref') else None
    }


def main():
    """Função principal."""
    # Verificar se o token está configurado
    access_token = os.getenv("SUPABASE_ACCESS_TOKEN")
    
    if not access_token:
        print("❌ Erro: Variável SUPABASE_ACCESS_TOKEN não definida", file=sys.stderr)
        print("\nComo obter o token:", file=sys.stderr)
        print("1. Acesse https://supabase.com/dashboard/account/tokens", file=sys.stderr)
        print("2. Crie um Personal Access Token", file=sys.stderr)
        print("3. Execute: export SUPABASE_ACCESS_TOKEN='seu-token-aqui'", file=sys.stderr)
        print("4. Execute este script novamente", file=sys.stderr)
        sys.exit(1)
    
    try:
        # Buscar projetos
        print("🔍 Buscando projetos do Supabase...\n")
        projects = get_supabase_projects(access_token)
        
        if not projects:
            print("ℹ️  Nenhum projeto encontrado.")
            return
        
        # Formatar e exibir projetos
        formatted_projects = [format_project_info(p) for p in projects]
        
        print(f"✅ Encontrados {len(formatted_projects)} projeto(s):\n")
        print("=" * 80)
        
        for i, project in enumerate(formatted_projects, 1):
            print(f"\n📦 Projeto {i}: {project['name']}")
            print(f"   ID: {project['id']}")
            print(f"   Ref: {project['ref']}")
            print(f"   Região: {project['region']}")
            print(f"   Status: {project['status']}")
            if project['api_url']:
                print(f"   API URL: {project['api_url']}")
            if project['database']['host']:
                print(f"   Database Host: {project['database']['host']}")
            if project['database']['version']:
                print(f"   Database Version: {project['database']['version']}")
            print(f"   Criado em: {project['created_at']}")
        
        print("\n" + "=" * 80)
        
        # Salvar em JSON para uso programático
        output_file = ".tmp/supabase_projects.json"
        os.makedirs(".tmp", exist_ok=True)
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(formatted_projects, f, indent=2, ensure_ascii=False)
        
        print(f"\n💾 Dados salvos em: {output_file}")
        
    except urllib.error.HTTPError as e:
        print(f"❌ Erro na requisição à API do Supabase: {e}", file=sys.stderr)
        error_body = e.read().decode('utf-8')
        try:
            error_data = json.loads(error_body)
            print(f"   Detalhes: {error_data.get('message', error_body)}", file=sys.stderr)
        except:
            print(f"   Resposta: {error_body}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"❌ Erro inesperado: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
