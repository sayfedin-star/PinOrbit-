import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resolves the Competitors vault KEK from the DB (singleton row).
 * Self-provisions lazily on first use (Rule 4: fail-lazy at use-time).
 * Never returns the KEK to the browser — server-side only.
 */
export async function resolveCompetitorKek(db: SupabaseClient): Promise<string | null> {
  try {
    const { data } = await db.from('competitor_kek').select('kek').limit(1).maybeSingle();
    if (data?.kek) return data.kek;

    const hex = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    await db.from('competitor_kek').upsert({ id: true, kek: hex }, { onConflict: 'id' });
    const { data: created } = await db.from('competitor_kek').select('kek').limit(1).maybeSingle();
    return created?.kek || null;
  } catch {
    return null;
  }
}

export async function isCompetitorKekActive(db: SupabaseClient): Promise<boolean> {
  try {
    const { data } = await db.from('competitor_kek').select('id').limit(1);
    return Boolean(data && data.length > 0);
  } catch {
    return false;
  }
}
