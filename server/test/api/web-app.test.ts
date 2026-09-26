import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/api/app.ts';
import { testAppDeps } from '../fakes.ts';

// In production the API serves the built web app too. These check what it answers for each kind of path.

let app: App;
let webDistDir: string;

beforeEach(async () => {
  webDistDir = mkdtempSync(path.join(tmpdir(), 'web-dist-'));
  mkdirSync(path.join(webDistDir, 'assets'));
  writeFileSync(path.join(webDistDir, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(path.join(webDistDir, 'assets', 'LogsPage-NEW.js'), 'export const LogsPage = 1;');
  app = await buildApp(testAppDeps({ webDistDir }));
});

afterEach(() => app.close());

const get = (url: string) => app.inject({ method: 'GET', url });

describe('serving the web app', () => {
  it.each(['/', '/status', '/logs?type=upload.deleted', '/uploads/5a1e7e7e-0000-4000-8000-000000000001?status=failed'])(
    'answers the app\'s own page routes (%s) with the app, which routes them itself',
    async (url) => {
      const response = await get(url);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
    },
  );

  it('serves the built files', async () => {
    const response = await get('/assets/LogsPage-NEW.js');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('javascript');
  });

  it("answers 404 for a file that isn't there, such as an old build's chunk asked for after a deploy", async () => {
    // Answering with the page's HTML instead made the browser's import of the chunk fail, crashing the page.
    const response = await get('/assets/LogsPage-OLD.js');
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('keeps unknown API paths a JSON 404', async () => {
    expect((await get('/api/nothing-here')).statusCode).toBe(404);
  });
});
