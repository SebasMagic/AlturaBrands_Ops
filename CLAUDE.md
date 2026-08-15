# CLAUDE.md — ERP Ligero a la medida (Next.js + Supabase)

Este archivo es el contrato de trabajo para Claude Code en este repositorio.
Léelo completo antes de escribir código. Si algo aquí contradice tu intuición por
defecto, **gana este archivo**.

> **Cambio de rumbo (14 ago 2026).** Este proyecto corría sobre Medusa v2. Se
> decidió salir. La sección §2 explica por qué y con qué evidencia; no la
> re-litigues. Todo lo anterior a esa fecha en el historial de git es la versión
> Medusa y sirve como referencia, no como base.

---

## 1. Qué estamos construyendo

Un **ERP operativo ligero, a la medida**, para una empresa pequeña que importa y
distribuye calzado multimarca en Colombia. No es un e-commerce: es un
back-office. El usuario final es personal interno (comercial, bodega,
coordinación de despacho), no un comprador anónimo.

Proceso lean: se arma por partes, cada una en uso antes de construir la
siguiente.

| Dominio | Qué debe resolver |
|---|---|
| **Catálogo** | Productos, variantes por talla, marcas, categorías, curvas |
| **Inventario** | Stock por bodega, kardex, ajustes, transferencias |
| **Abastecimiento** | Pedido a la marca, disponibilidad del proveedor (ATS), tránsito, recepción |
| **Comercial** | Clientes, cotización → pedido, precios |
| **Operaciones** | Embudo: pedido → reserva → alistamiento → empaque → despacho → entregado |
| **Dashboards** | Posición, cobertura de corrida, valorización, embudo |

**Fuera de alcance — no lo construyas, no lo "adelantes":**
contabilidad, cuentas por cobrar/pagar, facturación electrónica DIAN, nómina,
POS, e-commerce público.

**La facturación no se construye: se integra.** El plan es conectar un sistema
externo (Siigo u otro) por API cuando llegue el momento. Cualquier decisión de
diseño que lo dificulte hay que decirla antes de implementar — en particular,
los identificadores de cliente, producto y documento deben poder mapearse a un
sistema externo.

---

## 2. Por qué salimos de Medusa

Decisión tomada con datos sobre la instalación real, no por preferencia:

| Evidencia | Número |
|---|---|
| Tablas creadas por Medusa | **159** |
| Tablas con algún dato | **24** |
| Tablas vacías | **135** |
| Órdenes creadas en la vida del proyecto | **0** |
| Clientes | **0** |
| Reservas | **0** |
| Despachos | **0** |

El argumento a favor de Medusa era que traía resuelto el núcleo transaccional
—reservas, consistencia orden-stock, rollback—, "el 70% del riesgo técnico".
**Ese núcleo nunca se usó.** Todo lo que sí opera (marcas, operación-país,
disponibilidad del proveedor, órdenes de compra, curvas de tallas, kardex) fue
construido a mano como módulos custom: Medusa no aportó nada ahí.

Costos concretos que se pagaban por esa arquitectura:

- **El metadata JSON como escape hatch.** Al no poder agregar columnas al core,
  9 atributos de dominio (`material`, `modelo`, `genero`, `color`, `escala`,
  `talla_valor`, `pendiente_desglose`, `costo_usd_cents`,
  `precio_proveedor_usd_cents`) vivían en `product.metadata`, escritos por 6
  archivos en 3 lenguajes y declarados en ninguno. Sin tipos y sin validación:
  una clave mal escrita devolvía `null` en silencio.
- **El shell del admin no era nuestro.** La navegación tiene rutas fijas en el
  código del dashboard; ya se habían hecho concesiones de estructura por eso.
- **Redis obligatorio.** BullMQ sondea sin parar; agotó los 500k comandos del
  tier gratuito de Upstash en horas. Sin Medusa **no necesitamos Redis**.

Lo que se pierde y hay que construir: el CRUD nativo de productos e inventario,
y auth. Ambos son acotados — el catálogo entra por ETL y se edita poco.

**Lo que NO se pierde:** la capa BI y las pantallas. Ver §6.

---

## 3. Stack

- **App:** Next.js (App Router), TypeScript, Tailwind
- **Base de datos:** PostgreSQL en Supabase — proyecto `AlturaBrands-ERP`
  (ref `xkcngokwgxmoirswmnja`, us-east-1)
- **Auth:** Supabase Auth
- **Storage:** Supabase Storage
- **Hosting:** Vercel
- **Gestor de paquetes:** pnpm

Sin Redis, sin worker, sin ORM pesado. Si aparece la necesidad de un proceso de
larga duración (jobs programados de ETL), se resuelve entonces y se discute
primero.

---

## 4. Supabase: reglas duras

### Acceso a datos — la regla central

**El navegador nunca habla con Postgres.** Todo acceso a datos ocurre en el
servidor: Server Components y Route Handlers. La autorización vive ahí, en
código que podemos leer y testear.

- ❌ Nunca `NEXT_PUBLIC_` para la clave `service_role`. Cualquier variable con
  ese prefijo viaja al navegador.
- ✅ **RLS activado en todas las tablas**, siempre. No es la línea principal de
  defensa —lo es el servidor— pero es la red que atrapa un error de ruteo o una
  tabla expuesta por accidente sin querer.
- ❌ **Nunca uses `user_metadata` para decisiones de autorización.** En Supabase
  es editable por el propio usuario. Los datos de autorización van en
  `app_metadata`.
- ✅ Las vistas se crean con `security_invoker = true`. Sin eso una vista
  ignora el RLS de las tablas que lee.

### Migraciones

Con el CLI de Supabase. **Nunca inventes el nombre de un archivo de migración:**

```bash
supabase migration new <nombre>   # crea el archivo con el formato correcto
supabase db push                  # aplica
supabase migration list
```

Para iterar sobre el esquema mientras diseñas, usa SQL directo (`execute_sql`
por MCP). Cuando quede bien, generas la migración. Nunca edites una migración ya
aplicada: genera una nueva.

### El gotcha de las vistas que ya nos mordió

Postgres no deja alterar una columna de la que cuelga una vista. La capa BI
bloqueaba las migraciones del esquema. **La solución que ya funciona y hay que
conservar: el schema `bi` se tira y se reconstruye completo en cada migración.**
Son vistas de solo lectura, sin estado; reconstruirlas es instantáneo. Todos los
archivos de `sql/bi/` empiezan con `drop view if exists ... cascade` por esto.

### Conexión

Si conectas por driver de Postgres en vez de `supabase-js`, aplica la
distinción de siempre: pooler en **transaction mode (6543)** para runtime,
**session mode (5432)** o conexión directa para DDL. Un error sobre prepared
statements o `bind message` es esto. Verifica `sslmode=require`.

---

## 5. Arquitectura

```
Navegador
    │  (solo HTML y acciones; nunca SQL)
Next.js en Vercel — Server Components + Route Handlers
    │
    ├── schema  ops   → el dominio. Tablas propias, columnas tipadas.
    ├── schema  bi    → capa de lectura. Vistas puras, sin estado.
    └── Supabase Auth · Storage
```

### El schema `ops` — el dominio

Tablas propias, con **columnas tipadas de verdad**. Nada de JSON para atributos
de dominio: si un dato se filtra, se ordena o se agrega, es una columna.

`brand` · `operation` · `category` · `product` · `variant` · `warehouse` ·
`stock` · `stock_move` · `supply_availability` · `size_curve` ·
`size_curve_entry` · `purchase_order` · `purchase_order_item` · `goods_receipt`
· y lo comercial cuando llegue (`customer`, `quote`, `order`, `shipment`).

Unas 15 tablas contra las 159 de antes.

### El schema `bi` — la capa de lectura

Vistas de **solo lectura**, separadas del dominio a propósito: deja explícito
qué es modelo y qué es consulta, y se pueden reconstruir sin miedo.

Toda pantalla de análisis lee de `bi`, no arma sus propios joins. Si una
pantalla necesita un cruce nuevo, la vista es el lugar.

### Invariantes que la aplicación debe garantizar

Sin un ORM que lo haga por nosotros, estas son responsabilidad nuestra:

- **Toda mutación de stock escribe en `stock_move`.** El saldo y el kardex se
  mueven en la misma transacción o no se mueve ninguno. Sin excepciones.
- **Las escrituras que tocan más de una tabla van en una transacción explícita.**
- **Nunca escribir en `ops` desde el SQL editor de Supabase** salvo migración de
  datos deliberada y documentada.

### Reservas de stock

El modelo es simple y no hay que complicarlo: `stock.qty` es el físico,
`stock.reserved` lo comprometido, y disponible es la resta. Un pedido sube
`reserved`; el despacho baja los dos.

Lo que no es difícil pero **sí es fácil de equivocar en silencio** son tres
cosas. Las tres son baratas si se hacen desde el principio y caras después.

**1. Reservar en una sola sentencia atómica. Nunca leer y después escribir.**

```sql
update ops.stock
   set reserved = reserved + $n
 where variant_id = $v and warehouse_id = $w
   and qty - reserved >= $n
returning *;
```

Postgres serializa solo los `update` concurrentes sobre la misma fila. Cero
filas devueltas = no había disponible. Sin locks explícitos. El error clásico
—dos vendedores leen disponible 5, ambos comprometen 4, ambos pasan— sale
natural si se escribe como `select` y luego `update`; por eso se escribe así.

**2. Un CHECK como red:** `reserved >= 0 and reserved <= qty`. Si un camino de
código se equivoca, la base lo rechaza en vez de dejar pasar una sobreventa.

**3. `reserved` tiene que poder cuadrarse.** Es un acumulado: si un solo camino
olvida restar (pedido cancelado, despacho parcial, error a media transacción),
sube para siempre. Nada falla y nada queda en un log — el disponible
simplemente se encoge. En seis meses el sistema dice 0 disponible con 40 pares
en el estante y no hay forma de saber cuál reserva sobra.

Por eso las reservas viven **también en su propia tabla**, no sólo como número
en `stock`. Así `stock.reserved` se cuadra contra `sum(reservation.qty)` con
una consulta y la deriva se detecta el mismo día. Un log te dice qué pasó si ya
sabes que algo pasó; la tabla es lo que hace la cifra verificable.

**Lo que sí requiere decisión del negocio, no técnica:** qué pasa con lo
reservado al despachar 90 de 100 pares, al cancelar después de un despacho
parcial, y cuando un conteo físico deja el stock por debajo de lo reservado.
Preguntarlo a la operación antes de codificarlo.

---

## 6. Reglas de dominio que no se negocian

Esto es lo que costó descubrir y lo que de verdad estamos rescatando. Sobrevive
al cambio de stack porque describe el negocio, no la herramienta.

### Las tres naturalezas del inventario nunca se suman

Cada una en su columna, siempre:

| | Qué es | Se puede vender |
|---|---|---|
| **Bodega** (verde) | Nuestro, físico | Sí |
| **Tránsito** (ámbar) | Despachado por la marca, sin recibir | No |
| **Por pedir** (gris) | Todavía es de la marca — su ATS | No, hay que pedirlo |

Sumar "lo propio" con "lo disponible en el proveedor" es exactamente el error
que este modelo existe para impedir. La columna se llama **«Por pedir»**, no
«Marca»: «Marca» es el nombre del fabricante, y usar la misma palabra para las
dos cosas confundía.

### La talla tiene dos representaciones y una escala

- `talla_label` para mostrar (`M 9`), `talla_valor` para ordenar y comparar.
  Alfabéticamente `M 10` va antes que `M 9`; por eso no se ordena por etiqueta.
- **La escala es parte de la identidad de la talla.** La 8 de CHILDREN y la 8 de
  MEN son zapatos distintos y no se agregan juntas. Toda vista que agrupe por
  talla agrupa también por escala.

### El grano operativo es el material, no la variante

El negocio piensa en **modelo + color** (el "material"). Las tallas van dentro.
Una lista con una fila por talla, titulada con la talla, es el grano equivocado
— ese fue el motivo original de construir pantalla propia.

### Cobertura de corrida

`tallas_con_stock / tallas_totales`. Un material con 200 pares en dos tallas
está peor surtido que otro con 60 en diez, y eso es lo que decide si hay que
reponer.

**Excluye siempre las variantes `pendiente_desglose`** (el bucket `OTRA`, donde
cae lo que no se pudo asignar a una talla de la corrida). Hay 90 en 3.064.
Incluirlas infla el denominador y hace ver peor la cobertura de lo que está.

### La etapa del embudo se deriva, no se guarda

Guardarla en una columna crea una segunda verdad que se desincroniza en cuanto
alguien despacha por otra vía. Se calcula **por cantidades, no por fechas**: un
pedido con 90 de 100 pares despachados no está despachado, está a medias, y esa
distinción es justo lo que el coordinador necesita ver.

Del estado más avanzado al menos, el primer acierto gana:
`CANCELADO · COTIZACIÓN · ENTREGADO · DESPACHADO · DESPACHO PARCIAL · EMPACADO ·
RESERVADO · PEDIDO`

Y lo que delata un atasco no es la fecha de creación sino **los días sin
avanzar** desde el último movimiento real.

### Dinero

Enteros en la unidad mínima, nunca floats. **El nombre lleva la unidad**:
`costo_usd_cents`, no `costo`. Un campo de dinero sin sufijo de unidad es un bug
esperando a pasar — ya nos pasó mezclando dólares con centavos.

### Curvas de tallas

Una curva con huecos en tallas centrales casi siempre es un error de digitación
en el origen, no una regla real. La validación automática existe (`tiene_huecos`)
y hay que conservarla.

---

## 7. Convenciones de código

```
app/                    # rutas Next.js (App Router)
  (app)/
    inventario/
    pedidos/
    embudo/
  api/                  # Route Handlers
lib/
  db/                   # acceso a datos, solo servidor
  domain/               # reglas de negocio puras y testeables
components/
supabase/
  migrations/           # generadas por el CLI, nunca a mano
sql/
  bi/                   # vistas, idempotentes, se reconstruyen enteras
etl/                    # xlsx → json (Python/JS)
scripts/                # carga y mantenimiento de datos
```

### Reglas

- **TypeScript estricto.** Nada de `any` sin un comentario que justifique por qué.
- **Español para el dominio** (labels, mensajes, docs). **Inglés para el código**
  (variables, funciones, tablas, columnas). No los mezcles dentro de un mismo
  identificador.
- **Nada de lógica de negocio en los componentes ni en los Route Handlers.**
  Las reglas viven en `lib/domain/`, donde se pueden testear sin base de datos.
- Nombres de tabla en **singular**: `brand`, no `brands`.
- Los comentarios explican **por qué**, no qué. El código ya dice qué hace.
  El estilo de comentarios de `sql/bi/` es el que queremos: cada decisión no
  obvia dice qué error previene.

---

## 8. Diseño de interfaz

Software para gente que lo usa 8 horas al día. El objetivo es que las pantallas
se sientan intencionales, no formularios genéricos.

- **Densidad alta.** Prioriza ver más datos sin scroll sobre el aire decorativo.
- **Números tabulares.** `font-variant-numeric: tabular-nums` en toda columna de
  cantidades o precios. Sin esto las cifras bailan y no se pueden comparar.
- **Color con significado consistente**, nunca decorativo. Verde lo recibido,
  ámbar lo que navega, gris lo que aún es de la marca. El mismo código en toda
  la aplicación.
- **Estado siempre visible.** En un embudo hay que saber en qué etapa está cada
  pedido sin hacer click.
- **Teclado primero** en flujos repetitivos (alistamiento, ajustes). Un bodeguero
  no debería tocar el mouse.
- **Nada de modales anidados.** Si un flujo necesita dos modales, necesita una
  página.
- **Estados vacíos, de carga y de error son parte del entregable.** Una pantalla
  sin estado de error no está terminada.
- Modo claro y oscuro con tokens, nunca colores hardcodeados.

---

## 9. Cómo quiero que trabajes

1. **Plan antes de código.** Para cualquier tarea de más de un archivo,
   escríbeme el plan primero y espera confirmación.
2. **Incrementos verificables.** Cada paso termina en algo que yo pueda correr y
   ver. No me entregues 15 archivos de una.
3. **Verifica contra la base real.** Tenemos MCP de Supabase: consulta los datos
   antes de afirmar algo sobre ellos. No supongas cifras ni esquemas.
4. **Di cuando algo no encaja**, en vez de forzarlo. Prefiero una tabla propia
   limpia que un abuso de JSON.
5. **No inventes librerías ni endpoints.** Si no estás seguro de que algo existe,
   verifícalo.
6. **No mates alcance por tu cuenta.** Si algo es más difícil de lo esperado,
   avísame; no entregues una versión simplificada haciéndola pasar por completa.

---

## 10. Estado actual

> Cifras verificadas contra la base el 14 ago 2026.

### Datos vivos en Supabase (schema `public`, versión Medusa — a migrar)

- **334 productos**, 3.064 variantes, 6 categorías
  (Boulevard · Kids · Sin clasificar · Trailhead · UNEEK · Waterfront)
- **1 marca:** KEEN (`order_unit` PACK, 12 pares de referencia)
- **1 operación:** Colombia (`CO`, COP)
- **1 bodega**, 702 niveles de inventario
- **Disponibilidad del proveedor:** 113.447 pares en ATS USA + 10.280 en
  tránsito con ETA (15/60/90 días), 3.301 filas
- **7 curvas de tallas**, ninguna con huecos, escalas M y W
- 2 órdenes de compra, 2 recepciones, 3 movimientos de kardex
- **0 órdenes de venta, 0 clientes, 0 reservas, 0 despachos**
- 329 de 334 productos con foto

### Pendientes heredados — siguen vigentes

- [ ] **Costeo de importación y precios COP — en hold por decisión del negocio.**
      Sin costo nacionalizado, cualquier margen que muestre el sistema es falso.
      **No construyas pantallas de margen hasta que esto se resuelva.**
- [ ] **UPC/EAN por talla.** 3.106 códigos reales de KEEN esperando en
      `data/upc-keen.json`, sin cargar. Es lo que habilita el lector de código de
      barras en alistamiento.
- [ ] **Fotos en CDN ajeno.** Las URLs apuntan a servidores de terceros
      (Shopify y el catálogo público de KEEN). Migrar a Supabase Storage sigue
      pendiente; si esas URLs mueren, se cae el catálogo visual.
- [ ] **No hay curvas para escalas de niño.** Sólo M y W, pero el catálogo tiene
      CHILDREN, TOTS y YOUTH. Pedir a la marca en esas escalas no está resuelto.
- [ ] **KEEN hardcodeado en los loaders.** El filtro de marca ya es multimarca,
      pero cargar una segunda marca todavía exige editar código.
- [ ] **Cobertura de tallas cuenta la variante `OTRA`.** La pantalla de
      Inventario infla el denominador; `v_cobertura_corrida` sí la excluye. Las
      dos dan cifras distintas para lo mismo — al portar, unificar en la regla
      correcta (§6).

---

## 11. Plan de migración

Todo ocurre **dentro del mismo proyecto Supabase**: el schema `ops` nace al lado
de `public`. Los datos viejos quedan consultables, la migración es
`INSERT … SELECT` entre schemas, y los dos mundos conviven mientras se compara.
Sin exportar, sin importar, sin big bang.

- [x] **Fase 0 · Red de seguridad.** `migracion/caracterizacion.sql` +
      `migracion/verificar.mjs`. **31 chequeos, todos en verde** (`pnpm verificar`,
      sale 1 si algo falla). Escrito contra las vistas `bi.*`, no contra las
      tablas: sus nombres y columnas de salida no cambian entre Medusa y `ops`,
      así que **el archivo no se toca en toda la migración**. Si hay que
      editarlo para que pase, algo se rompió de verdad.
      Incluye chequeos de *conservación* (`fact_stock` = `v_posicion`) que
      atrapan un join que duplica o pierde filas — el error más probable al
      reescribir las vistas.
- [x] **Fase 1 · Schema `ops`.** `migracion/001_schema_ops.sql` — **17 tablas,
      77 restricciones**, aplicado. El metadata JSON quedó aplanado a columnas
      tipadas: el contrato implícito de 9 claves desapareció por construcción.
      IDs `bigint identity`, claves de negocio (`material`, `sku`, `code`) con
      UNIQUE aparte. RLS activado en las 17.
      Hallazgo: `scale` estaba duplicada en producto y variante; las únicas 90
      filas donde diferían eran las variantes fuera de corrida, con escala nula.
      Ahora vive sólo en `product`.
- [x] **Fase 2 · Migración de datos.** `migracion/002_migrar_datos.sql`, en una
      sola transacción (582 ms). **Las 16 entidades cuadran fila a fila** contra
      `public`, y los totales también: 278 en bodega · 10.280 en tránsito ·
      113.447 por pedir · 90 variantes fuera de corrida · medias tallas intactas
      (`numeric(4,1)`, sin redondeo).
      NEWPORT BISON reconstruido desde `ops` da 10 / 72 / 588 y 3 de 12 tallas,
      idéntico al test de caracterización.
      Las 4 variantes sin precio USD también faltan en `public`: la migración es
      fiel, no incompleta.
- [x] **Fase 3 · Vistas `bi` sobre `ops`.** `migracion/003_vistas_bi.sql`.
      **El test de Fase 0 pasó sin tocarle una línea: 31/31 en verde.**
      Confirmado también a nivel de catálogo (`pg_depend`): la capa `bi` ya no
      referencia ni una tabla de `public` — Medusa podría apagarse hoy y estas
      pantallas seguirían funcionando.
      Solo 5 vistas se reescribieron de verdad (`dim_operation`, `dim_variant`,
      `fact_stock`, `fact_supply`, `v_posicion`); las que solo leen
      `bi.v_posicion` (`v_cobertura_corrida`, `v_valorizacion`,
      `v_resumen_talla`) no cambiaron de lógica.
      Dos simplificaciones deliberadas: `producto` ya no viene del `title` de
      Medusa (estaba truncado por el límite de columna — un color real
      quedaba cortado); y `en_camino` se eliminó de `fact_stock` por ser una
      copia redundante de `fact_supply.en_transito` que `v_posicion` nunca leía.
      `v_embudo`/`v_embudo_resumen` quedan como vistas vacías con el contrato
      de columnas del original — la lógica real migra en la Fase 5, cuando
      exista `ops.order`.
- [~] **Fase 4 · App Next.js.** `web/` — proyecto propio, separado del código
      de Medusa en la raíz (que sigue intacto, sin tocar). **Inventario
      portado y verificado contra el servidor real**, no solo `build`:
      `pnpm build` limpio, servidor arrancado con `next start`, y la página
      SSR consultada por HTTP reprodujo los mismos totales congelados en la
      Fase 0 — 278 en bodega · 10.280 en tránsito · 113.447 por pedir · 334
      materiales, con los 334 renderizados en la tabla y 68 con al menos un
      par propio (334 − 266 «sin stock» de la tarjeta, cuadra solo).
      Pedidos y Embudo quedan para la siguiente entrega — sus enlaces en el
      nav están deshabilitados con «pronto» en vez de apuntar a una ruta que
      no existe.

      **Decisión tomada sin poder consultarte:** el MCP de Supabase estaba
      caído y no había forma de conseguir las claves `anon`/`service_role`
      para `supabase-js`. La app lee con `pg` directo contra el pooler de
      runtime (mismo patrón que `migracion/*.mjs`, permitido por CLAUDE.md
      §4). Cuando existan las claves, cambia `lib/db/pool.ts` — las páginas no
      se tocan.

      Arquitectura: Server Components leen `bi.*` vía `lib/db/` (acceso a
      datos) y `lib/domain/` (reglas puras, testeables sin base de datos —
      `calcularResumen`, `elegirMarcaEnJuego`). Los filtros son un único
      Client Component que navega con `searchParams`; la fila expandible de
      tallas es el otro. Todo lo demás es servidor. `loading.tsx` y
      `error.tsx` cubren los estados que antes eran manuales con `useState`.

      Dos simplificaciones honestas: no hay enlace al producto (el CRUD
      propio no existe todavía — antes enlazaba al admin de Medusa); y las
      fotos siguen sirviéndose desde el CDN de Shopify/KEEN, pendiente
      migrar a Supabase Storage (heredado, ver pendientes).
- [~] **Fase 4 · Pedidos (orden de compra a la marca).** `web/app/pedidos/` —
      la grilla de armado, portada de `src/admin/routes/pedidos/page.tsx`.
      Bultos × curva = cantidades, ajuste a mano por celda, Enter-al-siguiente,
      las tres cifras de posición bajo cada material. Lógica de cálculo en
      `lib/domain/pedidos.ts` (pura, sin DB — testeable sola).
      **Verificado en vivo por los dos lados:**
        · Lectura: catálogo real servido — 269 materiales con disponibilidad,
          idéntico entre el pie de página renderizado y una consulta SQL
          independiente; 13 columnas de talla correctas.
        · Escritura: se ejecutó la secuencia real de `crearPedido` contra la
          base (no un mock) — generó `PO-CO-KEEN-0003` siguiendo el correlativo
          de los 2 pedidos existentes, la cascada cabecera→ítem→talla se leyó
          de vuelta intacta, y se limpió: la base quedó en los mismos 2
          pedidos del principio.
      **Simplificación real de dejar Medusa:** el workflow de un solo step con
      compensación manual (`create-order.ts`) se volvió una transacción de
      Postgres — el rollback lo hace la base sola, sin llevar la cuenta de qué
      borrar si algo falla a medias.
      **Deliberadamente fuera de esta entrega** (CLAUDE.md §7 — no hacer pasar
      una porción por el todo): las transiciones de estado
      (QTY_CHECKED → CLIENT_APPROVED → DISPATCHED, esta última crea tránsito) y
      la importación desde Excel con vista previa. El pedido creado hoy queda
      en DRAFT.
      **Embudo no se construyó.** Depende de `ops.order`, que no existe —
      vestir esa pantalla antes de tener el dominio comercial sería construir
      sobre un modelo que la Fase 5 va a rediseñar. Su enlace en el nav queda
      deshabilitado con «pronto».

- [x] **Fase 4 · Transiciones del pedido a la marca.** Bandeja en `/pedidos`
      (el armado se movió a `/pedidos/nuevo`, que es la jerarquía natural).
      Ciclo completo Montado → Cantidades revisadas → Aprobado → Despachado,
      con la tabla de transiciones en `lib/domain/purchase-order.ts` (pura) y
      la validación dentro de la transacción con `select … for update` — el
      botón que pintó el navegador nunca decide.
      El despacho usa `quantity_confirmed`, no `quantity_requested`: lo que
      viaja es lo que la marca confirmó.
      **Simplificación al salir de Medusa:** la versión anterior además
      proyectaba a `inventory_level.incoming_quantity` sólo para que el admin
      de Medusa mostrara el tránsito — una segunda escritura que podía
      divergir. `bi.v_posicion` lo lee directo de `supply_availability`, así
      que esa proyección desapareció.
      *Pendiente:* editar `quantity_confirmed` talla a talla (hoy «Cantidades
      revisadas» confirma todo lo pedido) e importar desde Excel.

- [x] **Fase 5 · Comercial.** `migracion/003_schema_comercial.sql` —
      `customer`, `sales_order`, `sales_order_line`, `reservation`, `shipment`,
      `shipment_line`. 23 tablas en `ops`, 109 restricciones.
      Decisiones: **`sales_order`, no `order`** (palabra reservada; el costo de
      `ops."order"` sería permanente y renombrar hoy cuesta cero — el contrato
      decía `ops.order`, se cambió a propósito). **La cotización no es otra
      tabla**, es el mismo documento en estado COTIZACION: separarlas obligaría
      a copiar líneas al confirmar, y ahí se pierde el rastro de qué se cotizó.
      `migracion/004_bi_embudo.sql` reescribe `bi.v_embudo` sobre `ops` y añade
      **`bi.v_reserva_cuadre`**, que hace auditable a `stock.reserved`: cada
      fila con `cuadra = false` es un bug, y la pantalla de Embudo lo muestra
      arriba en rojo si aparece.

- [x] **Fase 4 · Embudo.** `/embudo` — tablero por etapa más detalle, ordenado
      por días sin avanzar (es la pantalla de destrabar, no de contemplar).

      **Verificado con un ciclo comercial real de punta a punta**
      (`migracion/prueba-ciclo-comercial.mjs`, 14 comprobaciones, limpia todo
      al terminar): cotización → pedido → reserva → empaque → despacho parcial
      → despacho → entrega, comprobando en cada paso que la vista deriva la
      etapa correcta. Los dos casos que importan:
        · la reserva atómica de 999 unidades sobre stock cero afectó **0 filas**
          — no sobrevendió;
        · `stock.reserved` cuadró contra las reservas activas en todos los
          pasos, incluido después del intento fallido.
      Con 2 de 3 pares despachados la etapa dio DESPACHO PARCIAL, no
      DESPACHADO: la regla de calcular por cantidades y no por fechas quedó
      probada, no sólo escrita.

- [x] **Fase 5 · Pantallas comerciales.** `/clientes`, `/ventas`,
      `/ventas/nueva`, `/ventas/[id]`. El ciclo completo se opera por interfaz:
      crear cliente → cotizar → confirmar → reservar → alistar → empacar →
      despachar → entregar.
      La grilla de cotización muestra **sólo lo vendible**: bodega menos lo ya
      reservado. Ni el tránsito ni el ATS de la marca aparecen — no se pueden
      comprometer, y esa separación es justo lo que el modelo existe para
      impedir.
      El precio COP se captura a mano, con la razón a la vista en la pantalla:
      el costeo de importación está en hold y sin costo nacionalizado cualquier
      margen automático sería falso.

      **Verificado ejercitando las funciones reales de la app** (no SQL
      replicado): 20 comprobaciones sobre `lib/db/*.ts`, limpiando todo al
      terminar. Lo que quedó probado:
        · reservar una COTIZACIÓN se rechaza — una propuesta no compromete stock;
        · al reservar, `qty` NO cambia y `reserved` sube: la mercancía sigue en
          el estante, sólo deja de estar disponible;
        · al despachar, `qty` baja, `reserved` vuelve a su valor, y queda **un
          asiento en el kardex** con `kind='SALE'`, cantidad **-2** y
          `balance_after` correcto — la invariante de CLAUDE.md §5 (toda
          mutación de stock escribe kardex) probada, no sólo escrita;
        · `bi.v_reserva_cuadre` dio 0 descuadres en todos los pasos.

      Las reservas pasan a CONSUMIDA al despachar, no a LIBERADA: no se
      soltaron, se convirtieron en salida. Confundirlas rompería el cuadre.

- [x] **Autenticación con Supabase Auth + marca.** `middleware.ts` protege
      TODA la app; la lista es de **permitidos** (`/login`, `/auth`), no de
      bloqueados, para que una ruta nueva quede protegida por defecto cuando
      alguien olvide actualizarla.
      Se usa `getUser()` y no `getSession()`: `getSession` sólo lee la cookie,
      que el navegador puede falsificar; `getUser` valida el token contra
      Supabase.
      Supabase Auth se usa **sólo para identidad**. Los datos del ERP siguen
      leyéndose con `pg` directo contra `ops`/`bi` — el navegador nunca habla
      con Postgres.
      Logo real de Altura en el marco y en el login. Es negro con fondo
      transparente (RGBA verificado), así que en modo oscuro se invierte a
      blanco con `dark:invert` en vez de mantener un segundo archivo.

      **Verificado de punta a punta contra el servidor real** (17
      comprobaciones): las 6 rutas protegidas redirigen a `/login` sin sesión
      conservando el destino en `?desde=`; con sesión válida las 5 pantallas
      responden 200 y traen los datos reales (334 materiales, 113.447 por
      pedir, `PO-CO-KEEN-0001`); `/login` con sesión redirige adentro; una
      contraseña incorrecta da 400; y **una cookie con el token alterado no da
      acceso** — redirige al login.

      Usuario inicial creado: `santiago@themagichack.com`. **La contraseña es
      temporal y hay que cambiarla.**

- [x] **Desplegado en Vercel.** Proyecto `alturabrands-ops`, enlazado al repo
      de GitHub: cada push a `main` despliega solo.
      `web/` es el root directory; el código de Medusa en la raíz no se toca.

- [x] **Control de acceso — hallazgo del despliegue.** El registro público de
      Supabase Auth estaba **abierto**, y el middleware sólo comprobaba que
      hubiera *una* sesión válida, no de quién. Cualquiera podía crear cuenta
      con su correo, confirmarla y entrar al ERP completo. Se verificó creando
      una cuenta desde fuera con la clave publishable.
      Ahora `ops.app_user` es la lista de autorizados — enlazada por correo y
      no por el uuid de `auth.users`, para poder dar de alta a alguien antes de
      que se registre, que es el orden real.

      **La comprobación va en el middleware, NO en el layout.** Se intentó
      primero en el layout y **filtraba**: Next renderiza la página en paralelo
      con el layout, así que al llamar a `redirect()` los datos ya estaban
      calculados y viajaban en el cuerpo del 307 — 503 KB con el inventario
      completo, invisibles en el navegador pero legibles con `curl`. Ese cuerpo
      son ahora 11 bytes. El middleware corre en runtime `nodejs` para poder
      consultar Postgres, con caché de 30 s.
      Si falta la base o la consulta falla, se **niega** el acceso.

- [x] **Los dos embudos, separados.** Son cosas distintas y por eso se modelan
      distinto — es la decisión que hay que entender antes de tocarlos:

      **`/operaciones`** (antes `/embudo`). La etapa se **deriva** de hechos:
      reservas, empaques, despachos. Guardarla crearía una segunda verdad que
      se desincroniza en cuanto alguien despacha por otra vía. Por eso ahí no
      se arrastra nada — mandan los hechos.

      **`/embudo`**, comercial. La etapa es el **juicio del vendedor** sobre
      dónde está la conversación: «está evaluando», «estamos negociando». No
      hay ningún hecho del que deducirla, así que si no se guarda no existe.
      Por eso es una columna (`ops.sales_order.etapa_comercial`) y por eso sí
      se arrastra.

      Tablero kanban con drag & drop **nativo de HTML5, sin librerías**, más
      vista lista. El movimiento es optimista y se revierte si el servidor
      rechaza. `orden_tablero` usa huecos de 100 para insertar en medio sin
      reescribir la columna entera.

      **Arrastrar tiene consecuencias reales, no cosméticas:** soltar en
      *Ganado* confirma el pedido y habilita reservar; en *Perdido* lo cancela
      y **libera el inventario reservado**; sacarlo de *Ganado* también libera,
      porque una propuesta no debe retener stock que otro cliente podría
      llevarse. Mover algo ya despachado se rechaza: eso salió por la puerta y
      no se deshace arrastrando una tarjeta.

      Hallazgo de la prueba: una cotización nacía en `PROSPECTO` por el default
      de la columna, pero **ya tiene líneas y precios** — llamarla «interés sin
      números todavía» era mentir. Nace en `COTIZADO`; `PROSPECTO` queda para
      arrastrar hacia atrás y para una futura captura de interesados.

- [ ] **Pendientes conocidos.**
      · **Poner las 3 variables de entorno en Vercel** — hasta entonces la app
        desplegada muestra el aviso de configuración y no deja entrar.
      · **Cerrar el registro público en el dashboard de Supabase** (Auth →
        Providers → Email → *Allow new users to sign up*). La lista de
        autorizados ya protege el ERP, pero sin esto siguen pudiendo crearse
        cuentas sueltas en el proyecto.
      · **Cambiar la contraseña temporal** del usuario inicial.
      · **El repo de GitHub es público.** No hay credenciales dentro (se
        verificó antes de cada commit), pero el código y el modelo de datos son
        visibles. Decidir si debe pasar a privado.
      · Roles: `ops.app_user.rol` existe con cuatro valores pero **ningún
        permiso está aplicado todavía** — cualquier autorizado puede todo.
      · Editar `quantity_confirmed` talla a talla. Importar pedidos desde
        Excel. Devoluciones. Transferencias entre bodegas.
- [ ] **Fase 6 · Integración de facturación** (Siigo u otro) por API.
- [ ] **Fase 7 · Retirar Medusa.** Borrar las 159 tablas de `public` y las
      dependencias. Sólo cuando la Fase 4 esté en uso real.

### La regla del orden

Los loaders y el ETL se tocan **al final**, no al principio. Hoy están arriba en
la cadena de dependencias y son lo más frágil; dejarlos para después significa
que cuando se toquen ya existe con qué verificarlos.
