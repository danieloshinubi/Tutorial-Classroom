#!/usr/bin/env node
/* eslint-disable no-console */
//
// Applies the SQL files in supabase/ against the database, in order, once each.
//
//   node scripts/migrate.js            apply everything outstanding
//   node scripts/migrate.js --status   show what has run without changing anything
//   node scripts/migrate.js --file 014_thing.sql   apply one file
//
// Needs DATABASE_URL in .env — the URI from
// Supabase → Settings → Database → Connection string.
//
// Files whose names are not numbered (schema.sql, 008a_inspect...) are skipped
// unless named explicitly: schema.sql drops the whole schema, and the inspect
// scripts are read-only diagnostics. Neither belongs in an automatic run.

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

require("dotenv").config();

const DIR = path.join(__dirname, "..", "supabase");
const NUMBERED = /^(\d{3})_[\w-]+\.sql$/;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set.\n" +
      "Add it to .env — Supabase → Settings → Database → Connection string → URI."
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const statusOnly = args.includes("--status");
const oneFile = args.includes("--file") ? args[args.indexOf("--file") + 1] : null;

const migrations = () =>
  fs
    .readdirSync(DIR)
    .filter((name) => NUMBERED.test(name))
    .sort();

const run = async () => {
  const client = new Client({
    connectionString: url,
    // Supabase terminates unencrypted connections; the pooler presents a cert
    // this client has no CA for, which is fine for a migration run.
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  // The ledger lives in its own schema so a classroom reset cannot erase the
  // record of what has already run.
  await client.query(`
    create schema if not exists schoolivio;
    create table if not exists schoolivio.migrations (
      filename    text primary key,
      applied_at  timestamptz not null default now(),
      duration_ms int
    );
  `);

  const { rows } = await client.query(
    "select filename, applied_at from schoolivio.migrations order by filename"
  );
  const applied = new Map(rows.map((r) => [r.filename, r.applied_at]));

  const all = oneFile ? [oneFile] : migrations();
  const pending = oneFile ? all : all.filter((name) => !applied.has(name));

  if (statusOnly) {
    console.log(`\n  ${all.length} migration files\n`);
    all.forEach((name) => {
      const at = applied.get(name);
      console.log(
        at
          ? `  applied  ${name}  ${new Date(at).toISOString().slice(0, 16).replace("T", " ")}`
          : `  PENDING  ${name}`
      );
    });
    console.log("");
    await client.end();
    return;
  }

  if (pending.length === 0) {
    console.log("\n  Nothing to apply — the database is up to date.\n");
    await client.end();
    return;
  }

  console.log(`\n  Applying ${pending.length} migration(s)\n`);

  for (const name of pending) {
    const file = path.join(DIR, name);
    if (!fs.existsSync(file)) {
      console.error(`  MISSING  ${name}`);
      await client.end();
      process.exit(1);
    }

    const sql = fs.readFileSync(file, "utf8");
    const started = Date.now();
    process.stdout.write(`  ${name} ... `);

    try {
      // Each file is one transaction: it either lands whole or not at all,
      // which is what stopped 010 leaving half a schema behind.
      await client.query("begin");
      await client.query(sql);
      const ms = Date.now() - started;
      await client.query(
        `insert into schoolivio.migrations (filename, duration_ms)
         values ($1, $2)
         on conflict (filename) do update set applied_at = now(), duration_ms = $2`,
        [name, ms]
      );
      await client.query("commit");
      console.log(`ok (${ms}ms)`);
    } catch (err) {
      await client.query("rollback").catch(() => {});
      console.log("FAILED");
      console.error(`\n  ${err.message}`);
      if (err.hint) console.error(`  hint: ${err.hint}`);
      if (err.position) console.error(`  at character ${err.position}`);
      console.error("\n  Nothing from this file was applied.\n");
      await client.end();
      process.exit(1);
    }
  }

  console.log("\n  Done.\n");
  await client.end();
};

run().catch((err) => {
  console.error(`\n  ${err.message}\n`);
  process.exit(1);
});
