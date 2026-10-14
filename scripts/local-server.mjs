import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

// 12단계 검증용: api/*.mjs 함수를 그대로 불러 로컬 HTTP 서버로 실행합니다. 함수 코드는 배포본과
// 같은 파일이며, 이 서버는 Vercel의 경로 연결·본문·쿼리 해석만 흉내 냅니다(배포 플랫폼 자체가
// 아님). SUPABASE_URL·SUPABASE_SECRET_KEY가 환경에 있으면 실제 Supabase에 접속합니다.
const root = resolve(import.meta.dirname, '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ROUTES = [
  [/^\/api\/notes$/u, 'api/notes.mjs'],
  [/^\/api\/my-notes$/u, 'api/my-notes/index.mjs'],
  [/^\/api\/my-notes\/([^/]+)$/u, 'api/my-notes/[id].mjs'],
  [/^\/api\/note-restore\/([^/]+)$/u, 'api/note-restore/[id].mjs'],
  [/^\/api\/device\/(challenge|request|verify)$/u, 'api/device/$1.mjs'],
  [/^\/api\/auth\/(login|refresh|logout)$/u, 'api/auth/$1.mjs'],
  [/^\/api\/ops\/summary$/u, 'api/ops/summary.mjs'],
];

export function startLocalServer({ port = 0 } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const hit = ROUTES.map(([pattern, file]) => [pattern.exec(url.pathname), file]).find(([m]) => m);
    if (!hit) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"not_found"}'); }
    const [match, template] = hit;
    const file = template.replace('$1', match[1] ?? '');
    const query = Object.fromEntries(url.searchParams);
    if (file.includes('[id]')) query.id = match[1];
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined; } catch { body = undefined; }
    const request = { method: req.method, url: req.url, headers: req.headers, query, body };
    const headers = {};
    let status = 200;
    const finish = payload => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(payload));
    };
    const response = {
      setHeader: (name, value) => { headers[name] = value; },
      status(code) { status = code; return response; },
      json: finish,
      end: () => finish({}),
    };
    try {
      const handler = (await import(pathToFileURL(join(root, file)).href)).default;
      await handler(request, response);
    } catch (error) {
      console.error('local server handler error:', error?.message);
      status = 500;
      finish({ error: 'handler_error' });
    }
  });
  return new Promise(resolveStart => {
    server.listen(port, '127.0.0.1', () => resolveStart({ server, port: server.address().port,
      baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}
