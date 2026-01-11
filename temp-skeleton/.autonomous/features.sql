-- Features for Test App (complete schema)
-- Run with: sqlite3 db.sqlite < features.sql

-- Features table
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

-- Notes table
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

-- Sessions table
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

-- Test features
INSERT INTO features (id, name, description, category, testing_steps, status) VALUES
(1, 'Display counter', 'Show a counter value on the page, starting at 0', 'core', '["Navigate to the app", "Verify a counter showing 0 is visible"]', 'pending'),
(2, 'Increment button', 'Add a button that increments the counter by 1 when clicked', 'core', '["Click the increment button", "Verify counter increases by 1"]', 'pending'),
(3, 'Decrement button', 'Add a button that decrements the counter by 1 when clicked', 'core', '["Click the decrement button", "Verify counter decreases by 1"]', 'pending');
