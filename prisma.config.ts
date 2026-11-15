/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * SOURCE OF TRUTH KEYWORDS: prismaConfig, GENERATE_WITHOUT_DATABASE
 * WHAT:  Where the schema lives and which database to use.
 * WHY:   `prisma generate` (run by `npm install`) only writes the client and
 *        never connects, so a fresh copy installs before .env exists. Every
 *        other command (migrate, studio) still requires DATABASE_URL.
 */
const generating = process.argv.includes("generate");

export default defineConfig({
  schema: "prisma/schema.prisma",
  engine: "classic",
  datasource: {
    url: generating ? (process.env["DATABASE_URL"] ?? "postgresql://not-needed-for-generate@localhost/none") : env("DATABASE_URL"),
  },
});
