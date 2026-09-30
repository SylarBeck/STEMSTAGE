-- Indexed title/artist search for a large public song catalog. Apply before deploying the Worker.
CREATE VIRTUAL TABLE IF NOT EXISTS song_search USING fts5(title, artist, content='songs', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2', prefix='2 3');
CREATE TRIGGER IF NOT EXISTS songs_search_ai AFTER INSERT ON songs BEGIN
  INSERT INTO song_search(rowid, title, artist) VALUES (new.rowid, new.title, new.artist);
END;
CREATE TRIGGER IF NOT EXISTS songs_search_ad AFTER DELETE ON songs BEGIN
  INSERT INTO song_search(song_search, rowid, title, artist) VALUES ('delete', old.rowid, old.title, old.artist);
END;
CREATE TRIGGER IF NOT EXISTS songs_search_au AFTER UPDATE ON songs BEGIN
  INSERT INTO song_search(song_search, rowid, title, artist) VALUES ('delete', old.rowid, old.title, old.artist);
  INSERT INTO song_search(rowid, title, artist) VALUES (new.rowid, new.title, new.artist);
END;
INSERT INTO song_search(song_search) VALUES ('rebuild');
CREATE INDEX IF NOT EXISTS runs_song ON runs (song_key, player_id);
