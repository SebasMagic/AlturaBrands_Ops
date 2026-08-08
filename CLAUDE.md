# CLAUDE.md — ERP Ligero (Medusa v2 + Supabase)

Este archivo es el contrato de trabajo para Claude Code en este repositorio.
Léelo completo antes de escribir código. Si algo aquí contradice tu intuición por
defecto, **gana este archivo**.

---

## 1. Qué estamos construyendo

Un **ERP operativo ligero** para gestión de ventas, inventario multi-bodega y
operaciones de despacho. No es un e-commerce: es un back-office. El usuario final
es personal interno (vendedores, bodegueros, coordinadores de despacho), no un
comprador anónimo.

Alcance de la **Fase 1** (lo único que existe por ahora):

| Dominio | Qué debe resolver |
|---|---|
| **Catálogo** | Productos, variantes, marcas, categorías, unidades de medida |
| **Inventario** | Stock por bodega, reservas, ajustes, transferencias entre bodegas, kardex |
| **Ventas** | Cotización → pedido, clientes, listas de precio, condiciones comerciales |
| **Operaciones** | Embudo de despacho: pedido → reserva → alistamiento → empaque → despacho → entregado |

**Fuera de alcance por ahora** (no lo construyas, no lo "adelantes"):
compras/proveedores, contabilidad, cuentas por cobrar/pagar, facturación
electrónica DIAN, nómina, POS.

Si una decisión de diseño de Fase 1 bloquea alguno de esos módulos futuros,
dilo explícitamente antes de implementar.

---

## 2. Stack

- **Backend / dominio:** Medusa v2 (Node 20+, TypeScript, MikroORM)
- **Base de datos:** PostgreSQL en **Supabase**
- **Cache / event bus:** Redis (local en dev, Upstash o similar en prod)
- **Admin UI:** Medusa Admin (React) extendido con Widgets y UI Routes — ver §4.5
- **Storage de archivos:** Supabase Storage
- **Hosting:** Railway (server + worker). **No Vercel** — ver §4.6
- **Gestor de paquetes:** pnpm

### Por qué Medusa y no un ERP tradicional

Medusa aporta el núcleo transaccional difícil ya resuelto: reservas de
inventario, consistencia entre órdenes y stock, y rollback en flujos
multi-paso. Ese es el 70% del riesgo técnico de un ERP operativo.
No lo reimplementes.

---

## 3. Supabase: reglas duras

Supabase es **el Postgres gestionado**, nada más. Medusa maneja su propio
schema, sus propias migraciones y su propio sistema de auth/permisos.

### Lo que SÍ usamos de Supabase
- Postgres gestionado (backups, branching, dashboard SQL)
- Supabase Storage para adjuntos (fotos de producto, remisiones, evidencias de entrega)
- Realtime **solo** para dashboards de lectura, si más adelante hace falta

### Lo que NO usamos
- ❌ **Supabase Auth** — Medusa tiene su propio módulo `auth` y `user`.
  Mezclarlos genera dos fuentes de verdad de identidad. No lo hagas.
- ❌ **RLS sobre tablas de Medusa** — Medusa se conecta con un rol de servicio
  y hace bypass. Poner RLS ahí da falsa sensación de seguridad.
  La autorización vive en la capa de aplicación (Medusa API + middlewares).
- ❌ **Escribir en tablas de Medusa desde el SQL editor de Supabase** — rompes
  invariantes del dominio. Todo pasa por workflows.

### Conexión — el gotcha crítico

Supabase expone tres modos. **No son intercambiables para Medusa:**

| Uso | Puerto / modo | Por qué |
|---|---|---|
| **Migraciones** (`medusa db:migrate`) | Conexión directa o pooler en **session mode (5432)** | El pooler en transaction mode rompe prepared statements y DDL. Las migraciones fallan de forma confusa. |
| **Runtime** de la app | Pooler **transaction mode (6543)** | Mejor manejo de conexiones concurrentes |

Configura **dos variables separadas** en `.env`:

```env
# Runtime — pooler transaction mode
DATABASE_URL=postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true

# Migraciones — session mode / conexión directa
DIRECT_URL=postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:5432/postgres
```

Si una migración falla con un error sobre prepared statements o `bind message`,
el problema es este. Revísalo antes de tocar el schema.

Verifica siempre que `sslmode=require` esté activo.

---

## 4. Arquitectura Medusa v2 — los tres conceptos que importan

Antes de escribir cualquier feature, ten claros estos tres. Casi todo error de
diseño en Medusa v2 viene de ignorar uno.

### 4.1 Módulos
Cada dominio es un paquete aislado con su propio schema y su propio servicio.
**No existen foreign keys entre módulos.** Un módulo no importa el servicio de
otro. Si sientes que necesitas hacerlo, necesitas un Link o un Workflow.

### 4.2 Module Links
La forma de relacionar entidades de módulos distintos sin acoplarlos.
Se declaran en `src/links/*.ts` y se consultan con `Query` usando `fields`.

Este es el patrón que vamos a repetir para toda entidad custom (Marca,
Proveedor, Unidad de Medida). **Nunca agregues una columna a un modelo del core
de Medusa.** Crea tu módulo y enlázalo.

### 4.3 Workflows
Funciones compuestas de pasos, con compensación (rollback) automática.
Toda operación que toque más de un módulo **debe** ser un workflow.

Reutiliza los de `@medusajs/medusa/core-flows` antes de escribir uno propio.
Si escribes uno, **cada step debe tener su función de compensación**. Un step
sin compensación en un flujo de inventario es un bug esperando a pasar.

---

## 4.5 Frontend: dónde vive la UI

### Decisión de Fase 1: todo dentro del Admin de Medusa

No construimos un frontend Next.js separado en Fase 1. Toda la interfaz vive
como extensión del Admin, mediante dos mecanismos:

- **UI Routes** (`src/admin/routes/`) — páginas completas nuevas con su propia
  entrada en la navegación. Aquí van nuestras pantallas de operación:
  despachos, kardex, alistamiento, cotizaciones.
- **Widgets** (`src/admin/widgets/`) — bloques inyectados en páginas existentes
  de Medusa. Aquí va lo que extiende entidades del core: el selector de Marca en
  la página de producto, el panel de reservas en la orden.

**Razón:** el CRUD de productos, órdenes, inventario, bodegas y clientes ya
existe y funciona. Reconstruirlo son semanas de trabajo sin valor de negocio.
Además, en Fase 1 todavía no conocemos los flujos operativos reales del cliente;
diseñar UI custom antes de eso es diseñar a ciegas.

Esta decisión **no es irreversible**. La API es idéntica en ambos escenarios,
así que migrar a un frontend propio después se hace pantalla por pantalla, sin
big bang, conservando el 100% del trabajo de dominio.

### Qué controlamos y qué no

**Control total (no te limites):**
- Todo el contenido dentro de una UI Route: layout, tipografía, color,
  componentes, interacciones, animaciones.
- Toda la lógica de proceso: máquinas de estado, validaciones, aprobaciones,
  reglas de negocio. Medusa no impone ningún flujo de negocio.
- Librería de componentes: `@medusajs/ui` está disponible, pero **no es
  obligatoria**. Tailwind ya está configurado. Si un componente propio queda
  mejor, hazlo.

**No controlamos:**
- El shell del admin: sidebar y barra superior. Podemos agregar ítems de
  navegación e íconos, pero no reemplazar la estructura del marco.

Si en algún momento el cliente exige branding completo del marco, eso es señal
para abrir la discusión de frontend separado — no lo resuelvas con hacks de CSS
sobre el shell.

### Criterio para abrir un frontend separado (Fase 2+)

Solo por una de estas tres razones. **"Que se vea mejor" no es razón.**

1. **Usuario no-admin.** Portal donde el cliente consulta pedidos, o el
   transportista confirma entregas. Esa gente no debe tener acceso al admin.
2. **Flujo operativo denso.** Pantalla de picking optimizada para escáner de
   código de barras y tablet en bodega.
3. **Mobile real.** App de conductores con GPS y firma de entrega.

Las tres son **superficies nuevas**, no reemplazos del admin.

### Guía de diseño para las UI Routes

El objetivo es que nuestras pantallas se sientan intencionales, no como
formularios genéricos pegados dentro de una plantilla.

- **Densidad de información alta.** Esto es software para gente que lo usa 8
  horas al día, no una landing. Prioriza ver más datos sin scroll sobre el aire
  y el espacio en blanco decorativo.
- **Teclado primero.** Los flujos de alta repetición (alistamiento, ajustes de
  stock) necesitan atajos y navegación por tab bien pensada. Un bodeguero no
  debería tocar el mouse.
- **Estado siempre visible.** En un embudo de despacho, el usuario debe saber en
  qué etapa está cada pedido sin hacer click. Usa color con significado
  consistente, no decorativo.
- **Números tabulares.** Usa `font-variant-numeric: tabular-nums` en toda
  columna de cantidades, precios o cantidades de stock. Sin esto las cifras
  bailan y son difíciles de comparar visualmente.
- **Nada de modales anidados.** Si un flujo necesita dos modales, necesita una
  página.
- **Estados vacíos, de carga y de error** son parte del entregable, no un extra.
  Una pantalla sin estado de error no está terminada.
- Respeta el modo claro/oscuro del admin. Usa tokens de tema, no colores
  hardcodeados.

---

## 4.6 Despliegue

**No usamos Vercel para el backend.** Medusa es un servidor Node de larga
duración: corre subscribers y scheduled jobs fuera del ciclo de request,
necesita un pool de conexiones persistente, y sirve el admin desde el mismo
proceso. Nada de eso funciona en serverless.

Arquitectura objetivo:

```
Railway (o Render / Fly)
  ├─ proceso: server   → HTTP API + Admin
  └─ proceso: worker   → jobs, eventos, colas
          │
   ┌──────┴──────┐
Supabase      Upstash
(Postgres)    (Redis)
```

- Ambos procesos corren el mismo código; se diferencian por
  `MEDUSA_WORKER_MODE` (`server` / `worker`).
- **Colocar el hosting en la misma región (o la más cercana) que Supabase.**
  Medusa hace muchas queries por request; latencia cruzada entre regiones se
  siente de inmediato.
- Vercel entra solo en Fase 2+, y únicamente para los frontends separados
  descritos en 4.5.

---

## 5. Mapeo dominio → Medusa

| Concepto ERP | Módulo Medusa | Notas |
|---|---|---|
| Producto / variante | `product` | |
| Marca | **módulo custom** `brand` + link a `product` | |
| Bodega | `stock-location` | |
| Stock por bodega | `inventory` (`InventoryItem` → `InventoryLevel`) | |
| Reserva de stock | `inventory` (`ReservationItem`) | Ya viene resuelto, no lo reimplementes |
| Cliente | `customer` + customer groups | |
| Lista de precios | `pricing` (price lists) | |
| Cotización | **custom**, sobre `cart` o entidad propia | Decidir en su momento, no ahora |
| Pedido | `order` | |
| Despacho | `fulfillment` (fulfillment sets, shipping options, providers) | |
| Canal / punto de venta | `sales-channel` | Vinculado a stock locations |

---

## 6. Convenciones de código

### Estructura
```
src/
  modules/          # módulos custom (brand/, uom/, ...)
    <modulo>/
      models/
      service.ts
      index.ts
  links/            # module links
  workflows/        # workflows custom
    <dominio>/
      steps/
      index.ts
  api/
    admin/          # rutas admin custom
    store/
  admin/            # extensiones de UI
    widgets/
    routes/
  subscribers/      # handlers de eventos
  jobs/             # scheduled jobs
  scripts/          # seed, migraciones de datos
```

### Reglas
- **TypeScript estricto.** Nada de `any` sin un comentario que justifique por qué.
- **Español para el dominio de negocio** (labels de UI, mensajes al usuario, docs).
  **Inglés para el código** (nombres de variables, funciones, modelos, tablas).
  No mezcles dentro de un mismo identificador.
- **Dinero en enteros**, en la unidad mínima de la moneda. Nunca floats.
  Medusa ya lo hace así — respétalo.
- Nada de lógica de negocio en las rutas API. Las rutas orquestan workflows.
- Toda mutación de inventario pasa por un workflow. Sin excepciones.
- Nombres de módulos custom en singular: `brand`, no `brands`.

### Migraciones
```bash
npx medusa db:generate <modulo>   # genera migración del módulo
npx medusa db:migrate             # aplica (usa DIRECT_URL)
```
Nunca edites una migración ya aplicada. Genera una nueva.

---

## 7. Cómo quiero que trabajes

1. **Plan antes de código.** Para cualquier tarea de más de un archivo,
   escríbeme el plan primero y espera confirmación.
2. **Incrementos verificables.** Cada paso debe terminar en algo que yo pueda
   correr y ver. No me entregues 15 archivos de una.
3. **Consulta la doc oficial** (`docs.medusajs.com`) antes de asumir una API.
   Medusa v2 cambió mucho respecto a v1 y hay bastante contenido desactualizado
   circulando. Si la doc y tu memoria difieren, gana la doc.
4. **Di cuando algo no encaja.** Si una parte del dominio ERP no calza bien en
   el modelo de Medusa, dilo en vez de forzarla. Prefiero un módulo custom
   limpio que un abuso de metadata.
5. **No inventes librerías ni endpoints.** Si no estás seguro de que algo
   existe, verifícalo.
6. **No mates alcance por tu cuenta.** Si algo es más difícil de lo esperado,
   avísame; no entregues una versión simplificada haciéndola pasar por completa.

---

## 8. Estado actual

> Actualiza esta sección conforme avancemos.

- [x] Proyecto Medusa v2 inicializado — v2.18.0, solo backend, layout de §6 en la raíz
- [x] Supabase conectado (migraciones + runtime verificados) — `AlturaBrands-ERP`, us-east-1.
      Pooler `aws-0`: 6543 runtime / 5432 migraciones, ambos probados con conexión real.
      181 migraciones aplicadas, 143 tablas.
- [x] Redis configurado — los tres módulos (cache, event-bus, workflow-engine)
      conectan correctamente. **En local se usa memoria, no Redis**: BullMQ
      sondea sin parar y agotó los 500k comandos del tier gratuito de Upstash en
      horas. Para desplegar hace falta un Redis de tarifa fija, no por comando.
- [x] Operación-país como dimensión — módulo `operation`, Colombia (`CO`) dada
      de alta. Reglas de pedido por marca: KEEN pide en bultos (`order_unit`).
      Ver §10.
- [ ] Admin corriendo en local — falta crear usuario y levantar el servidor
- [x] Módulo `brand` + link a producto — KEEN, 334 productos enlazados
- [x] Catálogo maestro cargado — 334 productos, 3.064 variantes, 6 categorías,
      región USD. Fuente: `data/master-data.json`, generado por `etl/`.
      Los datos de demo del starter fueron purgados.
- [x] Módulo `supply_availability` poblado — 3.297 filas: 113.447 pares en ATS USA
      (no vendibles) + 10.268 en tránsito con su ETA. Enlazadas a variante.
- [x] Bodegas y niveles de inventario — Bodega Matriz, 702 niveles, 268 pares
      propios y 10.268 en `incoming_quantity`. Cuadre total verificado: 123.983.
- [x] Capa BI — schema `bi`, vistas de solo lectura. Ver `sql/bi/`.
- [ ] Seed de datos de prueba
- [ ] Flujo de venta end-to-end
- [ ] Embudo de despacho

---

## 9. Primera tarea

Inicializa el proyecto y déjalo corriendo contra Supabase. En concreto:

1. `npx create-medusa-app@latest` — **sin storefront**, solo backend + admin.
2. Configura `.env` con `DATABASE_URL` y `DIRECT_URL` según la sección 3.
   Déjame un `.env.example` documentado y asegúrate de que `.env` esté en `.gitignore`.
3. Levanta Redis local vía Docker y configúralo como cache + event bus.
4. Corre las migraciones y **verifica que hayan pasado realmente** — no asumas.
5. Crea el usuario admin y confirma que puedes entrar al panel.
6. Dime exactamente qué comandos correr y qué debería ver en pantalla.

No avances a la siguiente tarea hasta que yo confirme que el admin abre.
