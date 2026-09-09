#!/usr/bin/env node
/* eslint-disable no-console */
//
// Applies the SQL files in supabase/ against the database, in order, once each.
//
//   npm run migrate           apply everything outstanding
//   npm run migrate:status    show what has run without changing anything
//   node scripts/migrate.js --file 017_thing.sql   apply one file
//
// Runs through Supabase's Management API, so only SUPABASE_ACCESS_TOKEN is
// needed — no database password.
//
// Files whose names are not numbered (schema.sql, 008a_inspect...) are skipped
// unless named explicitly: schema.sql drops the whole schema, and the inspect
// scripts are read-only diagnostics. Neither belongs in an automatic run.

const fs = require("fs");
const path = require("path");
const { run } = require("./sql");

const DIR = path.join(__dirname, "..", "supabase");
const NUMBERED = /^(\d{3})_[\w-]+\.sql$/;

const args = process.argv.slice(2);
const statusOnly = args.includes("--status");
const oneFile = args.includes("--file") ? args[args.indexOf("--file") + 1] : null;

const migrations = () =>
  fs
    .readdirSync(DIR)
    .filter((name) => NUMBERED.test(name))
    .sort();

const main = async () => {
  // The ledger lives in its own schema, so resetting the classroom schema
  // cannot erase the record of what has already run.
  await run(`
    create schema if not exists schoolivio;
    create table if not exists schoolivio.migrations (
      filename    text primary key,
      applied_at  timestamptz not null default now(),
      duration_ms int
    );
  `);

  const rows = await run(
    "select filename, applied_at from schoolivio.migrations order by filename"
  );
  const applied = new Map((rows || []).map((r) => [r.filename, r.applied_at]));

  const all = oneFile ? [oneFile] : migrations();
  const pending = oneFile ? all : all.filter((name) => !applied.has(name));

  if (statusOnly) {
    console.log(`\n  ${all.length} migration files\n`);
    all.forEach((name) => {
      const at = applied.get(name);
      console.log(
        at
          ? `  applied  ${name}  ${String(at).slice(0, 16).replace("T", " ")}`
          : `  PENDING  ${name}`
      );
    });
    console.log("");
    return;
  }

  if (pending.length === 0) {
    console.log("\n  Nothing to apply — the database is up to date.\n");
    return;
  }

  console.log(`\n  Applying ${pending.length} migration(s)\n`);

  for (const name of pending) {
    const file = path.join(DIR, name);
    if (!fs.existsSync(file)) {
      console.error(`  MISSING  ${name}`);
      process.exit(1);
    }

    const sql = fs.readFileSync(file, "utf8");
    const started = Date.now();
    process.stdout.write(`  ${name} ... `);

    try {
      // Each file is wrapped in one transaction: it lands whole or not at all,
      // which is what stopped 010 leaving half a schema behind.
      await run(`begin;\n${sql}\ncommit;`);
      const ms = Date.now() - started;
      await run(
        `insert into schoolivio.migrations (filename, duration_ms)
         values ('${name.replace(/'/g, "''")}', ${ms})
         on conflict (filename) do update
           set applied_at = now(), duration_ms = ${ms}`
      );
      console.log(`ok (${ms}ms)`);
    } catch (err) {
      console.log("FAILED");
      console.error(`\n  ${err.message}`);
      console.error("\n  Nothing from this file was applied.\n");
      process.exit(1);
    }
  }

  console.log("\n  Done.\n");
};

main().catch((err) => {
  console.error(`\n  ${err.message}\n`);
  process.exit(1);
});
