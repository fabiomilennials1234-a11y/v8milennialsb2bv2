#!/usr/bin/env python3
"""
Generate Report - Script de Execução Python
Gera relatórios de performance e métricas
"""

import json
import sys
import pandas as pd
from supabase import create_client, Client
from typing import Dict, Optional
import os
from datetime import datetime, timedelta

def generate_report(
    report_type: str,
    period_start: str,
    period_end: str,
    metrics: Optional[List[str]],
    filters: Optional[Dict],
    format: str,
    tenant_id: str,
    user_id: str
) -> Dict:
    """Gera relatório de performance"""
    
    # Inicializar Supabase
    supabase_url = os.getenv('SUPABASE_URL', '')
    supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
    
    if not supabase_url or not supabase_key:
        raise ValueError('Supabase credentials not found')
    
    supabase: Client = create_client(supabase_url, supabase_key)
    
    start_date = datetime.fromisoformat(period_start.replace('Z', '+00:00'))
    end_date = datetime.fromisoformat(period_end.replace('Z', '+00:00'))
    
    if end_date < start_date:
        raise ValueError('period_end must be after period_start')
    
    calculated_metrics = {}
    
    if report_type == 'performance':
        # Buscar leads no período
        leads_result = supabase.table('leads')\
            .select('*')\
            .eq('organization_id', tenant_id)\
            .gte('created_at', period_start)\
            .lte('created_at', period_end)\
            .execute()
        
        leads = leads_result.data if leads_result.data else []
        df_leads = pd.DataFrame(leads)
        
        calculated_metrics = {
            'total_leads': len(leads),
            'leads_by_origin': df_leads['origin'].value_counts().to_dict() if 'origin' in df_leads.columns else {},
            'avg_rating': df_leads['rating'].mean() if 'rating' in df_leads.columns else 0,
        }
        
    elif report_type == 'sales':
        # Buscar propostas no período
        propostas_result = supabase.table('pipe_propostas')\
            .select('*')\
            .eq('organization_id', tenant_id)\
            .gte('created_at', period_start)\
            .lte('created_at', period_end)\
            .execute()
        
        propostas = propostas_result.data if propostas_result.data else []
        df_propostas = pd.DataFrame(propostas)
        
        calculated_metrics = {
            'total_propostas': len(propostas),
            'propostas_by_status': df_propostas['status'].value_counts().to_dict() if 'status' in df_propostas.columns else {},
        }
    
    # Gerar arquivo do relatório
    report_id = f"report_{report_type}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    timestamp = datetime.now().isoformat()
    
    report_data = {
        'report_id': report_id,
        'report_type': report_type,
        'metrics': calculated_metrics,
        'period': {
            'start': period_start,
            'end': period_end
        },
        'generated_at': timestamp
    }
    
    if format == 'json':
        file_path = f'/tmp/{report_id}.json'
        with open(file_path, 'w') as f:
            json.dump(report_data, f, indent=2)
    elif format == 'xlsx':
        file_path = f'/tmp/{report_id}.xlsx'
        df_metrics = pd.DataFrame([calculated_metrics])
        df_metrics.to_excel(file_path, index=False)
    else:
        raise ValueError(f'Unsupported format: {format}')
    
    return {
        'report_id': report_id,
        'report_path': file_path,
        'download_url': None,
        'metrics': calculated_metrics,
        'generated_at': timestamp,
        'period': {
            'start': period_start,
            'end': period_end
        }
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
        
        result = generate_report(
            report_type=input_data['report_type'],
            period_start=input_data['period_start'],
            period_end=input_data['period_end'],
            metrics=input_data.get('metrics'),
            filters=input_data.get('filters'),
            format=input_data['format'],
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
