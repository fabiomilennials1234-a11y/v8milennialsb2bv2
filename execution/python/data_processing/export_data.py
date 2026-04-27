#!/usr/bin/env python3
"""
Export Data - Script de Execução Python
Exporta dados para CSV/Excel
"""

import json
import sys
import pandas as pd
from supabase import create_client, Client
from typing import Dict, List, Optional
import os
from datetime import datetime

def export_data(
    entity_type: str,
    filters: Optional[Dict],
    format: str,
    columns: Optional[List[str]],
    tenant_id: str,
    user_id: str
) -> Dict:
    """Exporta dados do sistema"""
    
    # Inicializar Supabase
    supabase_url = os.getenv('SUPABASE_URL', '')
    supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
    
    if not supabase_url or not supabase_key:
        raise ValueError('Supabase credentials not found')
    
    supabase: Client = create_client(supabase_url, supabase_key)
    
    # Mapear tipo de entidade para tabela
    table_map = {
        'leads': 'leads',
        'contacts': 'leads',  # Mesma tabela
        'deals': 'pipe_propostas',
        'campaigns': 'campanhas'
    }
    
    table_name = table_map.get(entity_type)
    if not table_name:
        raise ValueError(f'Unsupported entity type: {entity_type}')
    
    # Construir query
    query = supabase.table(table_name).select('*').eq('organization_id', tenant_id)
    
    # Aplicar filtros
    if filters:
        for key, value in filters.items():
            if isinstance(value, dict):
                if 'gte' in value:
                    query = query.gte(key, value['gte'])
                if 'lte' in value:
                    query = query.lte(key, value['lte'])
                if 'eq' in value:
                    query = query.eq(key, value['eq'])
            else:
                query = query.eq(key, value)
    
    # Executar query
    result = query.execute()
    
    if not result.data:
        # Criar arquivo vazio
        df = pd.DataFrame()
    else:
        df = pd.DataFrame(result.data)
    
    # Filtrar colunas se especificado
    if columns and len(columns) > 0:
        available_columns = [col for col in columns if col in df.columns]
        df = df[available_columns]
    
    # Gerar arquivo
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    if format == 'csv':
        file_path = f'/tmp/export_{entity_type}_{timestamp}.csv'
        df.to_csv(file_path, index=False)
    elif format == 'xlsx':
        file_path = f'/tmp/export_{entity_type}_{timestamp}.xlsx'
        df.to_excel(file_path, index=False)
    else:
        raise ValueError(f'Unsupported format: {format}')
    
    file_size = os.path.getsize(file_path)
    
    return {
        'file_path': file_path,
        'download_url': None,  # Pode ser implementado com cloud storage
        'total_records': len(df),
        'file_size': file_size,
        'export_timestamp': datetime.now().isoformat()
    }

def main():
    try:
        if len(sys.argv) < 2:
            raise ValueError('Context file not provided')
        
        context_file = sys.argv[1]
        with open(context_file, 'r') as f:
            context_data = json.load(f)
        
        input_data = context_data.get('input', {})
        tenant_id = context_data.get('tenantId') or input_data.get('tenant_id')
        user_id = context_data.get('userId') or input_data.get('user_id')
        
        if not tenant_id:
            raise ValueError('tenant_id is required')
        
        result = export_data(
            entity_type=input_data['entity_type'],
            filters=input_data.get('filters'),
            format=input_data['format'],
            columns=input_data.get('columns'),
            tenant_id=tenant_id,
            user_id=user_id
        )
        
        print(json.dumps(result))
        
    except Exception as e:
        error_result = {
            'error': str(e),
            'type': type(e).__name__
        }
        print(json.dumps(error_result), file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
