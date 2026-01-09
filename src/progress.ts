/**
 * Progress Tracking Utilities
 *
 * Functions for reading and displaying feature list progress.
 * Agent files are stored in .autonomous/ directory.
 * Uses SQLite database for efficient feature tracking.
 */

import fs from "fs";
import path from "path";
import {
  hasIncompleteFeatures as dbHasIncompleteFeatures,
  getProgressStats,
  getNextFeature,
  getAllFeatures,
  getKanbanStats,
} from "./db.js";

// Agent files directory
export const AUTONOMOUS_DIR = ".autonomous";

export interface Feature {
  id?: number;
  name: string;
  description: string;
  category?: string;
  testing_steps: string[];
  passes: boolean; // Keep for backward compat, derived from status
  status: "pending" | "in_progress" | "completed" | "failed";
  retry_count: number;
}

export interface CategoryProgress {
  category: string;
  passing: number; // Keep for backward compat (same as completed)
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
}

/**
 * Get the path to the .autonomous directory.
 */
export function getAutonomousDir(projectDir: string): string {
  return path.join(projectDir, AUTONOMOUS_DIR);
}

/**
 * Ensure the .autonomous directory exists.
 */
export function ensureAutonomousDir(projectDir: string): string {
  const dir = getAutonomousDir(projectDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Check if there are any incomplete features (not completed).
 */
export function hasIncompleteFeatures(projectDir: string): boolean {
  return dbHasIncompleteFeatures(projectDir);
}

// Keep alias for backward compatibility
export const hasFailingFeatures = hasIncompleteFeatures;

/**
 * Count passing and total tests.
 */
export function countProgress(projectDir: string): {
  passing: number;
  total: number;
} {
  const stats = getKanbanStats(projectDir);
  const total =
    stats.pending + stats.in_progress + stats.completed + stats.failed;
  return { passing: stats.completed, total };
}

/**
 * Get a formatted progress string.
 */
export function getProgressString(projectDir: string): string {
  const { passing, total } = countProgress(projectDir);
  const percentage = total > 0 ? Math.round((passing / total) * 100) : 0;
  return `Progress: ${passing}/${total} features passing (${percentage}%)`;
}

/**
 * Get progress by category.
 */
export function getCategoryProgress(projectDir: string): CategoryProgress[] {
  const stats = getProgressStats(projectDir);
  return stats.byCategory;
}

/**
 * Print a progress summary to the console.
 */
export function printProgressSummary(projectDir: string): void {
  const stats = getKanbanStats(projectDir);
  const total =
    stats.pending + stats.in_progress + stats.completed + stats.failed;
  const percentage =
    total > 0 ? Math.round((stats.completed / total) * 100) : 0;

  console.log(
    `Features: ${stats.completed} completed, ${stats.pending} pending, ${stats.failed} failed (${percentage}% complete)`
  );

  if (stats.in_progress > 0) {
    console.log(`Currently in progress: ${stats.in_progress}`);
  }

  // Show category breakdown if categories exist
  const hasCategories = stats.byCategory.some(
    (c) => c.category !== "uncategorized"
  );

  if (hasCategories && stats.byCategory.length > 1) {
    const categoryStatus = stats.byCategory
      .map((c) => {
        const catTotal = c.pending + c.in_progress + c.completed + c.failed;
        const done = c.completed === catTotal;
        const mark = done ? "✓" : c.failed > 0 ? "✗" : " ";
        return `[${mark}] ${c.category}: ${c.completed}/${catTotal}`;
      })
      .join("  ");
    console.log(`Categories: ${categoryStatus}`);
  }

  // Show next feature to implement
  const nextFeature = getNextFeature(projectDir);
  if (nextFeature) {
    const categoryInfo = nextFeature.category
      ? ` [${nextFeature.category}]`
      : "";
    console.log(`Next: "${nextFeature.name}"${categoryInfo}`);
  }
}
