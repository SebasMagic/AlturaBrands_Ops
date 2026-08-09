# CLAUDE.md — Mini ERP AlturaBrands

Contrato de trabajo. Léelo completo antes de escribir código. Si algo aquí
contradice tu intuición por defecto, **gana este archivo**.

> **Cambio de rumbo, agosto 2026.** La primera versión se construyó sobre
> Medusa v2. Se abandonó: arrastraba una plataforma de comercio entera
> (carrito, checkout, pagos, promociones) de la que usábamos el 30%, y su
> back-office hablaba de *Products* y *Orders* cuando el negocio habla de
> materiales, bultos e importaciones. El contrato viejo se conserva en
> `docs/ARCHIVO-contrato-medusa.md`; tiene detalle técnico que sigue siendo
> cierto. **Lo que aquí se conserva íntegro es el conocimiento del dominio de
> §5 en adelante: eso costó análisis, no código, y no depende de ningún stack.**

---

## 1. Qué es AlturaBrands

Un **distribuidor mayorista multimarca de calzado**, con operación en varios
países. Compra a las marcas (KEEN y las que vengan), importa, y vende al por
mayor a minoristas.

El ciclo real del negocio:

```
disponibilidad de la marca  →  se monta pedido  →  la marca ajusta cantidades
   →  se aprueba  →  la marca despacha  →  importación (tránsito)
   →  llega a bodega  →  se vende a un minorista  →  se despacha  →  entregado
```

Dos embudos distintos que se tocan en la bodega: **compra/importación** y
**venta/despacho**. Confundirlos es el error de modelado más caro que se puede
cometer aquí.

## 2. Alcance

**Dentro:**

| Dominio | Qué resuelve |
|---|---|
| **Catálogo** | Materiales, variantes por talla, marcas, categorías, curvas |
| **Disponibilidad** | Lo que la marca tiene y aún no es nuestro |
| **Compras** | Pedido a marca, ajuste, aprobación, despacho, tránsito |
| **Inventario** | Stock por bodega, reservas, ajustes, transferencias, kardex |
| **Ventas** | Cotización → pedido, clientes, listas de precio |
| **Despacho** | Reserva → alistamiento → empaque → despacho → entregado |
| **BI** | Posición, cobertura de corrida, valorización, lead times |

**Fuera, y no lo adelantes:** contabilidad, cuentas por cobrar/pagar,
facturación electrónica DIAN, nómina, POS, tienda en línea. **No hay carrito,
ni checkout, ni pasarela de pagos.** Esto es back-office.

---

## 3. Multitenancy — la decisión estructural

**No es multitenant en el sentido SaaS.** Es *una* empresa con operaciones en
varios países. Nadie a quien ocultarle datos: la gerencia necesita consolidar.
Lo que se busca es **separación operativa** — que el equipo de Colombia vea
Colombia — y eso es un problema de permisos, no de infraestructura.

**Una sola base de datos. El país es una dimensión, no una frontera.**

Razones, en orden de peso:

1. **El reporte consolidado es un `group by`**, no un ETL entre bases.
2. **Partir después es fácil; fusionar es un proyecto.** Separar una base
   centralizada por país es un `where` y un dump filtrado. Fusionar cinco bases
   con ids que colisionan, no.
3. **Una migración, un despliegue.** N bases significan N esquemas divergiendo.

**Lo único que cambiaría esto**: que un país exija por ley residencia de datos
en su territorio. Entonces *ese* país sale a base propia. Híbrido, no todo o
nada.

### Cómo se implementa

- Toda tabla de negocio lleva **`operation_id`**, sin excepción.
- **RLS de Postgres es el mecanismo de aislamiento**, no un filtro en el
  frontend. Un `where` olvidado en la aplicación es una fuga; una política RLS
  no se olvida.
- El JWT de Supabase Auth lleva las operaciones del usuario. Las políticas leen
  de ahí.
- La gerencia tiene un rol que ve todas las operaciones.

> Esto invierte una regla del contrato anterior, que **prohibía** RLS y Supabase
> Auth. Aquella prohibición era correcta *entonces*: Medusa se conectaba con un
> rol de servicio, hacía bypass de RLS y traía su propio sistema de identidad,
> así que RLS daba falsa sensación de seguridad y Auth duplicaba la verdad. Sin
> Medusa, ambas cosas pasan a ser la columna vertebral.

---

## 4. Stack

- **Base de datos:** PostgreSQL en Supabase. Es el centro, no un detalle.
- **Autorización:** RLS + Supabase Auth (JWT con claims de operación y rol).
- **API de lectura:** PostgREST (lo que Supabase expone solo). Para leer, no
  hace falta escribir endpoints.
- **Lógica de negocio:** funciones Postgres (`plpgsql`) para lo transaccional,
  y un servicio Node/TypeScript delgado para lo que necesite orquestación,
  archivos o integraciones.
- **Archivos:** Supabase Storage (fotos, remisiones, evidencias de entrega,
  tickets de despacho).
- **ETL:** Python + pandas. Ya probado, se conserva.
- **Frontend:** propio, lo desarrolla el equipo. Este repositorio expone datos
  y reglas; no impone interfaz.

### Por qué la lógica crítica va en la base

Las reservas de inventario y las transiciones de estado **deben ser atómicas**.
Una reserva calculada en el frontend y escrita en dos pasos es una sobreventa
esperando a ocurrir cuando dos vendedores toquen el mismo par a la vez.

Esto era lo único que Medusa aportaba de verdad, así que hay que reponerlo con
seriedad: constraints, transacciones y funciones. No con confianza en que el
cliente haga lo correcto. **Ver §8.**

---

## 5. El dominio, tal como es

> Todo lo de esta sección se descubrió analizando los archivos reales del
> negocio, no se supuso. Son los cimientos.

### 5.1 La jerarquía

```
Marca (KEEN, …)
  └─ Modelo         (JASPER ZIONIC)          73 modelos
      └─ Material   (1031790)               334 materiales   ← clave de negocio
          └─ Talla  (M 9.5)               3.064 variantes
```

**`Material` es un entero de 7 dígitos y es LA clave de negocio.** Verificado:
ningún material tiene dos modelos, géneros, categorías ni precios de lista
distintos. Un material es un modelo en un color concreto.

`Descripcion material` codifica `MODELO G-COLOR`, pero **viene truncada a 40
caracteres**. Sirve para recuperar un color ausente solo como último recurso;
la columna `Color` y el cruce por material mandan.

### 5.2 La talla lleva escala, siempre

Las corridas reales:

| Género | Corrida |
|---|---|
| MEN | 7 – 13 |
| WOMEN | 5 – 12 |
| CHILDREN | 8 – 13 |
| YOUTH | 1 – 7 |
| TOTS | 4 – 7 |

**Una 8 de CHILDREN no es una 8 de MEN.** Como columnas de Excel comparten
celda; como dato son zapatos distintos. Guardar `8` a secas hace que cualquier
reporte agregado sume peras con manzanas.

Convención: **etiqueta con escala** (`M 8`, `W 5.5`, `C 10`, `Y 4`, `T 5`) para
mostrar, y **escala + valor numérico separados** para ordenar y comparar.

El valor numérico es **decimal**, no entero. Media talla es media talla.

### 5.3 Existencias: tres naturalezas que jamás se suman

Del archivo maestro, 123.983 pares:

| Origen | Pares | Qué es |
|---|---:|---|
| **Bodega Matriz** | **268** | **Nuestro. Vendible.** |
| Tránsito 15/60/90 días | 10.268 | Comprado, no recibido |
| ATS USA | 113.447 | Disponibilidad de la marca. **No es nuestro** |

**El 91,5% del archivo es inventario que no poseemos.** Si ATS USA se modela
como bodega, un vendedor comprometerá 113.000 pares que habría que comprar
primero. **Vender de ATS exige antes una orden de compra.**

Regla: **una sola cosa es inventario — lo que está en nuestras bodegas.** Lo
demás es *disponibilidad*, y vive en otra tabla que no admite reservas.

### 5.4 Bultos y curvas de talla

Las marcas no venden pares sueltos: venden **bultos**, paquetes cerrados con
una distribución fija por talla.

```
cantidades = bultos × curva
```

Verificado en 35 de 36 líneas del pedido real de KEEN. Las 7 curvas reales:

```
MEN    núcleo  8.5:2  9:2  9.5:2  10:1  10.5:1  11:1
       arrancan en 7, 7.5, 8 u 8.5          → 4 curvas, 9 a 12 pares
WOMEN  núcleo  6.5:2  7:3  7.5:2  8:1  8.5:1
       arrancan en 5, 5.5 o 6               → 3 curvas, 10 a 12 pares
```

**La curva es una regla de la MARCA, no del producto ni del negocio.** KEEN pide
en bultos; otra marca aceptará pares sueltos. Modelarlo como constante global
obliga a rehacerlo con la segunda marca.

**El equipo ajusta las curvas.** Una línea de pedido guarda **la curva aplicada
más los ajustes**, nunca una curva inventada. Así queda registrado "usó
KEEN-M-01 y quitó la 10.5", que responde preguntas de negocio.

> **Cómo distinguir una curva real de un pedido ajustado:** por el **hueco
> interno**, no por la longitud. Una corrida que arranca en la 8 en vez de la 7
> es plausible — hay modelos que no se surten en tallas pequeñas. Una que va de
> la 7 a la 11 y se salta la 8.5 no tiene lectura comercial, porque la 8.5 es de
> las que más rotan. De 12 distribuciones observadas, 7 eran curvas y 5 eran la
> curva estándar con una talla borrada a mano.

### 5.5 Trampas del archivo maestro

Cosas que parecen obvias y no lo son. Todas verificadas:

- **`Total pares` NO incluye `Otras tallas`.** Es la suma de las tallas
  numeradas y nada más. Cualquier reporte que use esa columna como total
  subestima el inventario en 9.403 pares.
- **`Otras tallas` son 9.403 pares sin talla identificable** (WIDE y fuera de
  corrida 1-13). **16 materiales existen ÚNICAMENTE ahí**: ignorar esa columna
  los borra del catálogo. Van como variante marcada *pendiente de desglose*.
- **`Precio PA` cambia de significado según la bodega.** En Bodega Matriz es
  **nuestro costo**; en las demás es **precio del proveedor**. Verificado: 24 de
  36 materiales compartidos tienen valores distintos. Mezclarlos corrompe
  cualquier margen. Van en **campos separados**.
- **Filas duplicadas por (bodega, material) son lotes parciales** con tallas
  distintas, no errores. **Se suman.**
- **`Reserva Otros Terr.` está en cero en todo el archivo.** Es un espacio
  previsto para cuando la marca aparte inventario para otros distribuidores.
  Hoy no aparta nada. No es bloqueante — pero el día que deje de ser cero,
  `Neto Colombia` deja de ser igual a `Total pares` y hay que respetarlo.
- **`Faltante pares (stock ATS)` sí importa**: 24 líneas y 119 pares donde el
  pedido superó lo disponible. **La pantalla de pedido debe validarlo en vivo.**
- Las 3 últimas filas del archivo son totales y notas. Descartar.

### 5.6 Estado del catálogo actual

```
424 filas · 334 materiales · 3.064 variantes · 123.983 pares
73 modelos · 207 colores

Género     WOMEN 193 · MEN 168 · CHILDREN 33 · YOUTH 25 · TOTS 5
Categoría  Boulevard 100 · Waterfront 72 · Trailhead 65 · Kids 63 ·
           Sin clasificar 19 · UNEEK 15

Margen bruto sobre lo propio: ~70%  ($10.541 costo → $36.775 lista)
```

**El surtido está roto, y el sistema debe hacerlo visible.** Materiales con 1
o 2 tallas cubiertas de una corrida de 12, con cientos de pares disponibles en
la marca. Una corrida rota no se vende: no es que falte mercancía, es que la
que hay no forma talla completa. **La cobertura de corrida es la métrica que
decide la reposición**, más que el total de pares.

---

## 6. Modelo de datos

Esquema propio, sin herencia de ningún framework. Nombres en inglés.

```
operation          país/operación. CO, PE, MX. Moneda, estado.
brand              marca. Reglas de pedido: unidad (pack/pair).
size_curve         curva + entries(size_label, size_value, ratio)
                   ligada a marca. size_value es NUMERIC, no integer.

product            = material. brand, model, gender, category, color,
                   size_scale, msrp_cents, supplier_price_cents, cost_cents
variant            = talla. sku, size_label, size_value, is_pending_breakdown

warehouse          bodega. Pertenece a una operación.
stock              (variant, warehouse) → on_hand, reserved, incoming
stock_move         kardex. TODA variación de stock deja rastro aquí.

supply_availability  lo que NO es nuestro. variant, source, kind
                     (SUPPLIER | IN_TRANSIT), eta_days, quantity

purchase_order       cabecera: operation, brand, status, fechas por tramo,
                     dispatch_ticket
purchase_order_item  por material: curva aplicada, bultos, ajuste
purchase_order_size  por talla: requested vs confirmed

customer / sales_order / sales_order_line / reservation / shipment
```

### Reglas del esquema

- **`operation_id` en toda tabla de negocio.** Sin excepción, desde el día uno.
  Añadirlo después, con dos países dentro y datos sin marcar, es arqueología.
- **Dinero en enteros de centavos**, con sufijo `_cents` en el nombre. Nunca
  floats. La unidad debe ser evidente al leer el código.
- **`quantity_confirmed` nullable a propósito**: nulo es "sin revisar", cero es
  "revisado y no hay". Esa diferencia lo es todo al reclamar a la marca.
- **Cada transición sella su propia fecha.** Con solo `updated_at` es imposible
  reconstruir cuánto tardó cada tramo, que es de donde sale el lead time real
  por marca.
- **Los estados no se guardan si se pueden derivar.** Una columna `etapa` se
  desincroniza el día que alguien opere por otro camino. Derivar es una vista.
- **Nada se borra: se anula.** Un pedido es un hecho. Cancelar lo saca del
  tablero y libera reservas; borrarlo hace irreproducible por qué se pidió lo
  que se pidió.

---

## 7. Reglas por marca

Cada marca impone sus condiciones y el sistema debe absorberlas **como datos, no
como código**:

- Unidad de pedido: bulto cerrado o par suelto
- Curvas de talla propias
- Formato del archivo de pedido
- Lead time típico
- Reglas de asignación por territorio

**Hoy solo conocemos KEEN.** Cualquier regla que se codifique como constante
global habrá que rehacerla con la segunda marca. Si dudas, hazla dato.

---

## 8. Invariantes — lo que el sistema no puede permitir

Estas son las que justifican que la lógica viva en la base. **Cada una necesita
su constraint o su función; ninguna se confía al frontend.**

1. **No se puede reservar más de lo disponible.** `reserved <= on_hand`, con
   check constraint. La reserva se hace en una función transaccional, no con un
   `select` seguido de un `update`.
2. **No se puede vender de `supply_availability`.** Es tabla aparte y no tiene
   reservas. Vender de ahí exige antes una orden de compra recibida.
3. **Todo movimiento de stock deja rastro en `stock_move`.** El saldo debe poder
   reconstruirse sumando el kardex. Si no cuadra, hay un camino que se saltó las
   reglas.
4. **Un pedido no salta etapas.** De Montado a Despachado sin que la marca
   confirme cantidades metería en tránsito unidades que nadie verificó.
5. **Lo que viaja es lo confirmado, no lo pedido.** Usar `requested` en vez de
   `confirmed` infla el tránsito con unidades que nunca salieron.
6. **Un SKU es único en todo el catálogo.** Formato `{material}-{escala}{talla}`
   → `1030343-M8`.
7. **El total de un pedido cuadra con la suma de sus tallas.** Siempre.

---

## 9. Cómo quiero que trabajes

1. **Plan antes de código.** Para cualquier tarea de más de un archivo,
   escríbeme el plan y espera confirmación.
2. **Incrementos verificables.** Cada paso termina en algo que yo pueda correr y
   ver. No me entregues 15 archivos de una.
3. **Verifica contra la base, no contra el log.** "La migración corrió" no es
   evidencia; "hay 143 tablas y estas 12 existen" sí lo es. Este hábito ya
   encontró cuatro bugs que el typecheck no veía.
4. **Consulta la doc oficial antes de asumir una API.** Si la doc y tu memoria
   difieren, gana la doc.
5. **Di cuando algo no encaja.** Prefiero un modelo limpio que un abuso de
   metadata. Y si me equivoco yo, dilo.
6. **No mates alcance por tu cuenta.** Si algo es más difícil de lo esperado,
   avísame; no entregues una versión simplificada haciéndola pasar por completa.
7. **Los datos del negocio se verifican, no se suponen.** Cada afirmación sobre
   el dominio de §5 salió de contar filas. Mantén ese estándar.

### Convenciones

- **Español** para dominio, UI, mensajes y documentación.
  **Inglés** para código: variables, funciones, tablas, columnas.
- TypeScript estricto. Nada de `any` sin un comentario que lo justifique.
- SQL: una migración por cambio, numerada. **Nunca edites una ya aplicada.**

---

## 10. Trampas técnicas ya pagadas

Cada una costó tiempo real. No las repitas.

### Supabase / Postgres

- **Dos conexiones, no una.** Pooler en *transaction mode* (`6543`) para
  runtime; *session mode* (`5432`) para DDL y migraciones. El transaction pooler
  rompe prepared statements y las migraciones fallan de forma confusa.
- **`uselibpqcompat=true` es obligatorio** en la cadena. Desde `pg` 8.16,
  `sslmode=require` se interpreta como `verify-full` y el certificado del pooler
  no encadena con las CA del sistema: la conexión muere con
  `SELF_SIGNED_CERT_IN_CHAIN`. Endurecerlo fijando la CA de Supabase queda
  pendiente para producción.
- **La conexión directa (`db.<ref>.supabase.co`) es solo IPv6.** Funciona desde
  una casa con IPv6 y falla al desplegar donde no lo haya. Usa el pooler.
- **El prefijo del host del pooler (`aws-0` / `aws-1`) varía por proyecto** y
  ambos resuelven por DNS. No lo adivines: pruébalo conectando.
- **Una vista bloquea `ALTER COLUMN`.** Postgres no deja cambiar el tipo de una
  columna de la que cuelga una vista. Si hay capa de BI, el flujo de migración
  debe ser: tirar las vistas → migrar → reconstruirlas.
- **`?::text is null` con cast explícito** en filtros opcionales. Sin el cast,
  Postgres no puede inferir el tipo de un parámetro nulo y aborta con `42P18`.
- Toda columna de cantidad y precio: **`numeric`, nunca `real` ni `float`** para
  dinero. Las medias tallas sí son `numeric`; guardarlas como `integer` redondea
  7.5 a 8 y colisiona con la talla 8 real.

### Entorno

- **Nada de `node_modules` dentro de OneDrive.** Sincroniza decenas de miles de
  archivos, toma locks durante los builds y produce `EPERM` intermitentes que
  parecen bugs de la herramienta.
- **Windows y MAX_PATH.** Rutas profundas rompen `git checkout`. `git config
  core.longpaths true`, y clona con sparse-checkout lo que no necesites entero.
- **Colas y Redis por comando salen caras.** Si en algún momento se usa una cola
  con workers que sondean, un plan que cobre por comando se agota sin aviso: se
  consumieron 500.000 comandos en unas horas de servidor de desarrollo. Tarifa
  fija, o `LISTEN/NOTIFY` de Postgres para volúmenes pequeños.

---

## 11. Qué se rescata del trabajo anterior

**Íntegro, sin tocar:**

- `etl/` — transformación del maestro, extracción de curvas, lectura de hojas de
  pedido. Python y pandas, cero dependencias del stack.
- `sql/bi/` — vistas de posición, cobertura de corrida, valorización, resumen
  por talla, embudo. Se adaptan los nombres de tabla; la lógica y las decisiones
  se conservan.
- `data/master-data.json` — el catálogo canónico, con cuadre verificado par a
  par contra el Excel: **123.983 = 123.983**.
- `Master Data Inventarios.xlsx` y `Formato Pedido Keen.xlsx` — las fuentes.

**Se reescribe:** modelos, API y pantallas.

**Lo más valioso no es código:** es §5. Que ATS no sea inventario. Que la talla
lleve escala. Que las curvas se separen de los ajustes. Que la operación sea
dimensión. Eso costó análisis y viaja a cualquier stack.

---

## 12. Estado actual

- [x] Dominio analizado y verificado contra los archivos reales
- [x] ETL del maestro con cuadre par a par
- [x] 7 curvas de talla extraídas y validadas
- [x] Lectura de hojas de pedido
- [x] Vistas de BI diseñadas
- [x] Proyecto Supabase activo (`AlturaBrands-ERP`, us-east-1)
- [ ] **Esquema propio diseñado y migrado** ← siguiente
- [ ] RLS y modelo de roles
- [ ] Funciones transaccionales de inventario y reservas
- [ ] Carga del catálogo al esquema nuevo
- [ ] Compras: pedido a marca de punta a punta
- [ ] Ventas y despacho
- [ ] Capa BI reconectada
- [ ] Limpieza del esquema de Medusa

## 13. Primera tarea

Diseñar el esquema propio. En concreto:

1. Las migraciones SQL de `operation`, `brand`, `size_curve`, `product`,
   `variant`, `warehouse`, `stock` y `stock_move`, con `operation_id` en todas.
2. Los constraints que hacen imposibles las violaciones de §8 — no los que las
   detectan después.
3. Las políticas RLS y el modelo de roles: operativo por país, y gerencia
   transversal.
4. La función de reserva, atómica y a prueba de concurrencia.

Escríbeme el plan antes de tocar nada. **El esquema de Medusa se queda donde
está hasta que el nuevo funcione**: es la red de seguridad, y borrarlo antes de
tiempo deja sin punto de retorno.
