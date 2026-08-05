-- Migration: 20260805_competitor_intelligence.sql
-- Description: Create Competitor Analytics, Snapshots, and Board Strategy Tracking tables with RLS and Indexes.

-- 1. Table: competitors
CREATE TABLE IF NOT EXISTS public.competitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    username VARCHAR(100) NOT NULL,
    full_name TEXT,
    niche VARCHAR(100),
    profile_reach BIGINT DEFAULT 0,
    profile_views BIGINT DEFAULT 0,
    follower_count INT DEFAULT 0,
    pin_count INT DEFAULT 0,
    avatar_url TEXT,
    notes TEXT,
    last_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_user_competitor_username UNIQUE (user_id, username)
);

-- 2. Table: competitor_snapshots
CREATE TABLE IF NOT EXISTS public.competitor_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor_id UUID NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
    profile_reach BIGINT DEFAULT 0,
    profile_views BIGINT DEFAULT 0,
    follower_count INT DEFAULT 0,
    pin_count INT DEFAULT 0,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Table: competitor_boards
CREATE TABLE IF NOT EXISTS public.competitor_boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor_id UUID NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
    board_id VARCHAR(100) NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    url TEXT,
    pin_count INT DEFAULT 0,
    follower_count INT DEFAULT 0,
    board_created_at TIMESTAMPTZ,
    last_pinned_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_competitor_board UNIQUE (competitor_id, board_id)
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_boards ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for competitors
CREATE POLICY "Users can manage their own competitors"
ON public.competitors
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 6. RLS Policies for competitor_snapshots
CREATE POLICY "Users can manage snapshots for their competitors"
ON public.competitor_snapshots
FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.competitors
        WHERE competitors.id = competitor_snapshots.competitor_id
          AND competitors.user_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.competitors
        WHERE competitors.id = competitor_snapshots.competitor_id
          AND competitors.user_id = auth.uid()
    )
);

-- 7. RLS Policies for competitor_boards
CREATE POLICY "Users can manage board strategy for their competitors"
ON public.competitor_boards
FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.competitors
        WHERE competitors.id = competitor_boards.competitor_id
          AND competitors.user_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.competitors
        WHERE competitors.id = competitor_boards.competitor_id
          AND competitors.user_id = auth.uid()
    )
);

-- 8. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_competitors_user_id ON public.competitors(user_id);
CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_competitor_id ON public.competitor_snapshots(competitor_id);
CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_recorded_at ON public.competitor_snapshots(recorded_at);
CREATE INDEX IF NOT EXISTS idx_competitor_boards_competitor_id ON public.competitor_boards(competitor_id);
