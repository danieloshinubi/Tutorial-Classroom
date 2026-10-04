import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import type { Database } from "../types/database";

// The same Supabase client the rest of the app uses, typed against the live
// database (src/types/database.ts, generated with `supabase gen types
// typescript --schema classroom`). TypeScript code reaches the database
// through this, so a renamed or missing column fails the build instead of
// a screen. Regenerate the types after each migration.
export const db = supabase as unknown as SupabaseClient<Database, "classroom">;

type Schema = Database["classroom"];
export type Row<T extends keyof Schema["Tables"]> = Schema["Tables"][T]["Row"];
export type Fn<T extends keyof Schema["Functions"]> = Schema["Functions"][T];

// A Supabase error as a plain Error with the database's own message, which
// for the timetable is a sentence written for the person reading it.
export const fail = (error: { message?: string } | null | undefined, fallback: string): never => {
  throw new Error(error?.message || fallback);
};
