#!/usr/bin/env node
/* eslint-disable no-console */
//
// Runs SQL against the project through Supabase's Management API, so no
// database password is needed — only SUPABASE_ACCESS_TOKEN.
//
//   node scripts/sql.js "select 1"
//   node scripts/sql.js --file supabase/016_admissions.sql
//
// Used by scripts/migrate.js. Also handy on its own for a one-off query.
const fs = require("fs");
require("dotenv").config();

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;

if (!token || !ref) {
  console.error("SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF must be set in .env");
  process.exit(1);
}

const run = async (query) => {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );

  const text = await response.text();
  if (!response.ok) {
    // The API returns the Postgres message, which is the useful part.
    let message = text;
    try {
      message = JSON.parse(text).message || text;
    } catch {
      /* keep the raw body */
    }
    throw new Error(message);
  }
  return text ? JSON.parse(text) : null;
};

module.exports = { run };

if (require.main === module) {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf("--file");
  const query =
    fileIndex >= 0 ? fs.readFileSync(args[fileIndex + 1], "utf8") : args.join(" ");

  run(query)
    .then((rows) => console.log(JSON.stringify(rows, null, 2)))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
