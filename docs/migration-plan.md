# Production Migration Plan & Cutover Strategy

## Pre-Cutover Status
- **Legacy Database (`zeryyrmhdueezzwyodhq`):** READ ONLY during all development and testing phases.
- **Target Projects:**
  - Project 1 (Scheduling): `eygdoetdwqllvsxpvoex`
  - Project 2 (Competitors): `guycnhvwfzdzbpgsnavg`
  - Project 3 (Analytics): `jxdkbwnwtjelznmauwpc`

## Migration Sequence

```
[Phase 0: Audit & Plan] (Complete)
         │
[Phase 1: Foundation & Docs] (Current)
         │
[Phase 2: Project 1 Scheduling Schema & Auth SSR]
         │
[Phase 3: Server Data Access Layer & Guard Tests]
         │
[Phase 4: Project 2 Competitors Schema & Ingestion]
         │
[Phase 5: Project 3 Analytics Schema & Reporting]
         │
[Phase 6: Comprehensive Security & Build Verification]
         │
[Phase 7: Controlled Data Migration & Cutover Runbook]
```

## Data Migration Rules
1. **No Data Modification on Legacy:** All legacy inspection queries use read-only transactions.
2. **Export Phase:** Data extracted from legacy using schema-aware SQL exports segmented by target project.
3. **Parity Check:** Every migrated table must match row-for-row and checksum against legacy before production traffic switch.
4. **Rollback Safety:** If any anomaly occurs during Phase 7 validation, DNS/Cloudflare Pages traffic points back to legacy with zero data corruption.
