-- Migration: Board Auto-Provisioning & Webhook Fallback Schema Changes

-- 1. Add auto-provisioning metadata columns to boards table
ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS pinterest_board_id text,
  ADD COLUMN IF NOT EXISTS created_via text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS created_via_webhook_id text;

-- 2. Add board auto-provisioning settings columns to accounts table
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS auto_create_missing_boards boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS board_creation_webhook_id text;

-- 3. Create DB-level unique index on normalized board name per account (LOWER + TRIM)
CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_account_name_unique
  ON public.boards (account_id, LOWER(TRIM(board_name)));

-- 4. Create index on pinterest_board_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_boards_pinterest_board_id
  ON public.boards (pinterest_board_id);

COMMENT ON COLUMN public.boards.created_via IS 'Origin of board record: manual, webhook_auto_create';
COMMENT ON COLUMN public.boards.created_via_webhook_id IS 'Webhook channel ID used to provision board in Pinterest';
COMMENT ON COLUMN public.accounts.auto_create_missing_boards IS 'Whether missing boards found during import/publish should be auto-created via webhook';
COMMENT ON COLUMN public.accounts.board_creation_webhook_id IS 'Default webhook channel ID for board auto-creation';
