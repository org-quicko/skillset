import { customType } from "drizzle-orm/pg-core";

/** Postgres `tsvector` has no native representation in Drizzle (docs/data-model.md). */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});
