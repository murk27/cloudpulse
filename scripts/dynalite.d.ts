/** Minimal type declarations for dynalite (an in-memory DynamoDB clone used only for local dev). */
declare module "dynalite" {
  import type { Server } from "node:http";

  interface DynaliteOptions {
    createTableMs?: number;
    deleteTableMs?: number;
    updateTableMs?: number;
  }

  export default function dynalite(options?: DynaliteOptions): Server;
}
