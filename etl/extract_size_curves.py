"""
Infiere las curvas de tallas desde el formato de pedido de KEEN.

En el Excel las cantidades no se teclean: salen de `Bultos x curva`. Dividir
cada cantidad entre los bultos devuelve la curva usada en esa linea. Se
deduplican y se les asigna un codigo estable.

Salida: data/size-curves.json  (para revisar ANTES de cargar nada)
"""

import json
from collections import defaultdict
from pathlib import Path

import pandas as pd

ROOT = Path(r"C:\dev\AlturaBrands_Ops")
SRC = ROOT / "Formato Pedido Keen.xlsx"
SHEET = "Pedido ECOMM - MKT Place"
OUT = ROOT / "data" / "size-curves.json"

BRAND = "KEEN"
COL_BULTOS = "Bultos (editable)"

SCALE = {"MEN": "M", "WOMEN": "W", "CHILDREN": "C", "YOUTH": "Y", "TOTS": "T"}


def main():
    df = pd.read_excel(SRC, sheet_name=SHEET)
    sizes = [c for c in df.columns
             if isinstance(c, (int, float))
             or (isinstance(c, str) and c.replace(".", "").isdigit())]

    print(f"Origen: {SRC.name}")
    print(f"Filas: {len(df)}  ·  columnas de talla: {len(sizes)}\n")

    # curva -> info agregada
    curvas = defaultdict(lambda: {"usos": 0, "modelos": set(), "generos": set()})
    descartadas = []

    for _, r in df.iterrows():
        b = r.get(COL_BULTOS)
        genero = r.get("Genero")
        if pd.isna(b) or b <= 0 or not isinstance(genero, str):
            continue

        vals = {s: r[s] for s in sizes if pd.notna(r[s]) and r[s] > 0}
        if not vals:
            continue

        # La curva solo es valida si cada cantidad es multiplo exacto de bultos
        curva = {}
        exacta = True
        for s, q in vals.items():
            ratio = q / b
            if abs(ratio - round(ratio)) > 1e-9:
                exacta = False
                break
            curva[str(s)] = int(round(ratio))

        if not exacta:
            descartadas.append((r.get("Modelo"), genero, b))
            continue

        clave = (SCALE.get(genero, "X"), tuple(sorted(curva.items(), key=lambda x: float(x[0]))))
        curvas[clave]["usos"] += 1
        curvas[clave]["modelos"].add(r.get("Modelo"))
        curvas[clave]["generos"].add(genero)

    print(f"Curvas distintas encontradas: {len(curvas)}")
    if descartadas:
        print(f"Filas descartadas (no son multiplo exacto): {len(descartadas)}")
        for m, g, b in descartadas[:3]:
            print(f"  {m} {g} bultos={b}")

    # Codigo estable: escala + orden por frecuencia de uso
    por_escala = defaultdict(list)
    for clave, info in curvas.items():
        por_escala[clave[0]].append((clave, info))

    salida = []
    for escala in sorted(por_escala):
        items = sorted(por_escala[escala], key=lambda x: -x[1]["usos"])
        for i, (clave, info) in enumerate(items, start=1):
            entries = [
                {"size_label": s, "size_value": float(s), "ratio": ratio}
                for s, ratio in clave[1]
            ]
            pares = sum(e["ratio"] for e in entries)
            salida.append({
                "code": f"{BRAND}-{escala}-{i:02d}",
                "name": f"{BRAND} {escala} · {pares} pares",
                "brand_code": BRAND,
                "scale": escala,
                "pairs_per_pack": pares,
                "is_default": i == 1,
                "usos_observados": info["usos"],
                "modelos_observados": sorted(m for m in info["modelos"] if isinstance(m, str)),
                "entries": entries,
            })

    print("\n" + "=" * 78)
    print("CURVAS INFERIDAS")
    print("=" * 78)
    for c in salida:
        det = "  ".join(f"{e['size_label']}:{e['ratio']}" for e in c["entries"])
        marca = " (por defecto)" if c["is_default"] else ""
        print(f"\n  {c['code']}{marca}  ·  {c['pairs_per_pack']} pares/bulto  "
              f"·  {c['usos_observados']} uso(s)")
        print(f"    {det}")
        print(f"    modelos: {', '.join(c['modelos_observados'][:4])}"
              + ("..." if len(c["modelos_observados"]) > 4 else ""))

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(salida, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nEscrito: {OUT}  ({len(salida)} curvas)")


if __name__ == "__main__":
    main()
