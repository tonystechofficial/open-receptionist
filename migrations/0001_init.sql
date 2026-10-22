-- Cloudflare D1 schema. Your database is the source of truth.
CREATE TABLE IF NOT EXISTS calls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nom        TEXT,
  besoin     TEXT,
  urgence    TEXT,
  telephone  TEXT,
  email      TEXT,
  complet    INTEGER,
  souhaite   TEXT,
  summary    TEXT,
  ended_at   TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS appointments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT,
  nom         TEXT,
  besoin      TEXT,
  telephone   TEXT,
  email       TEXT,
  booking_ref TEXT,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
