"""
ETL: Master Data Inventarios.xlsx -> data/master-data.json

Normaliza el pivot ancho de Excel a un modelo canonico apto para cargar en
Medusa. No toca la base de datos: su unica salida es JSON + un reporte de
validacion, para revisar el modelo antes de que nada entre al sistema.

Decisiones implementadas (ver CLAUDE.md 5 y 6):
  - `Material` (entero de 7 digitos) es la clave de negocio del producto.
  - Producto = material (modelo + genero + color). Variante = talla.
  - La talla se guarda con su escala porque la misma cifra significa cosas
    distintas segun el genero: una 8 de CHILDREN no es una 8 de MEN.
  - Precio en centavos enteros, nunca float.
  - `Precio PA` cambia de significado segun la bodega, asi que se separa en
    dos campos distintos en lugar de mezclarlos.
"""

import json
import math
import re
from collections import defaultdict
from pathlib import Path

import pandas as pd

ROOT = Path(r"C:\dev\AlturaBrands_Ops")
SRC = ROOT / "Master Data Inventarios.xlsx"
OUT_DIR = ROOT / "data"
OUT_JSON = OUT_DIR / "master-data.json"
OUT_REPORT = OUT_DIR / "validation-report.txt"

SIZE_COLS = ["1", "2", "3", "4", "5", "5.5", "6", "6.5", "7", "7.5", "8",
             "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "13"]
OTHER_COL = "Otras tallas"

# Prefijo de escala por genero. Evita que la talla 8 de CHILDREN colisione
# con la 8 de MEN al agregar en reportes.
SCALE = {
    "MEN": "M",
    "WOMEN": "W",
    "CHILDREN": "C",
    "YOUTH": "Y",
    "TOTS": "T",
}

# Clasificacion de las "bodegas" del archivo. Solo una es inventario propio.
BODEGA_KIND = {
    "Bodega Matriz": ("OWNED", None),
    "Transito (15 dias)": ("IN_TRANSIT", 15),
    "Transito (60 dias)": ("IN_TRANSIT", 60),
    "Transito (90 dias)": ("IN_TRANSIT", 90),
    "ATS USA": ("SUPPLIER", None),
}

report_lines = []


def log(msg=""):
    print(msg)
    report_lines.append(str(msg))


def to_cents(value):
    """USD -> centavos enteros. Redondeo bancario evita sesgo acumulado."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return int(round(float(value) * 100))


def slugify(text):
    s = re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")
    return re.sub(r"-{2,}", "-", s)


def parse_color_from_desc(desc, gender):
    """
    'HOWSER II M-TRIPLE BLACK' -> 'TRIPLE BLACK'.
    Solo se usa como ultimo recurso: la descripcion viene truncada a 40
    caracteres, asi que la columna Color y el cruce por material mandan.
    """
    if not isinstance(desc, str):
        return None
    letter = SCALE.get(gender)
    if letter:
        m = re.search(rf"\s{letter}-(.+)$", desc)
        if m:
            return m.group(1).strip()
    m = re.search(r"\s[A-Z]-(.+)$", desc)
    return m.group(1).strip() if m else None


def main():
    OUT_DIR.mkdir(exist_ok=True)
    raw = pd.read_excel(SRC, sheet_name="Master Data")

    log("=" * 74)
    log("ETL MASTER DATA - REPORTE DE VALIDACION")
    log("=" * 74)
    log(f"\nOrigen: {SRC.name}")
    log(f"Filas leidas del Excel: {len(raw)}")

    # --- 1. Descartar filas que no son datos -------------------------------
    df = raw[raw["Material"].notna()].copy()
    log(f"Filas descartadas (TOTAL y notas): {len(raw) - len(df)}")
    log(f"Filas de datos: {len(df)}")

    df["Material"] = df["Material"].astype(int)

    # --- 2. Reconstruir Color y Categoria ausentes --------------------------
    # El mismo material siempre es el mismo zapato, asi que un valor presente
    # en cualquier fila sirve para todas las demas del mismo material.
    color_by_mat = (
        df.dropna(subset=["Color"])
        .groupby("Material")["Color"]
        .agg(lambda s: s.mode().iloc[0])
        .to_dict()
    )
    cat_by_mat = (
        df.dropna(subset=["Categoria"])
        .groupby("Material")["Categoria"]
        .agg(lambda s: s.mode().iloc[0])
        .to_dict()
    )

    color_before = df["Color"].isna().sum()
    cat_before = df["Categoria"].isna().sum()

    recovered_desc = 0

    def resolve_color(row):
        nonlocal recovered_desc
        if isinstance(row["Color"], str):
            return row["Color"]
        c = color_by_mat.get(row["Material"])
        if c:
            return c
        c = parse_color_from_desc(row["Descripcion material"], row["Genero"])
        if c:
            recovered_desc += 1
            return c
        return None

    df["color_final"] = df.apply(resolve_color, axis=1)
    df["categoria_final"] = df.apply(
        lambda r: r["Categoria"] if isinstance(r["Categoria"], str)
        else cat_by_mat.get(r["Material"]), axis=1
    )

    # Segundo intento: la categoria es una propiedad de la linea de producto,
    # asi que si otro material del MISMO modelo la tiene, aplica igual.
    cat_by_model = (
        df.dropna(subset=["categoria_final"])
        .groupby("Modelo")["categoria_final"]
        .agg(lambda s: s.mode().iloc[0])
        .to_dict()
    )
    faltantes_antes = df["categoria_final"].isna().sum()
    df["categoria_final"] = df.apply(
        lambda r: r["categoria_final"] if isinstance(r["categoria_final"], str)
        else cat_by_model.get(r["Modelo"]), axis=1
    )
    por_modelo = faltantes_antes - df["categoria_final"].isna().sum()

    # Ultimo recurso: nunca dejar la categoria vacia, o los productos
    # desaparecen de los filtros del admin.
    sin_clasificar = int(df["categoria_final"].isna().sum())
    df["categoria_final"] = df["categoria_final"].fillna("Sin clasificar")

    log("\n--- Reconstruccion de datos ausentes ---")
    log(f"Color    : {color_before} ausentes -> {df['color_final'].isna().sum()} "
        f"(de los recuperados, {recovered_desc} salieron de la descripcion)")
    log(f"Categoria: {cat_before} ausentes -> 0")
    log(f"  recuperadas cruzando por material : {cat_before - faltantes_antes}")
    log(f"  recuperadas cruzando por modelo   : {por_modelo}")
    log(f"  marcadas 'Sin clasificar'         : {sin_clasificar}")

    # --- 3. Construir productos (uno por material) --------------------------
    products = {}
    for mat, grp in df.groupby("Material"):
        first = grp.iloc[0]
        gender = first["Genero"] if isinstance(first["Genero"], str) else None
        color = grp["color_final"].dropna().iloc[0] if grp["color_final"].notna().any() else None
        cat = grp["categoria_final"].dropna().iloc[0] if grp["categoria_final"].notna().any() else None

        # MSRP es constante por material (verificado en el analisis).
        msrp = grp["US MSRP"].dropna()
        msrp = to_cents(msrp.iloc[0]) if len(msrp) else None

        # Precio PA significa cosas distintas segun la bodega, por eso van
        # a campos separados en vez de promediarse.
        supplier_rows = grp[grp["Bodega"] != "Bodega Matriz"]["Precio PA (USD)"].dropna()
        cost_rows = grp[grp["Bodega"] == "Bodega Matriz"]["Precio PA (USD)"].dropna()

        title = first["Descripcion material"]
        products[mat] = {
            "material": mat,
            "title": title if isinstance(title, str) else f"MATERIAL {mat}",
            "handle": slugify(f"{first['Modelo']}-{color or ''}-{mat}"),
            "modelo": first["Modelo"] if isinstance(first["Modelo"], str) else None,
            "genero": gender,
            "categoria": cat,
            "color": color,
            "escala": SCALE.get(gender),
            "precio_msrp_usd_cents": msrp,
            "precio_proveedor_usd_cents": to_cents(supplier_rows.iloc[0]) if len(supplier_rows) else None,
            "costo_usd_cents": to_cents(cost_rows.iloc[0]) if len(cost_rows) else None,
            "variantes": {},
        }

    log(f"\n--- Catalogo ---")
    log(f"Productos (materiales unicos): {len(products)}")

    # --- 4. Desplegar tallas a formato largo --------------------------------
    # Las filas duplicadas por (bodega, material) son lotes parciales del mismo
    # material con tallas distintas, asi que se suman en lugar de descartarse.
    stock = defaultdict(int)   # (material, talla, bodega) -> unidades
    dup_merges = 0
    seen = set()

    for _, row in df.iterrows():
        mat = row["Material"]
        bodega = row["Bodega"] if isinstance(row["Bodega"], str) else None
        if bodega not in BODEGA_KIND:
            continue
        key = (mat, bodega)
        if key in seen:
            dup_merges += 1
        seen.add(key)

        for col in SIZE_COLS:
            qty = row.get(col)
            if pd.notna(qty) and qty > 0:
                stock[(mat, col, bodega)] += int(qty)

        other = row.get(OTHER_COL)
        if pd.notna(other) and other > 0:
            stock[(mat, "OTRA", bodega)] += int(other)

    log(f"Filas duplicadas por (bodega, material) fusionadas: {dup_merges}")

    # --- 5. Variantes y niveles de existencias -----------------------------
    for (mat, size, bodega), qty in stock.items():
        p = products[mat]
        scale = p["escala"] or "X"
        label = "OTRA" if size == "OTRA" else f"{scale} {size}"
        sku = f"{mat}-{'OTRA' if size == 'OTRA' else scale + size}"

        v = p["variantes"].setdefault(label, {
            "sku": sku,
            "talla_label": label,
            "escala": None if size == "OTRA" else scale,
            "talla_valor": None if size == "OTRA" else float(size),
            "pendiente_desglose": size == "OTRA",
            "existencias": {},
        })
        kind, eta = BODEGA_KIND[bodega]
        v["existencias"][bodega] = {
            "origen": bodega,
            "tipo": kind,
            "eta_dias": eta,
            "unidades": qty,
        }

    total_variants = sum(len(p["variantes"]) for p in products.values())
    log(f"Variantes generadas: {total_variants}")

    # --- 6. Validacion: cuadre par a par contra el Excel --------------------
    log("\n--- Cuadre contra el Excel ---")
    excel_sizes = df[SIZE_COLS].sum().sum()
    excel_other = df[OTHER_COL].sum()
    excel_total = excel_sizes + excel_other

    json_total = sum(
        e["unidades"]
        for p in products.values()
        for v in p["variantes"].values()
        for e in v["existencias"].values()
    )
    json_other = sum(
        e["unidades"]
        for p in products.values()
        for v in p["variantes"].values()
        if v["pendiente_desglose"]
        for e in v["existencias"].values()
    )

    log(f"Excel - tallas numeradas : {excel_sizes:>10,.0f}")
    log(f"Excel - otras tallas     : {excel_other:>10,.0f}")
    log(f"Excel - TOTAL            : {excel_total:>10,.0f}")
    log(f"JSON  - TOTAL            : {json_total:>10,}")
    log(f"JSON  - otras tallas     : {json_other:>10,}")
    cuadra = int(excel_total) == json_total
    log(f"\nCUADRE: {'OK, no se perdio ni una unidad' if cuadra else 'DESCUADRE - REVISAR'}")
    if not cuadra:
        log(f"  diferencia: {json_total - int(excel_total)}")

    # --- 7. Desglose por tipo de existencia --------------------------------
    by_kind = defaultdict(int)
    by_bodega = defaultdict(int)
    for p in products.values():
        for v in p["variantes"].values():
            for e in v["existencias"].values():
                by_kind[e["tipo"]] += e["unidades"]
                by_bodega[e["origen"]] += e["unidades"]

    log("\n--- Clasificacion del inventario ---")
    labels = {
        "OWNED": "Propio y vendible (Bodega Matriz)",
        "IN_TRANSIT": "Comprado, en transito",
        "SUPPLIER": "Disponibilidad del proveedor (NO vendible)",
    }
    for k in ["OWNED", "IN_TRANSIT", "SUPPLIER"]:
        log(f"  {labels[k]:<45}: {by_kind[k]:>8,}")
    log(f"  {'TOTAL':<45}: {sum(by_kind.values()):>8,}")

    log("\n  Por origen:")
    for b, q in sorted(by_bodega.items(), key=lambda x: -x[1]):
        log(f"    {b:<24}: {q:>8,}")

    # --- 8. Avisos de calidad ----------------------------------------------
    log("\n--- Avisos de calidad ---")
    sin_color = [m for m, p in products.items() if not p["color"]]
    sin_cat = [m for m, p in products.items() if not p["categoria"]]
    sin_msrp = [m for m, p in products.items() if not p["precio_msrp_usd_cents"]]
    sin_genero = [m for m, p in products.items() if not p["genero"]]
    solo_otras = [
        m for m, p in products.items()
        if p["variantes"] and all(v["pendiente_desglose"] for v in p["variantes"].values())
    ]
    for label, items in [
        ("productos sin color", sin_color),
        ("productos sin categoria", sin_cat),
        ("productos sin MSRP", sin_msrp),
        ("productos sin genero", sin_genero),
        ("productos SOLO con 'otras tallas'", solo_otras),
    ]:
        log(f"  {label:<38}: {len(items):>4}"
            + (f"   {items[:5]}{'...' if len(items) > 5 else ''}" if items else ""))

    # --- 9. Escribir salida -------------------------------------------------
    out = {
        "meta": {
            "origen": SRC.name,
            "productos": len(products),
            "variantes": total_variants,
            "unidades_total": json_total,
            "unidades_por_tipo": dict(by_kind),
            "cuadre_ok": cuadra,
        },
        "escalas": SCALE,
        "bodegas": {k: {"tipo": v[0], "eta_dias": v[1]} for k, v in BODEGA_KIND.items()},
        "productos": [
            {**p, "variantes": sorted(
                p["variantes"].values(),
                key=lambda v: (v["talla_valor"] is None, v["talla_valor"] or 0),
            )}
            for p in sorted(products.values(), key=lambda x: x["material"])
        ],
    }

    OUT_JSON.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    log(f"\nEscrito: {OUT_JSON}  ({OUT_JSON.stat().st_size / 1024:.0f} KB)")

    OUT_REPORT.write_text("\n".join(report_lines), encoding="utf-8")
    print(f"Escrito: {OUT_REPORT}")


if __name__ == "__main__":
    main()
