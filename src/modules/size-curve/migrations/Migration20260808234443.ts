import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260808234443 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "size_curve_entry" alter column "size_value" type real using ("size_value"::real);`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "size_curve_entry" alter column "size_value" type integer using ("size_value"::integer);`);
  }

}
