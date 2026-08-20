-- =============================================================================
-- Fotos de producto en Storage propio
--
-- Hasta ahora `ops.product.thumbnail_url` apuntaba al CDN de Shopify de OTRA
-- tienda. Nadie de aquí controla ese servidor: si reorganizan el catálogo,
-- borran un producto o bloquean el hotlinking, el catálogo visual se cae de
-- golpe y nadie se entera hasta que alguien abre una proforma.
--
-- Son 329 imágenes, unos 20 MB. Traerlas cuesta poco y quita una dependencia
-- externa de la que no tenemos aviso previo.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ EL BUCKET ES PÚBLICO
--
-- Son fotos de catálogo de una marca de calzado: ya están publicadas en la
-- tienda Shopify y en el sitio de KEEN. No hay nada que proteger, y un bucket
-- privado obligaría a firmar una URL por imagen en cada render — coste y
-- complejidad a cambio de nada.
--
-- Lo que NO es público es quién puede escribir: sólo usuarios autenticados.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'producto', 'producto', true,
  5242880,                                    -- 5 MB por archivo, de sobra
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lectura abierta: el bucket es público y así lo sirve el CDN sin firmar nada.
drop policy if exists "fotos de producto: lectura publica" on storage.objects;
create policy "fotos de producto: lectura publica"
  on storage.objects for select
  using (bucket_id = 'producto');

-- Escritura sólo autenticada. Las tres operaciones por separado porque un
-- upsert necesita insert Y update, y quedarse en insert hace que reemplazar
-- una foto falle en silencio.
drop policy if exists "fotos de producto: subir" on storage.objects;
create policy "fotos de producto: subir"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'producto');

drop policy if exists "fotos de producto: reemplazar" on storage.objects;
create policy "fotos de producto: reemplazar"
  on storage.objects for update to authenticated
  using (bucket_id = 'producto');

drop policy if exists "fotos de producto: borrar" on storage.objects;
create policy "fotos de producto: borrar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'producto');

-- Se conserva de dónde vino cada foto. Sin esto, tras migrar sería imposible
-- reconstruir el origen si alguna llegó corrupta o cambió en la fuente.
alter table ops.product
  add column if not exists thumbnail_origen text;
