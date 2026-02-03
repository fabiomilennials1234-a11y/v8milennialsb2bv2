#!/usr/bin/env python3
"""
Import Products - Script de Execução Python
Importa produtos de arquivo CSV/Excel conforme template (name, type, ticket, ticket_minimo, etc.).
"""

import json
import sys
import pandas as pd
from supabase import create_client, Client
from typing import Dict, List, Optional, Any
import os
from datetime import datetime

# Colunas do template (cabeçalhos esperados)
DEFAULT_COLUMNS = [
    "name", "type", "ticket", "ticket_minimo", "entregaveis", "materiais",
    "links", "logo_url", "contrato_padrao_url", "contrato_minimo_url", "is_active",
]

VALID_TYPES = {"mrr", "projeto", "unitario"}


def _str(v: Any) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    return str(v).strip()


def _numeric(v: Any) -> Optional[float]:
    if v is None or (isinstance(v, float) and pd.isna(v)) or v == "":
        return None
    try:
        n = float(v)
        return n if n == n else None  # NaN check
    except (TypeError, ValueError):
        return None


def _links(v: Any) -> Optional[List[str]]:
    s = _str(v)
    if not s:
        return None
    parts = [p.strip() for p in s.split(";") if p.strip()]
    return parts if parts else None


def _bool(v: Any) -> bool:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return True
    s = str(v).strip().lower()
    if s in ("true", "1", "sim", "yes"):
        return True
    if s in ("false", "0", "não", "nao", "no"):
        return False
    try:
        return bool(int(v))
    except (TypeError, ValueError):
        return True


def import_products(
    file_path: str,
    tenant_id: str,
    column_mapping: Optional[Dict[str, str]] = None,
    skip_duplicates: bool = False,
    batch_size: int = 50,
) -> Dict:
    """Importa produtos de arquivo CSV/Excel."""
    supabase_url = os.getenv("SUPABASE_URL", "") or os.getenv("VITE_SUPABASE_URL", "")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "") or os.getenv("SUPABASE_KEY", "")
    if not supabase_url or not supabase_key:
        raise ValueError("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente")

    supabase: Client = create_client(supabase_url, supabase_key)

    if file_path.endswith(".csv"):
        df = pd.read_csv(file_path)
    elif file_path.endswith((".xlsx", ".xls")):
        df = pd.read_excel(file_path)
    else:
        raise ValueError(f"Formato não suportado: {file_path}")

    mapping = column_mapping or {c: c for c in DEFAULT_COLUMNS}
    total_rows = len(df)
    products_imported = 0
    products_failed = 0
    errors: List[Dict[str, Any]] = []

    for batch_start in range(0, total_rows, batch_size):
        batch_end = min(batch_start + batch_size, total_rows)
        batch_df = df.iloc[batch_start:batch_end]
        to_insert: List[Dict[str, Any]] = []

        for idx, row in batch_df.iterrows():
            row_num = int(idx) + 2  # 1-based + header
            try:
                name = _str(row.get(mapping.get("name", "name"), ""))
                type_val = _str(row.get(mapping.get("type", "type"), "")).lower()
                if not name:
                    errors.append({"row": row_num, "error": "Nome é obrigatório"})
                    products_failed += 1
                    continue
                if type_val not in VALID_TYPES:
                    errors.append({"row": row_num, "error": f"Tipo deve ser: {', '.join(VALID_TYPES)}"})
                    products_failed += 1
                    continue

                if skip_duplicates:
                    existing = supabase.table("products").select("id").eq("organization_id", tenant_id).eq("name", name).execute()
                    if existing.data:
                        continue

                product_data: Dict[str, Any] = {
                    "organization_id": tenant_id,
                    "name": name,
                    "type": type_val,
                    "ticket": _numeric(row.get(mapping.get("ticket", "ticket"))),
                    "ticket_minimo": _numeric(row.get(mapping.get("ticket_minimo", "ticket_minimo"))),
                    "entregaveis": _str(row.get(mapping.get("entregaveis", "entregaveis"))) or None,
                    "materiais": _str(row.get(mapping.get("materiais", "materiais"))) or None,
                    "links": _links(row.get(mapping.get("links", "links"))),
                    "logo_url": _str(row.get(mapping.get("logo_url", "logo_url"))) or None,
                    "contrato_padrao_url": _str(row.get(mapping.get("contrato_padrao_url", "contrato_padrao_url"))) or None,
                    "contrato_minimo_url": _str(row.get(mapping.get("contrato_minimo_url", "contrato_minimo_url"))) or None,
                    "is_active": _bool(row.get(mapping.get("is_active", "is_active"), True)),
                }
                to_insert.append(product_data)
            except Exception as e:
                errors.append({"row": row_num, "error": str(e)})
                products_failed += 1

        if to_insert:
            result = supabase.table("products").insert(to_insert).execute()
            products_imported += len(result.data) if result.data else 0

    report_path = f"/tmp/import_products_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    report = {
        "total_rows": total_rows,
        "products_imported": products_imported,
        "products_failed": products_failed,
        "errors": errors,
        "timestamp": datetime.now().isoformat(),
    }
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    report["report_path"] = report_path
    return report


def main() -> None:
    try:
        if len(sys.argv) < 2:
            raise ValueError("Arquivo de contexto não informado (JSON com input e tenantId)")
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            context = json.load(f)
        input_data = context.get("input", {})
        tenant_id = context.get("tenantId") or input_data.get("tenant_id")
        if not tenant_id:
            raise ValueError("tenant_id (ou tenantId) é obrigatório")
        result = import_products(
            file_path=input_data["file_path"],
            tenant_id=tenant_id,
            column_mapping=input_data.get("column_mapping"),
            skip_duplicates=input_data.get("skip_duplicates", False),
            batch_size=input_data.get("batch_size", 50),
        )
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
