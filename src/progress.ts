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
  hasFailingFeatures as dbHasFailingFeatures,
  getProgressStats,
  getNextFeature,
  getAllFeatures,
} from "./db.js";

// Agent files directory
export const AUTONOMOUS_DIR = ".autonomous";

export interface Feature {
  id?: number;
  name: string;
  description: string;
  category?: string;
  testing_steps: string[];
  passes: boolean;
}

export interface CategoryProgress {
  category: string;
  passing: number;
  total: number;
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
 * Check if there are any features with passes: false.
 */
export function hasFailingFeatures(projectDir: string): boolean {
  return dbHasFailingFeatures(projectDir);
}

/**
 * Count passing and total tests.
 */
export function countProgress(projectDir: string): {
  passing: number;
  total: number;
} {
  const stats = getProgressStats(projectDir);
  return { passing: stats.passing, total: stats.total };
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
  const stats = getProgressStats(projectDir);
  const passing = stats.passing;
  const failing = stats.total - passing;
  const percentage =
    stats.total > 0 ? Math.round((passing / stats.total) * 100) : 0;

  console.log(
    `Features: ${passing} passing, ${failing} remaining (${percentage}% complete)`
  );

  // Show category breakdown if categories exist
  const categoryProgress = stats.byCategory;
  const hasCategories = categoryProgress.some(
    (c) => c.category !== "uncategorized"
  );

  if (hasCategories && categoryProgress.length > 1) {
    const categoryStatus = categoryProgress
      .map((c) => {
        const done = c.passing === c.total;
        const mark = done ? "✓" : " ";
        return `[${mark}] ${c.category}: ${c.passing}/${c.total}`;
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
