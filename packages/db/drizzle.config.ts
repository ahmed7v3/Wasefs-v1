import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  // `casing` keeps TS camelCase fields mapped to snake_case columns.
  casing: "snake_case",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "",
  },
});
