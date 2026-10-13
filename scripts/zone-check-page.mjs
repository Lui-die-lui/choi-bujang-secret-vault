import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// 로컬 연습 전용 화면입니다. 내 컴퓨터(127.0.0.1)에서만 열리고 배포되지 않습니다.
// 버튼을 누르면 브라우저가 src/decider.mjs의 decide()에 가상 요청을 넣어 결과를 보여 줍니다.
// 실제 API·반 엔진·심판을 호출하지 않으며, 여기의 통과는 심판 통과 증거가 아닙니다.
const PORT = 4178;
const decider = resolve(import.meta.dirname, '..', 'src', 'decider.mjs');

const PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>8단계 구역 규칙 연습</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 760px; margin: 24px auto; padding: 0 16px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #ccc; padding: 8px; text-align: left; font-size: 14px; }
  button { padding: 6px 12px; cursor: pointer; }
  .pass { color: #0a7a2f; font-weight: 600; }
  .fail { color: #c0182b; font-weight: 600; }
  .note { color: #555; font-size: 13px; }
</style>
</head>
<body>
<h1>8단계 구역 규칙 연습</h1>
<p class="note">가상 요청을 내 컴퓨터의 판정기에 넣어 보는 연습입니다. 실제 API나 심판을 호출하지 않으며 심판 통과 증거가 아닙니다.</p>
<p><button id="run-all">전체 검사</button> <span id="summary"></span></p>
<table>
  <thead><tr><th>요청</th><th>기대</th><th>실제</th><th>이유 코드</th><th></th></tr></thead>
  <tbody id="rows"></tbody>
</table>
<script type="module">
  import { decide } from '/decider.mjs';

  const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const base = over => ({
    schema: 'aleph.decision.v1', requestId: crypto.randomUUID(), classId: 'c', projectId: 'p',
    subjectId: 'learner_fixture', deviceId: 'a'.repeat(16), service: 'notes', method: 'GET',
    path: '/notes/demo', route: 'GET /notes/:id', queryLength: 0, querySha256: EMPTY_SHA256,
    at: new Date().toISOString(), policyRevision: 1, deviceRegistered: true,
    stepUp: { verified: false, authAgeSeconds: null }, recentEvents: [],
    signals: { source: 'none', region: 'unknown', network: 'unknown', hour: 14 }, ...over,
  });
  const composite = { signals: { source: 'judge_fixture', region: 'local', network: 'unusual', hour: 3 },
    recentEvents: [{ kind: 'risk_signal', ageSeconds: 60, count: 20 }] };
  const notice = method => ({ service: 'announcements', method, path: '/announcements/n1',
    route: method + ' /announcements/:id' });

  const cases = [
    { name: '자기 메모 한 건 읽기 (GET /notes/demo)', expect: 'allow', over: {} },
    { name: '자기 메모 수정 (PUT /notes/demo)', expect: 'allow',
      over: { method: 'PUT', route: 'PUT /notes/:id' } },
    { name: '메모 전체 목록 (GET /notes)', expect: 'deny', over: { path: '/notes', route: 'GET /notes' } },
    { name: '목록 기능 경로 (GET /notes/list)', expect: 'deny', over: { path: '/notes/list' } },
    ...['POST', 'PUT', 'PATCH', 'DELETE'].map(method => (
      { name: '공지 쓰기 (' + method + ' /announcements/n1)', expect: 'deny', over: notice(method) })),
    { name: '미등록 기기의 메모 읽기', expect: 'deny', over: { deviceRegistered: false } },
    { name: '복합 이상 접속', expect: 'step_up', over: composite },
    { name: '다시 확인한 복합 이상 접속', expect: 'allow',
      over: { ...composite, stepUp: { verified: true, authAgeSeconds: 60 } } },
  ];

  const rows = document.getElementById('rows');
  const summary = document.getElementById('summary');
  const runners = cases.map(item => {
    const tr = document.createElement('tr');
    const cells = [item.name, item.expect, '-', '-'].map(text => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
      return td;
    });
    const button = document.createElement('button');
    button.textContent = '검사';
    const run = async () => {
      const response = await decide(base(item.over));
      const passed = response.decision === item.expect;
      cells[2].textContent = response.decision + (passed ? ' · 통과' : ' · 확인 필요');
      cells[2].className = passed ? 'pass' : 'fail';
      cells[3].textContent = response.reasonCode;
      return passed;
    };
    button.addEventListener('click', run);
    const td = document.createElement('td');
    td.append(button);
    tr.append(td);
    rows.append(tr);
    return run;
  });

  document.getElementById('run-all').addEventListener('click', async () => {
    let passed = 0;
    for (const run of runners) if (await run()) passed += 1;
    summary.textContent = cases.length + '건 중 통과 ' + passed + '건';
    summary.className = passed === cases.length ? 'pass' : 'fail';
  });
</script>
</body>
</html>
`;

const server = createServer(async (req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405).end();
  } else if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(PAGE);
  } else if (req.url === '/decider.mjs') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
      .end(await readFile(decider, 'utf8'));
  } else {
    res.writeHead(404).end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`구역 규칙 연습 화면: http://127.0.0.1:${PORT}/ (끝내려면 Ctrl+C)`);
  console.log('이 화면은 가상 요청으로 연습하며 심판 통과 증거가 아닙니다.');
});
