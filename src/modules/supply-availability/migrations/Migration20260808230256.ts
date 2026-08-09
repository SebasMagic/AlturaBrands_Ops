import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260808230256 extends Migration {

  /**
   * La generada automaticamente era:
   *   add column "operation_code" text not null;
   * y falla sobre las 3.297 filas ya cargadas, porque no hay valor por
   * defecto que darles.
   *
   * Se hace en tres tiempos: columna opcional, relleno y recien entonces la
   * restriccion. Todo lo cargado hasta hoy es Colombia, de ahi el 'CO'.
   */
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "supply_availability" add column if not exists "operation_code" text;`);
    this.addSql(`update "supply_availability" set "operation_code" = 'CO' where "operation_code" is null;`);
    this.addSql(`alter table if exists "supply_availability" alter column "operation_code" set not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "supply_availability" drop column if exists "operation_code";`);
  }

}
