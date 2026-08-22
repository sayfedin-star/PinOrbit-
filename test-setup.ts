// Global test setup for offline vitest execution
process.env.PUBLIC_SCHEDULING_SUPABASE_URL = 'https://your-project-1.supabase.co';
process.env.SCHEDULING_SUPABASE_URL = 'https://your-project-1.supabase.co';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // If fetch is not explicitly mocked in a test file, provide a default fallback
  if (!vi.isMockFunction(globalThis.fetch)) {
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof Request ? url.url : url.toString();
      if (urlStr.includes('supabase.co') || urlStr.includes('localhost')) {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return originalFetch(url, init);
    });
  }
});
