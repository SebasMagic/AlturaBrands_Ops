import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260809160050 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "goods_receipt" drop constraint if exists "goods_receipt_code_unique";`);
    this.addSql(`create table if not exists "goods_receipt" ("id" text not null, "code" text not null, "operation_code" text not null, "purchase_order_code" text not null, "warehouse_id" text not null, "status" text check ("status" in ('DRAFT', 'CONFIRMED', 'CANCELLED')) not null default 'DRAFT', "reference" text null, "received_at" timestamptz null, "confirmed_at" timestamptz null, "received_by" text null, "notes" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "goods_receipt_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_goods_receipt_code_unique" ON "goods_receipt" ("code") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_goods_receipt_deleted_at" ON "goods_receipt" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "goods_receipt_line" ("id" text not null, "sku" text not null, "material_code" text not null, "size_label" text not null, "quantity_expected" integer not null, "quantity_received" integer null, "discrepancy_note" text null, "receipt_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "goods_receipt_line_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_goods_receipt_line_receipt_id" ON "goods_receipt_line" ("receipt_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_goods_receipt_line_deleted_at" ON "goods_receipt_line" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "goods_receipt_line" add constraint "goods_receipt_line_receipt_id_foreign" foreign key ("receipt_id") references "goods_receipt" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "goods_receipt_line" drop constraint if exists "goods_receipt_line_receipt_id_foreign";`);

    this.addSql(`drop table if exists "goods_receipt" cascade;`);

    this.addSql(`drop table if exists "goods_receipt_line" cascade;`);
  }

}
