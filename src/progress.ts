/**
 * Progress Tracking Utilities
 *
 * Functions for reading and displaying feature list progress.
 * Agent files are stored in .autonomous/ directory.
 */

import fs from "fs";
import path from "path";

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
 * Load the feature list from a project directory.
 */
export function loadFeatureList(projectDir: string): Feature[] {
  const filePath = path.join(projectDir, AUTONOMOUS_DIR, "feature_list.json");

  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading feature_list.json: ${error}`);
    return [];
  }
}

/**
 * Check if there are any features with passes: false.
 */
export function hasFailingFeatures(projectDir: string): boolean {
  const features = loadFeatureList(projectDir);
  return features.some((f) => !f.passes);
}

/**
 * Count passing and total tests.
 */
export function countProgress(projectDir: string): {
  passing: number;
  total: number;
} {
  const features = loadFeatureList(projectDir);
  const passing = features.filter((f) => f.passes).length;
  return { passing, total: features.length };
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
  const features = loadFeatureList(projectDir);
  const categoryMap = new Map<string, { passing: number; total: number }>();

  for (const feature of features) {
    const category = feature.category || "uncategorized";
    const current = categoryMap.get(category) || { passing: 0, total: 0 };
    current.total++;
    if (feature.passes) {
      current.passing++;
    }
    categoryMap.set(category, current);
  }

  return Array.from(categoryMap.entries()).map(([category, stats]) => ({
    category,
    passing: stats.passing,
    total: stats.total,
  }));
}

/**
 * Print a progress summary to the console.
 */
export function printProgressSummary(projectDir: string): void {
  const features = loadFeatureList(projectDir);
  const passing = features.filter((f) => f.passes).length;
  const failing = features.filter((f) => !f.passes).length;
  const total = features.length;
  const percentage = total > 0 ? Math.round((passing / total) * 100) : 0;

  console.log(
    `Features: ${passing} passing, ${failing} remaining (${percentage}% complete)`
  );

  // Show category breakdown if categories exist
  const categoryProgress = getCategoryProgress(projectDir);
  const hasCategories = categoryProgress.some((c) => c.category !== "uncategorized");

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
  const nextFeature = features.find((f) => !f.passes);
  if (nextFeature) {
    const categoryInfo = nextFeature.category ? ` [${nextFeature.category}]` : "";
    console.log(`Next: "${nextFeature.name}"${categoryInfo}`);
  }
}
