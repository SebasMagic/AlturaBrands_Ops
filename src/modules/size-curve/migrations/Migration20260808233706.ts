import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260808233706 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "size_curve" drop constraint if exists "size_curve_code_unique";`);
    this.addSql(`create table if not exists "size_curve" ("id" text not null, "code" text not null, "name" text not null, "scale" text not null, "pairs_per_pack" integer not null, "is_default" boolean not null default false, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "size_curve_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_size_curve_code_unique" ON "size_curve" ("code") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_size_curve_deleted_at" ON "size_curve" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "size_curve_entry" ("id" text not null, "size_label" text not null, "size_value" integer not null, "ratio" integer not null, "curve_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "size_curve_entry_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_size_curve_entry_curve_id" ON "size_curve_entry" ("curve_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_size_curve_entry_deleted_at" ON "size_curve_entry" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "size_curve_entry" add constraint "size_curve_entry_curve_id_foreign" foreign key ("curve_id") references "size_curve" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "size_curve_entry" drop constraint if exists "size_curve_entry_curve_id_foreign";`);

    this.addSql(`drop table if exists "size_curve" cascade;`);

    this.addSql(`drop table if exists "size_curve_entry" cascade;`);
  }

}
