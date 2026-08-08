import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260808205843 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "supply_availability" ("id" text not null, "material_code" text not null, "sku" text not null, "source" text not null, "kind" text check ("kind" in ('SUPPLIER', 'IN_TRANSIT')) not null, "eta_days" integer null, "quantity" integer not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "supply_availability_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supply_availability_deleted_at" ON "supply_availability" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "supply_availability" cascade;`);
  }

}
