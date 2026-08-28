ALTER TABLE labels RENAME TO tags;

ALTER TABLE card_labels RENAME TO card_tags;

UPDATE workspaces
SET name = 'Sample Workspace',
    slug = CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM workspaces AS other
        WHERE other.slug = 'sample-workspace' AND other.id <> workspaces.id
      ) THEN 'sample-workspace'
      ELSE slug
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'sandbox-workspace';

UPDATE boards
SET name = 'Sample Board',
    slug = CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM boards AS other
        WHERE other.workspace_id = boards.workspace_id
          AND other.slug = 'sample-board'
          AND other.id <> boards.id
      ) THEN 'sample-board'
      ELSE slug
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'sandbox-board';

UPDATE tags SET name = 'Getting started', color = 'neutral' WHERE id = 'label-foundation';
UPDATE tags SET name = 'Collaboration', color = 'neutral' WHERE id = 'label-frontend';
