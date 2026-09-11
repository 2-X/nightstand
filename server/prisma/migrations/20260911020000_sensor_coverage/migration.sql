ALTER TABLE vitals ADD COLUMN hrv_timestamp INTEGER;
ALTER TABLE vitals ADD COLUMN breathing_timestamp INTEGER;
CREATE TABLE sensor_samples (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  fields TEXT NOT NULL
);
CREATE UNIQUE INDEX sensor_samples_kind_timestamp_key ON sensor_samples(kind,timestamp);
CREATE INDEX sensor_samples_timestamp_idx ON sensor_samples(timestamp);
