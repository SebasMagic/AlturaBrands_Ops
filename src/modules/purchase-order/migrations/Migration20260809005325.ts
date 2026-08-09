import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260809005325 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "purchase_order" drop constraint if exists "purchase_order_code_unique";`);
    this.addSql(`create table if not exists "purchase_order" ("id" text not null, "code" text not null, "operation_code" text not null, "brand_code" text not null, "status" text check ("status" in ('DRAFT', 'QTY_CHECKED', 'CLIENT_APPROVED', 'DISPATCHED', 'CANCELLED')) not null default 'DRAFT', "currency_code" text not null, "notes" text null, "placed_at" timestamptz null, "qty_checked_at" timestamptz null, "approved_at" timestamptz null, "dispatched_at" timestamptz null, "dispatch_ticket" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "purchase_order_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_purchase_order_code_unique" ON "purchase_order" ("code") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_purchase_order_deleted_at" ON "purchase_order" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "purchase_order_item" ("id" text not null, "material_code" text not null, "description" text not null, "size_curve_code" text null, "packs" integer not null default 0, "is_adjusted" boolean not null default false, "adjustment_note" text null, "unit_cost_cents" integer null, "order_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "purchase_order_item_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_purchase_order_item_order_id" ON "purchase_order_item" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_purchase_order_item_deleted_at" ON "purchase_order_item" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "purchase_order_size" ("id" text not null, "sku" text not null, "size_label" text not null, "size_value" real not null, "quantity_requested" integer not null default 0, "quantity_confirmed" integer null, "item_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "purchase_order_size_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_purchase_order_size_item_id" ON "purchase_order_size" ("item_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_purchase_order_size_deleted_at" ON "purchase_order_size" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "purchase_order_item" add constraint "purchase_order_item_order_id_foreign" foreign key ("order_id") references "purchase_order" ("id") on update cascade;`);

    this.addSql(`alter table if exists "purchase_order_size" add constraint "purchase_order_size_item_id_foreign" foreign key ("item_id") references "purchase_order_item" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "purchase_order_item" drop constraint if exists "purchase_order_item_order_id_foreign";`);

    this.addSql(`alter table if exists "purchase_order_size" drop constraint if exists "purchase_order_size_item_id_foreign";`);

    this.addSql(`drop table if exists "purchase_order" cascade;`);

    this.addSql(`drop table if exists "purchase_order_item" cascade;`);

    this.addSql(`drop table if exists "purchase_order_size" cascade;`);
  }

}
