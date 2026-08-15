-- =============================================================================
-- Personas autorizadas
--
-- POR QUÉ EXISTE ESTO. Al desplegar se descubrió que el registro público de
-- Supabase Auth estaba ABIERTO: cualquiera podía crear una cuenta con su
-- correo, confirmarla y entrar al ERP completo — ver costos, inventario y
-- clientes, y despachar o cancelar pedidos. El middleware sólo comprobaba que
-- hubiera *una* sesión válida, no DE QUIÉN.
--
-- Estar autenticado en Supabase ya no basta: además hay que estar en esta
-- tabla. Cerrar el registro en el dashboard es la otra mitad de la defensa,
-- pero eso es una casilla que alguien puede volver a activar sin querer; esto
-- es una regla del sistema y vive en el repositorio.
--
-- Es también la base de los roles: hoy sólo hay `rol`, sin permisos asociados,
-- porque todavía no sabemos qué debe poder hacer cada quien. Cuando se sepa,
-- se cuelgan de aquí sin migrar nada.
-- =============================================================================

create table if not exists ops.app_user (
    id         bigint generated always as identity primary key,

    -- Se enlaza por CORREO y no por el uuid de auth.users a propósito: así se
    -- puede autorizar a alguien ANTES de que se registre, que es el orden en
    -- que ocurre en la vida real (primero entra a la empresa, después crea su
    -- cuenta). El correo se guarda en minúsculas.
    email      text        not null unique,
    nombre     text        not null,

    rol        text        not null default 'OPERACION'
               constraint app_user_rol_valido check (rol in (
                   'ADMIN',      -- todo, incluida la gestión de usuarios
                   'COMERCIAL',  -- cotiza, vende, consulta inventario
                   'BODEGA',     -- alista, empaca, despacha, recibe
                   'OPERACION'   -- consulta; sin acciones destructivas
               )),

    is_active  boolean     not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists app_user_email_activo on ops.app_user (email) where is_active;

drop trigger if exists app_user_touch on ops.app_user;
create trigger app_user_touch before update on ops.app_user
  for each row execute function ops.touch_updated_at();

alter table ops.app_user enable row level security;

-- El correo se normaliza en la base y no en la aplicación: así ningún camino
-- futuro puede saltarse la normalización y crear un duplicado con mayúsculas.
create or replace function ops.normalizar_email_app_user() returns trigger
language plpgsql as $$
begin
  new.email := lower(trim(new.email));
  return new;
end;
$$;

drop trigger if exists app_user_normaliza on ops.app_user;
create trigger app_user_normaliza before insert or update on ops.app_user
  for each row execute function ops.normalizar_email_app_user();

-- Primer usuario: quien ya tenía cuenta.
insert into ops.app_user (email, nombre, rol)
values ('santiago@themagichack.com', 'Sebastian Magic', 'ADMIN')
on conflict (email) do nothing;
