#!/usr/bin/env python3
"""
Import Leads - Script de Execução Python
Importa leads de arquivo CSV/Excel
"""

import json
import sys
import pandas as pd
from supabase import create_client, Client
from typing import Dict, List, Optional
import os
from datetime import datetime

def normalize_email(email: Optional[str]) -> Optional[str]:
    """Normaliza email para comparação"""
    if not email:
        return None
    return email.lower().strip()

def import_leads(
    file_path: str,
    column_mapping: Dict[str, str],
    tenant_id: str,
    user_id: str,
    skip_duplicates: bool = True,
    batch_size: int = 100
) -> Dict:
    """Importa leads de arquivo CSV/Excel"""
    
    # Inicializar Supabase
    supabase_url = os.getenv('SUPABASE_URL', '')
    supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
    
    if not supabase_url or not supabase_key:
        raise ValueError('Supabase credentials not found')
    
    supabase: Client = create_client(supabase_url, supabase_key)
    
    # Ler arquivo
    if file_path.endswith('.csv'):
        df = pd.read_csv(file_path)
    elif file_path.endswith(('.xlsx', '.xls')):
        df = pd.read_excel(file_path)
    else:
        raise ValueError(f'Unsupported file format: {file_path}')
    
    total_rows = len(df)
    leads_imported = 0
    leads_skipped = 0
    leads_failed = 0
    errors = []
    
    # Processar em lotes
    for batch_start in range(0, total_rows, batch_size):
        batch_end = min(batch_start + batch_size, total_rows)
        batch_df = df.iloc[batch_start:batch_end]
        
        leads_to_insert = []
        
        for idx, row in batch_df.iterrows():
            try:
                # Mapear colunas
                lead_data = {
                    'name': str(row.get(column_mapping.get('name', 'name'), '')),
                    'email': normalize_email(row.get(column_mapping.get('email', 'email'), None)),
                    'phone': str(row.get(column_mapping.get('phone', 'phone'), '')) if pd.notna(row.get(column_mapping.get('phone', 'phone'), None)) else None,
                    'company': str(row.get(column_mapping.get('company', 'company'), '')) if pd.notna(row.get(column_mapping.get('company', 'company'), None)) else None,
                    'origin': str(row.get(column_mapping.get('origin', 'import'), 'import')),
                    'organization_id': tenant_id,
                }
                
                # Validar nome obrigatório
                if not lead_data['name'] or lead_data['name'] == '':
                    errors.append({
                        'row': int(idx) + 1,
                        'error': 'Name is required'
                    })
                    leads_failed += 1
                    continue
                
                # Verificar duplicata se skip_duplicates
                if skip_duplicates and lead_data['email']:
                    existing = supabase.table('leads')\
                        .select('id')\
                        .eq('organization_id', tenant_id)\
                        .eq('email', lead_data['email'])\
                        .execute()
                    
                    if existing.data:
                        leads_skipped += 1
                        continue
                
                leads_to_insert.append(lead_data)
                
            except Exception as e:
                errors.append({
                    'row': int(idx) + 1,
                    'error': str(e)
                })
                leads_failed += 1
        
        # Inserir lote
        if leads_to_insert:
            result = supabase.table('leads').insert(leads_to_insert).execute()
            leads_imported += len(result.data) if result.data else 0
    
    # Gerar relatório
    report_path = f'/tmp/import_report_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    report = {
        'total_rows': total_rows,
        'leads_imported': leads_imported,
        'leads_skipped': leads_skipped,
        'leads_failed': leads_failed,
        'errors': errors,
        'timestamp': datetime.now().isoformat()
    }
    
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2)
    
    return {
        'total_rows': total_rows,
        'leads_imported': leads_imported,
        'leads_skipped': leads_skipped,
        'leads_failed': leads_failed,
        'errors': errors,
        'report_path': report_path
    }

def main():
    try:
        # Ler contexto do arquivo passado como argumento
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
        
        result = import_leads(
            file_path=input_data['file_path'],
            column_mapping=input_data['column_mapping'],
            tenant_id=tenant_id,
            user_id=user_id,
            skip_duplicates=input_data.get('skip_duplicates', True),
            batch_size=input_data.get('batch_size', 100)
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
