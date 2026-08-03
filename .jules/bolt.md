## 2026-08-03 - Database Request Parallelization in Account Statistics

**Learning:** When computing derived account metrics from multiple database tables (`pins` for counts and `accounts` for daily limits), sequential `await` calls introduce unnecessary network waterfalls (~100-150ms per roundtrip). Using `Promise.all()` to batch Supabase RPC/REST calls in parallel cuts query response latency in half.

**Action:** Always wrap independent Supabase table queries in `Promise.all()` to eliminate sequential network waterfalls across API data fetchers.
