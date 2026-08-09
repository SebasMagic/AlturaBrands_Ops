"""
Convierte un Excel con el layout de pedido de KEEN a JSON canonico.

Es el backend del boton "cargar archivo": alguien monta el pedido fuera, lo
sube, y esto lo valida y lo normaliza antes de que entre al sistema.

Salida: data/purchase-order-<nombre>.json
"""

import json
import re
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(r"C:\dev\AlturaBrands_Ops")
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "Formato Pedido Keen.xlsx"
SHEET = "Pedido ECOMM - MKT Place"

COL_BULTOS = "Bultos (editable)"
SCALE = {"MEN": "M", "WOMEN": "W", "CHILDREN": "C", "YOUTH": "Y", "TOTS": "T"}


def main():
    df = pd.read_excel(SRC, sheet_name=SHEET)
    sizes = [c for c in df.columns
             if isinstance(c, (int, float))
             or (isinstance(c, str) and c.replace(".", "").isdigit())]

    curvas_path = ROOT / "data" / "size-curves.json"
    curvas = json.loads(curvas_path.read_text(encoding="utf-8"))

    def receta(c):
        return {e["size_label"]: e["ratio"] for e in c["entries"]}

    items = []
    problemas = []

    for _, r in df.iterrows():
        b = r.get(COL_BULTOS)
        mat = r.get("Material")
        genero = r.get("Genero")
        if pd.isna(mat) or pd.isna(b) or b <= 0 or not isinstance(genero, str):
            continue

        escala = SCALE.get(genero, "X")
        vals = {str(s): int(r[s]) for s in sizes if pd.notna(r[s]) and r[s] > 0}
        if not vals:
            continue

        # Que curva se uso, y si se ajusto respecto a ella
        curva_code, ajuste = None, None
        por_bulto = {}
        exacta = True
        for s, q in vals.items():
            ratio = q / b
            if abs(ratio - round(ratio)) > 1e-9:
                exacta = False
                break
            por_bulto[s] = int(round(ratio))

        if exacta:
            for c in curvas:
                if c["scale"] != escala:
                    continue
                rc = receta(c)
                if set(por_bulto) - set(rc):
                    continue
                if all(por_bulto[k] == rc[k] for k in por_bulto):
                    curva_code = c["code"]
                    quitadas = sorted(set(rc) - set(por_bulto), key=float)
                    if quitadas:
                        ajuste = f"Se quitaron las tallas {', '.join(quitadas)}"
                    break

        if not curva_code:
            problemas.append(f"material {int(mat)}: no encaja con ninguna curva activa")

        material = int(mat)
        items.append({
            "material_code": str(material),
            "description": r.get("Descripcion material") or f"MATERIAL {material}",
            "size_curve_code": curva_code,
            "packs": int(b),
            "is_adjusted": ajuste is not None or not exacta,
            "adjustment_note": ajuste,
            "unit_cost_cents": (
                int(round(float(r["Precio PA (USD)"]) * 100))
                if pd.notna(r.get("Precio PA (USD)")) else None
            ),
            "sizes": [
                {
                    "sku": f"{material}-{escala}{s}",
                    "size_label": s,
                    "size_value": float(s),
                    "quantity_requested": q,
                }
                for s, q in sorted(vals.items(), key=lambda x: float(x[0]))
            ],
        })

    total = sum(s["quantity_requested"] for i in items for s in i["sizes"])
    bultos = sum(i["packs"] for i in items)
    ajustados = sum(1 for i in items if i["is_adjusted"])

    salida = {
        "meta": {
            "origen": SRC.name,
            "items": len(items),
            "packs": bultos,
            "pares": total,
            "items_ajustados": ajustados,
        },
        "operation_code": "CO",
        "brand_code": "KEEN",
        "currency_code": "usd",
        "items": items,
    }

    slug = re.sub(r"[^a-z0-9]+", "-", SRC.stem.lower()).strip("-")
    out = ROOT / "data" / f"purchase-order-{slug}.json"
    out.write_text(json.dumps(salida, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Origen : {SRC.name}")
    print(f"Items  : {len(items)}")
    print(f"Bultos : {bultos}")
    print(f"Pares  : {total}")
    print(f"Ajustados respecto a su curva: {ajustados}")
    if problemas:
        print(f"\nAVISOS ({len(problemas)}):")
        for p in problemas[:8]:
            print(f"  {p}")
    print(f"\nEscrito: {out}")


if __name__ == "__main__":
    main()
