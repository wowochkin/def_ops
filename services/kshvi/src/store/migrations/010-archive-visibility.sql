ALTER TABLE exercises
  ADD COLUMN archive_hidden_at timestamptz,
  ADD COLUMN archive_hidden_by text,
  ADD COLUMN archive_hidden_reason text,
  ADD CHECK ((archive_hidden_at IS NULL AND archive_hidden_by IS NULL AND archive_hidden_reason IS NULL)
    OR (state = 'ARCHIVED' AND archive_hidden_at IS NOT NULL AND archive_hidden_by IS NOT NULL
      AND archive_hidden_reason IS NOT NULL AND length(trim(archive_hidden_reason)) > 0));
