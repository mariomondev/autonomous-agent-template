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

// Types
export type FeatureStatus = "pending" | "in_progress" | "completed" | "failed";

export interface Note {
  id: number;
  feature_id: number | null;
  category: string | null;
  content: string;
  created_by_session: number;
  created_at: string;
}

export interface NoteInput {
  featureId: number | null;
  category: string | null;
  content: string;
  sessionId: number;
}

export interface Session {
  id: number;
  started_at: string;
  ended_at: string | null;
  status: "running" | "completed" | "failed";
  features_attempted: number;
  features_completed: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  error_message: string | null;
}

export interface SessionStats {
  status: "completed" | "failed";
  features_attempted?: number;
  features_completed?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  error_message?: string;
}

export interface KanbanStats {
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  byCategory: {
    category: string;
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
  }[];
}

/**
 * Get the path to the database file.
 */
function getDbPath(projectDir: string): string {
  const autonomousDir = path.join(projectDir, AUTONOMOUS_DIR);
  return path.join(autonomousDir, "db.sqlite");
}

/**
 * Initialize the database and create schema if needed.
 * Handles migrations for existing databases.
 */
export function initDatabase(projectDir: string): Database {
  const dbPath = getDbPath(projectDir);
  const autonomousDir = path.dirname(dbPath);

  // Ensure .autonomous directory exists
  if (!fs.existsSync(autonomousDir)) {
    fs.mkdirSync(autonomousDir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Create features table (base schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS features (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'uncategorized',
      testing_steps TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_features_category ON features(category);
    CREATE INDEX IF NOT EXISTS idx_features_status ON features(status);
  `);

  // Migration: Add retry_count column if missing (for existing databases)
  const columns = db.query("PRAGMA table_info(features)").all() as Array<{ name: string }>;
  const columnNames = columns.map((c) => c.name);

  if (!columnNames.includes("retry_count")) {
    db.exec(`ALTER TABLE features ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`);
  }

  // Create notes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feature_id INTEGER,
      category TEXT,
      content TEXT NOT NULL,
      created_by_session INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (feature_id) REFERENCES features(id)
    );

    CREATE INDEX IF NOT EXISTS idx_notes_feature ON notes(feature_id);
    CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category);
  `);

  // Create sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      ended_at TEXT,
      status TEXT DEFAULT 'running',
      features_attempted INTEGER DEFAULT 0,
      features_completed INTEGER DEFAULT 0,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd REAL,
      error_message TEXT
    );
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
 * Returns features grouped by category, prioritizing categories with pending features.
 */
export function getNextFeatures(
  projectDir: string,
  limit: number = 10
): Feature[] {
  const db = getDatabase(projectDir);

  // Find the first category that has pending features
  const categoryQuery = db.query(`
    SELECT category, COUNT(*) as count
    FROM features
    WHERE status = 'pending'
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
    SELECT id, name, description, category, testing_steps, status, retry_count
    FROM features
    WHERE category = ? AND status = 'pending'
    ORDER BY id ASC
    LIMIT ?
  `);

  const rows = featuresQuery.all(targetCategory, limit) as Array<{
    id: number;
    name: string;
    description: string;
    category: string;
    testing_steps: string;
    status: string;
    retry_count: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    testing_steps: JSON.parse(row.testing_steps),
    status: row.status as FeatureStatus,
    retry_count: row.retry_count,
  }));
}


/**
 * Check if there are any incomplete features (pending or in_progress).
 */
export function hasIncompleteFeatures(projectDir: string): boolean {
  const db = getDatabase(projectDir);
  const countQuery = db.query(`
    SELECT COUNT(*) as count
    FROM features
    WHERE status IN ('pending', 'in_progress')
  `);
  const result = countQuery.get() as { count: number };
  return result.count > 0;
}


/**
 * Get progress statistics.
 */
export function getProgressStats(projectDir: string): {
  completed: number;
  total: number;
  byCategory: CategoryProgress[];
} {
  const db = getDatabase(projectDir);

  // Total counts
  const totalQuery = db.query(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
    FROM features
  `);
  const totals = totalQuery.get() as { total: number; completed: number };

  // By category with status breakdown
  const categoryQuery = db.query(`
    SELECT
      category,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM features
    GROUP BY category
    ORDER BY category ASC
  `);
  const categoryRows = categoryQuery.all() as Array<{
    category: string;
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
  }>;

  return {
    completed: totals.completed,
    total: totals.total,
    byCategory: categoryRows.map((row) => ({
      category: row.category,
      total: row.total,
      pending: row.pending,
      in_progress: row.in_progress,
      completed: row.completed,
      failed: row.failed,
    })),
  };
}

/**
 * Get all features (for migration/export purposes).
 */
export function getAllFeatures(projectDir: string): Feature[] {
  const db = getDatabase(projectDir);
  const query = db.query(`
    SELECT id, name, description, category, testing_steps, status, retry_count
    FROM features
    ORDER BY id ASC
  `);

  const rows = query.all() as Array<{
    id: number;
    name: string;
    description: string;
    category: string;
    testing_steps: string;
    status: string;
    retry_count: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    testing_steps: JSON.parse(row.testing_steps),
    status: row.status as FeatureStatus,
    retry_count: row.retry_count,
  }));
}

/**
 * Insert a feature into the database.
 */
export function insertFeature(projectDir: string, feature: Feature): void {
  const db = getDatabase(projectDir);

  // Determine initial status
  const status = feature.status || "pending";

  // If ID is provided, use it; otherwise let SQLite auto-increment
  if (feature.id !== undefined && feature.id !== null) {
    const insertQuery = db.query(`
      INSERT INTO features (id, name, description, category, testing_steps, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertQuery.run(
      feature.id,
      feature.name,
      feature.description,
      feature.category || "uncategorized",
      JSON.stringify(feature.testing_steps),
      status
    );
  } else {
    const insertQuery = db.query(`
      INSERT INTO features (name, description, category, testing_steps, status)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertQuery.run(
      feature.name,
      feature.description,
      feature.category || "uncategorized",
      JSON.stringify(feature.testing_steps),
      status
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

// ============================================================================
// Status Management
// ============================================================================

/**
 * Set the status of a feature.
 */
export function setFeatureStatus(
  projectDir: string,
  featureId: number,
  status: FeatureStatus
): void {
  const db = getDatabase(projectDir);
  db.query(
    `UPDATE features SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(status, featureId);
}

/**
 * Get features filtered by status.
 */
export function getFeaturesByStatus(
  projectDir: string,
  status: FeatureStatus
): Feature[] {
  const db = getDatabase(projectDir);
  const query = db.query(`
    SELECT id, name, description, category, testing_steps, status, retry_count
    FROM features
    WHERE status = ?
    ORDER BY id ASC
  `);

  const rows = query.all(status) as Array<{
    id: number;
    name: string;
    description: string;
    category: string;
    testing_steps: string;
    status: string;
    retry_count: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    testing_steps: JSON.parse(row.testing_steps),
    status: row.status as FeatureStatus,
    retry_count: row.retry_count,
  }));
}

/**
 * Get the currently in-progress feature (if any).
 */
export function getCurrentFeature(projectDir: string): Feature | null {
  const db = getDatabase(projectDir);
  const row = db
    .query(
      `
    SELECT id, name, description, category, testing_steps, status, retry_count
    FROM features
    WHERE status = 'in_progress'
    LIMIT 1
  `
    )
    .get() as {
    id: number;
    name: string;
    description: string;
    category: string;
    testing_steps: string;
    status: string;
    retry_count: number;
  } | null;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    testing_steps: JSON.parse(row.testing_steps),
    status: row.status as FeatureStatus,
    retry_count: row.retry_count,
  };
}

// ============================================================================
// Retry Management
// ============================================================================

/**
 * Mark a feature for retry, incrementing its retry count.
 * If max retries exceeded, marks as failed.
 */
export function markFeatureForRetry(
  projectDir: string,
  featureId: number,
  maxRetries: number = 3
): { status: FeatureStatus; retryCount: number } {
  const db = getDatabase(projectDir);

  db.query(
    `UPDATE features SET retry_count = retry_count + 1 WHERE id = ?`
  ).run(featureId);

  const row = db
    .query(`SELECT retry_count FROM features WHERE id = ?`)
    .get(featureId) as { retry_count: number };
  const retryCount = row.retry_count;

  const newStatus: FeatureStatus =
    retryCount >= maxRetries ? "failed" : "pending";
  db.query(`UPDATE features SET status = ? WHERE id = ?`).run(
    newStatus,
    featureId
  );

  return { status: newStatus, retryCount };
}

// ============================================================================
// Notes Management
// ============================================================================

/**
 * Add a note to the database.
 */
export function addNote(projectDir: string, note: NoteInput): number {
  const db = getDatabase(projectDir);
  const result = db
    .query(
      `
    INSERT INTO notes (feature_id, category, content, created_by_session)
    VALUES (?, ?, ?, ?)
  `
    )
    .run(note.featureId, note.category, note.content, note.sessionId);
  return Number(result.lastInsertRowid);
}

/**
 * Get notes for a feature, category, or global notes.
 */
export function getNotesForFeature(
  projectDir: string,
  featureId: number | null,
  category: string | null
): Note[] {
  const db = getDatabase(projectDir);
  // Get notes that match:
  // - specific feature_id, OR
  // - specific category, OR
  // - global (both null)
  const rows = db
    .query(
      `
    SELECT * FROM notes
    WHERE feature_id = ?
       OR category = ?
       OR (feature_id IS NULL AND category IS NULL)
    ORDER BY created_at DESC
  `
    )
    .all(featureId, category);
  return rows as Note[];
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Start a new session.
 */
export function startSession(projectDir: string): number {
  const db = getDatabase(projectDir);
  const result = db
    .query(`INSERT INTO sessions (status) VALUES ('running')`)
    .run();
  return Number(result.lastInsertRowid);
}

/**
 * End a session with statistics.
 */
export function endSession(
  projectDir: string,
  sessionId: number,
  stats: SessionStats
): void {
  const db = getDatabase(projectDir);
  db.query(
    `
    UPDATE sessions
    SET ended_at = CURRENT_TIMESTAMP,
        status = ?,
        features_attempted = ?,
        features_completed = ?,
        input_tokens = ?,
        output_tokens = ?,
        cost_usd = ?,
        error_message = ?
    WHERE id = ?
  `
  ).run(
    stats.status,
    stats.features_attempted ?? 0,
    stats.features_completed ?? 0,
    stats.input_tokens ?? null,
    stats.output_tokens ?? null,
    stats.cost_usd ?? null,
    stats.error_message ?? null,
    sessionId
  );
}

/**
 * Reset any features that were left in 'in_progress' status (orphaned from crashed sessions).
 */
export function resetOrphanedFeatures(projectDir: string): number {
  const db = getDatabase(projectDir);
  const result = db
    .query(
      `UPDATE features SET status = 'pending' WHERE status = 'in_progress'`
    )
    .run();
  return result.changes;
}

// ============================================================================
// Kanban Stats
// ============================================================================

/**
 * Get kanban-style statistics showing feature counts by status.
 */
export function getKanbanStats(projectDir: string): KanbanStats {
  const db = getDatabase(projectDir);

  const totals = db
    .query(
      `
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM features
  `
    )
    .get() as {
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
  };

  const byCategory = db
    .query(
      `
    SELECT
      category,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM features
    GROUP BY category
    ORDER BY category
  `
    )
    .all() as KanbanStats["byCategory"];

  return { ...totals, byCategory };
}
