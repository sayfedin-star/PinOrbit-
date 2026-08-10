import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Project 3 Standalone Architectural Separation Guard (Static Analysis)', () => {
  const analyticsFiles = [
    path.resolve(process.cwd(), 'src/server/db/analytics.ts'),
    path.resolve(process.cwd(), 'src/server/services/pinner-etl.ts'),
    path.resolve(process.cwd(), 'src/server/services/pinner-analytics-service.ts'),
    path.resolve(process.cwd(), 'src/server/services/edge-cache.ts'),
    path.resolve(process.cwd(), 'src/server/services/fastcron-service.ts'),
  ];

  it('guarantees zero calls to getSchedulingAdmin or getCompetitorsAdmin in analytics services', () => {
    for (const filePath of analyticsFiles) {
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf-8');

      // Static check: Must NOT invoke getSchedulingAdmin or getCompetitorsAdmin
      expect(content).not.toContain('getSchedulingAdmin(');
      expect(content).not.toContain('getCompetitorsAdmin(');

      // Must NOT reference Project 1 scheduling tables directly
      expect(content).not.toContain(".from('import_sessions')");
    }
  });

  it('guarantees zero occurrences of /api/internal/analytics in codebase (F4)', () => {
    const dirPath = path.resolve(process.cwd(), 'src/pages/api/internal/analytics');
    if (fs.existsSync(dirPath)) {
      const getFilesRecursively = (dir: string): string[] => {
        const files: string[] = [];
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          const res = path.resolve(dir, item.name);
          if (item.isDirectory()) {
            files.push(...getFilesRecursively(res));
          } else {
            files.push(res);
          }
        }
        return files;
      };
      
      const files = getFilesRecursively(dirPath);
      expect(files.length).toBe(0);
    } else {
      expect(fs.existsSync(dirPath)).toBe(false);
    }
  });
});
