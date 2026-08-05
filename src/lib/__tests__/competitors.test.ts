import { describe, it, expect } from 'vitest';
import {
  parsePinterestPayload,
  calculateCompetitorDeltas,
  calculateStrategyAge,
  ingestDevToolsPayload,
  getCompetitors,
} from '../competitors';

describe('Competitor Intelligence Payload Parser & Engine', () => {
  it('should auto-detect and parse UserResource JSON payload', () => {
    const rawUserPayload = JSON.stringify({
      endpoint_name: 'v3_get_user_handler',
      resource_response: {
        data: {
          username: 'recipeking',
          full_name: 'The Recipe King',
          profile_reach: 5200000,
          profile_views: 1400000,
          follower_count: 250000,
          pin_count: 6300,
          image_large_url: 'https://example.com/avatar.jpg',
          about: 'Daily recipes and cooking tutorials',
        },
      },
    });

    const parsed = parsePinterestPayload(rawUserPayload);

    expect(parsed.type).toBe('user_profile');
    expect(parsed.username).toBe('recipeking');
    expect(parsed.profileData?.full_name).toBe('The Recipe King');
    expect(parsed.profileData?.profile_reach).toBe(5200000);
    expect(parsed.profileData?.follower_count).toBe(250000);
    expect(parsed.profileData?.pin_count).toBe(6300);
    expect(parsed.profileData?.avatar_url).toBe('https://example.com/avatar.jpg');
  });

  it('should auto-detect and parse BoardsResource JSON payload', () => {
    const rawBoardsPayload = JSON.stringify({
      endpoint_name: 'v3_user_profile_boards_feed',
      options: { username: 'recipeking' },
      resource_response: {
        data: [
          {
            type: 'board',
            id: 'board-101',
            name: 'Quick Breakfasts',
            description: 'Easy morning meals',
            url: '/recipeking/quick-breakfasts/',
            pin_count: 450,
            follower_count: 12000,
            created_at: '2021-05-10T12:00:00Z',
            board_order_modified_at: '2026-08-01T15:30:00Z',
          },
          {
            type: 'board',
            id: 'board-102',
            name: 'Healthy Snacks',
            description: 'Low calorie treats',
            url: '/recipeking/healthy-snacks/',
            pin_count: 820,
            follower_count: 31000,
            created_at: '2020-01-15T08:00:00Z',
            board_order_modified_at: '2026-08-04T10:00:00Z',
          },
        ],
      },
    });

    const parsed = parsePinterestPayload(rawBoardsPayload);

    expect(parsed.type).toBe('user_boards');
    expect(parsed.boardsData?.length).toBe(2);
    expect(parsed.boardsData?.[0].board_id).toBe('board-101');
    expect(parsed.boardsData?.[0].name).toBe('Quick Breakfasts');
    expect(parsed.boardsData?.[0].board_created_at).toBe('2021-05-10T12:00:00.000Z');
    expect(parsed.boardsData?.[1].board_created_at).toBe('2020-01-15T08:00:00.000Z');
  });

  it('should accurately calculate competitor growth deltas', () => {
    const current = {
      profile_reach: 5000000,
      profile_views: 1500000,
      follower_count: 200000,
      pin_count: 10000,
    };

    const previous = {
      profile_reach: 4000000,
      profile_views: 1200000,
      follower_count: 160000,
      pin_count: 8000,
    };

    const deltas = calculateCompetitorDeltas(current, previous);

    expect(deltas.reachChange).toBe(1000000);
    expect(deltas.reachPercent).toBe(25);
    expect(deltas.viewsChange).toBe(300000);
    expect(deltas.viewsPercent).toBe(25);
    expect(deltas.followersChange).toBe(40000);
    expect(deltas.followersPercent).toBe(25);
    expect(deltas.pinsChange).toBe(2000);
    expect(deltas.pinsPercent).toBe(25);
  });

  it('should calculate strategy age and identify oldest board date', () => {
    const boards = [
      {
        id: '1',
        competitor_id: 'comp-1',
        board_id: 'b1',
        name: 'Board 1',
        pin_count: 100,
        follower_count: 500,
        board_created_at: '2023-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: '2',
        competitor_id: 'comp-1',
        board_id: 'b2',
        name: 'Board 2',
        pin_count: 200,
        follower_count: 1500,
        board_created_at: '2019-06-15T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    const { strategyAgeDays, oldestBoardDate } = calculateStrategyAge(boards);

    expect(oldestBoardDate).toBe('2019-06-15T00:00:00Z');
    expect(strategyAgeDays).toBeGreaterThan(2000);
  });

  it('should ingest DevTools payload into competitor mock state', async () => {
    const comps = await getCompetitors();
    const targetComp = comps[0];

    const rawUserPayload = JSON.stringify({
      endpoint_name: 'UserResource',
      resource_response: {
        data: {
          username: targetComp.username,
          profile_reach: 6000000,
          follower_count: 400000,
          pin_count: 9000,
        },
      },
    });

    const res = await ingestDevToolsPayload(targetComp.id, rawUserPayload);

    expect(res.success).toBe(true);
    expect(res.type).toBe('user_profile');

    const updatedComps = await getCompetitors();
    const updated = updatedComps.find((c) => c.id === targetComp.id);
    expect(updated?.profile_reach).toBe(6000000);
    expect(updated?.follower_count).toBe(400000);
  });
});
