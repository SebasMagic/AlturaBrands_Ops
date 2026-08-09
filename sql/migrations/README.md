# Migraciones

Una migración por cambio, numerada y en orden. `sql/apply.js migrations` las
aplica alfabéticamente.

**Nunca edites una migración ya aplicada.** Escribe otra.

Van por `DIRECT_URL` (session pooler, 5432): el transaction pooler rompe el
DDL de forma confusa — CLAUDE.md §10.

## Convención

```
001_operaciones_y_marcas.sql
002_catalogo.sql
003_inventario.sql
004_rls.sql
```

## Antes de migrar, si hay vistas de BI

Postgres no deja alterar el tipo de una columna de la que cuelga una vista. El
orden es: tirar las vistas → migrar → reconstruirlas.

```
node sql/drop-bi.js && npm run db:apply && npm run db:bi
```
