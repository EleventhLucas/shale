ALTER TABLE participants ADD COLUMN avatar_data_url TEXT;

ALTER TABLE participants
ADD COLUMN color TEXT NOT NULL DEFAULT '#6b6b68';
