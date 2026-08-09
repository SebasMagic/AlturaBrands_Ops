import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260809160036 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "stock_move" ("id" text not null, "operation_code" text not null, "sku" text not null, "warehouse_id" text not null, "kind" text check ("kind" in ('RECEIPT', 'SALE', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'RETURN')) not null, "quantity" integer not null, "reference_type" text not null, "reference_id" text not null, "balance_after" integer null, "notes" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "stock_move_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_stock_move_deleted_at" ON "stock_move" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "stock_move" cascade;`);
  }

}
