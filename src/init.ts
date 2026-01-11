#!/usr/bin/env bun
/**
 * Initialize database from features.sql
 *
 * Usage: bun run init ./your-project
 */

// @ts-ignore - bun:sqlite is available at runtime
import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";

const projectDir = process.argv[2];

if (!projectDir) {
  console.error("Usage: bun run init ./your-project");
  process.exit(1);
}

const autonomousDir = path.join(projectDir, ".autonomous");
const sqlFile = path.join(autonomousDir, "features.sql");
const dbFile = path.join(autonomousDir, "db.sqlite");

// Check features.sql exists
if (!fs.existsSync(sqlFile)) {
  console.error(`Error: ${sqlFile} not found`);
  console.error(
    "Generate features.sql first using templates/feature_list_generator.md"
  );
  process.exit(1);
}

// Create .autonomous directory if needed
if (!fs.existsSync(autonomousDir)) {
  fs.mkdirSync(autonomousDir, { recursive: true });
}

// Remove existing database if present
if (fs.existsSync(dbFile)) {
  fs.unlinkSync(dbFile);
  console.log("Removed existing db.sqlite");
}

// Read and execute SQL
const sql = fs.readFileSync(sqlFile, "utf-8");
const db = new Database(dbFile);

try {
  db.exec(sql);

  // Count features
  const result = db.query("SELECT COUNT(*) as count FROM features").get() as {
    count: number;
  };
  console.log(`Created db.sqlite with ${result.count} features`);

  // Show summary by category
  const categories = db
    .query(
      "SELECT category, COUNT(*) as count FROM features GROUP BY category ORDER BY category"
    )
    .all() as { category: string; count: number }[];

  console.log("\nFeatures by category:");
  for (const cat of categories) {
    console.log(`  ${cat.category}: ${cat.count}`);
  }
} catch (error) {
  console.error("Error executing SQL:", error);
  process.exit(1);
} finally {
  db.close();
}
