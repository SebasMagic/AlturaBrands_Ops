import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260808230235 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "operation" drop constraint if exists "operation_code_unique";`);
    this.addSql(`create table if not exists "operation" ("id" text not null, "code" text not null, "name" text not null, "currency_code" text not null, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "operation_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_operation_code_unique" ON "operation" ("code") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_operation_deleted_at" ON "operation" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "operation" cascade;`);
  }

}
