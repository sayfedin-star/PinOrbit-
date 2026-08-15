-- Migration: Add board_webhook_id to accounts
-- Enables explicit selection of dedicated board webhook channel for create/list/delete operations

ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS board_webhook_id UUID REFERENCES public.account_webhooks(id) ON DELETE SET NULL;
