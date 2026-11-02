PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS rooms (
 id TEXT PRIMARY KEY, admin_hash TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invitations (
 room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL, slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 5),
 PRIMARY KEY(room_id, token_hash), UNIQUE(room_id, slot)
);
CREATE TABLE IF NOT EXISTS allocations (
 room_id TEXT NOT NULL, token_hash TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 20), name_key TEXT NOT NULL,
 seat INTEGER NOT NULL CHECK(seat IN (178,180,181,182,183)), created_at INTEGER NOT NULL,
 PRIMARY KEY(room_id,token_hash), UNIQUE(room_id,seat), UNIQUE(room_id,name_key),
 FOREIGN KEY(room_id,token_hash) REFERENCES invitations(room_id,token_hash)
);
