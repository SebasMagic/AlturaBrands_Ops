-- =============================================================================
-- Curvas de tallas — vista de revisión
--
-- Presenta cada curva como una rejilla legible, que es como se validan: de
-- corrido, comparando unas con otras. Una curva con huecos en tallas centrales
-- casi siempre es un error de digitación en el origen, no una regla real.
-- =============================================================================

drop view if exists bi.v_curva_detalle cascade;
drop view if exists bi.v_curvas cascade;

create or replace view bi.v_curva_detalle as
select
    c.code                                          as curva,
    c.name                                          as nombre,
    c.scale                                         as escala,
    c.pairs_per_pack                                as pares_por_bulto,
    c.is_default                                    as por_defecto,
    c.is_active                                     as activa,
    b.code                                          as marca,
    e.size_label                                    as talla,
    e.size_value                                    as talla_valor,
    e.ratio                                         as pares
from size_curve c
join size_curve_entry e
     on e.curve_id = c.id and e.deleted_at is null
left join brand_brand_size_curve_size_curve bc
     on bc.size_curve_id = c.id and bc.deleted_at is null
left join brand b
     on b.id = bc.brand_id and b.deleted_at is null
where c.deleted_at is null;

-- Una fila por curva, con la distribución en texto. Sirve para revisarlas
-- todas de un vistazo y detectar huecos sospechosos.
create or replace view bi.v_curvas as
select
    curva,
    marca,
    escala,
    pares_por_bulto,
    por_defecto,
    count(*)                                        as tallas,
    min(talla_valor)                                as talla_min,
    max(talla_valor)                                as talla_max,
    -- Si la corrida fuera continua, el número de tallas coincidiría con los
    -- medios puntos entre el mínimo y el máximo. Si no, hay huecos.
    (count(*) <> ((max(talla_valor) - min(talla_valor)) * 2 + 1)::int)
                                                    as tiene_huecos,
    string_agg(talla || ':' || pares, '  ' order by talla_valor)
                                                    as distribucion
from bi.v_curva_detalle
group by curva, marca, escala, pares_por_bulto, por_defecto;
