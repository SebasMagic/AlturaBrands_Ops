import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260808230245 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "brand" add column if not exists "order_unit" text check ("order_unit" in ('PACK', 'PAIR')) not null default 'PAIR', add column if not exists "default_pack_size" integer null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "brand" drop column if exists "order_unit", drop column if exists "default_pack_size";`);
  }

}
