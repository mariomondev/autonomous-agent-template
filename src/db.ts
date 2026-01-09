/**
 * Database Utilities for Feature Tracking
 *
 * Uses bun:sqlite for efficient feature list management.
 * Database is stored in .autonomous/db.sqlite
 */

// @ts-ignore - bun:sqlite is available at runtime
import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";
import { AUTONOMOUS_DIR, Feature, CategoryProgress } from "./progress.js";

/**
 * Get the path to the database file.
 */
function getDbPath(projectDir: string): string {
  const autonomousDir = path.join(projectDir, AUTONOMOUS_DIR);
  return path.join(autonomousDir, "db.sqlite");
}

/**
 * Initialize the database and create schema if needed.
 */
export function initDatabase(projectDir: string): Database {
  const dbPath = getDbPath(projectDir);
  const autonomousDir = path.dirname(dbPath);

  // Ensure .autonomous directory exists
  if (!fs.existsSync(autonomousDir)) {
    fs.mkdirSync(autonomousDir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Create schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS features (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'uncategorized',
      testing_steps TEXT NOT NULL,
      passes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_features_category ON features(category);
    CREATE INDEX IF NOT EXISTS idx_features_passes ON features(passes);
  `);

  return db;
}

/**
 * Get database instance (opens existing or creates new).
 */
function getDatabase(projectDir: string): Database {
  return initDatabase(projectDir);
}

/**
 * Get the next batch of features to work on (max 10 from same category).
 * Returns features grouped by category, prioritizing categories with failing features.
 */
export function getNextFeatures(
  projectDir: string,
  limit: number = 10
): Feature[] {
  const db = getDatabase(projectDir);

  // Find the first category that has failing features
  const categoryQuery = db.query(`
    SELECT category, COUNT(*) as count
    FROM features
    WHERE passes = 0
    GROUP BY category
    ORDER BY category ASC
    LIMIT 1
  `);

  const categoryResult = categoryQuery.get() as {
    category: string;
    count: number;
  } | null;

  if (!categoryResult) {
    return [];
  }

  const targetCategory = categoryResult.category;

  // Get up to limit features from that category
  const featuresQuery = db.query(`
    SELECT id, name, description, category, testing_steps, passes
    FROM features
    WHERE category = ? AND passes = 0
    ORDER BY id ASC
    LIMIT ?
  `);

  const rows = featuresQuery.all(targetCategory, limit) as Array<{
    id: number;
    name: string;
    description: string;
    category: string;
    testing_steps: string;
    passes: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    testing_steps: JSON.parse(row.testing_steps),
    passes: row.passes === 1,
  }));
}

/**
 * Mark a feature as passing.
 */
export function markFeaturePassing(
  projectDir: string,
  featureId: number
): void {
  const db = getDatabase(projectDir);
  const updateQuery = db.query(`
    UPDATE features
    SET passes = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  updateQuery.run(featureId);
}

/**
 * Mark a feature as failing (for regression testing).
 */
export function markFeatureFailing(
  projectDir: string,
  featureId: number
): void {
  const db = getDatabase(projectDir);
  const updateQuery = db.query(`
    UPDATE features
    SET passes = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  updateQuery.run(featureId);
}

/**
 * Check if there are any failing features.
 */
export function hasFailingFeatures(projectDir: string): boolean {
  const db = getDatabase(projectDir);
  const countQuery = db.query(`
    SELECT COUNT(*) as count
    FROM features
    WHERE passes = 0
  `);
  const result = countQuery.get() as { count: number };
  return result.count > 0;
}

/**
 * Get progress statistics.
 */
export function getProgressStats(projectDir: string): {
  passing: number;
  total: number;
  byCategory: CategoryProgress[];
} {
  const db = getDatabase(projectDir);

  // Total counts
  const totalQuery = db.query(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN passes = 1 THEN 1 ELSE 0 END) as passing
    FROM features
  `);
  const totals = totalQuery.get() as { total: number; passing: number };

  // By category
  const categoryQuery = db.query(`
    SELECT 
      category,
      COUNT(*) as total,
      SUM(CASE WHEN passes = 1 THEN 1 ELSE 0 END) as passing
    FROM features
    GROUP BY category
    ORDER BY category ASC
  `);
  const categoryRows = categoryQuery.all() as Array<{
    category: string;
    total: number;
    passing: number;
  }>;

  return {
    passing: totals.passing,
    total: totals.total,
    byCategory: categoryRows.map((row) => ({
      category: row.category,
      passing: row.passing,
      total: row.total,
    })),
  };
}

/**
 * Get all features (for migration/export purposes).
 */
export function getAllFeatures(projectDir: string): Feature[] {
  const db = getDatabase(projectDir);
  const query = db.query(`
    SELECT id, name, description, category, testing_steps, passes
    FROM features
    ORDER BY id ASC
  `);

  const rows = query.all() as Array<{
    id: number;
    name: string;
    description: string;
    category: string;
    testing_steps: string;
    passes: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    testing_steps: JSON.parse(row.testing_steps),
    passes: row.passes === 1,
  }));
}

/**
 * Insert a feature into the database.
 */
export function insertFeature(projectDir: string, feature: Feature): void {
  const db = getDatabase(projectDir);

  // If ID is provided, use it; otherwise let SQLite auto-increment
  if (feature.id !== undefined && feature.id !== null) {
    const insertQuery = db.query(`
      INSERT INTO features (id, name, description, category, testing_steps, passes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertQuery.run(
      feature.id,
      feature.name,
      feature.description,
      feature.category || "uncategorized",
      JSON.stringify(feature.testing_steps),
      feature.passes ? 1 : 0
    );
  } else {
    const insertQuery = db.query(`
      INSERT INTO features (name, description, category, testing_steps, passes)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertQuery.run(
      feature.name,
      feature.description,
      feature.category || "uncategorized",
      JSON.stringify(feature.testing_steps),
      feature.passes ? 1 : 0
    );
  }
}

/**
 * Get the next feature to implement (for display purposes).
 */
export function getNextFeature(projectDir: string): Feature | null {
  const features = getNextFeatures(projectDir, 1);
  return features.length > 0 ? features[0] : null;
}
