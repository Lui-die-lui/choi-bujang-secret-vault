import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentIdentity } from '../scripts/deployment-identity.mjs';
import { runAttackChecks } from '../src/attack-check.mjs';

const config = {
  step: 2,
  judgeIssuer: 'https://aleph-judge-production.up.railway.app/defense/judge',
  sampleMarker: 'SAMPLE_NOTE_1',
  publicAppUrl: 'https://student-defense.vercel.app',
};
const env = {
  VERCEL_GIT_PROVIDER: 'github',
  VERCEL_GIT_REPO_OWNER: 'Student-A',
  VERCEL_GIT_REPO_SLUG: 'aleph-defense',
  VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
  VERCEL_URL: 'student-defense-123.vercel.app',
};

test('build identity uses Vercel Git and deployment metadata', () => {
  assert.deepEqual(deploymentIdentity(env, config), {
    schema: 'aleph.defense.deployment.v1',
    step: 2,
    repoUrl: 'https://github.com/student-a/aleph-defense',
    commit: 'a'.repeat(40),
    publicAppUrl: 'https://student-defense-123.vercel.app',
    judgeIssuer: config.judgeIssuer,
    sampleMarker: config.sampleMarker,
  });
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_PROVIDER: undefined }, config));
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_COMMIT_SHA: 'short' }, config));
});

test('second-stage attack check reads data.json and the notes API without credentials', async () => {
  const originalFetch = globalThis.fetch;
  const requestUrls = [];
  try {
    globalThis.fetch = async (url, init) => {
      requestUrls.push(String(url));
      assert.equal(init.redirect, 'error');
      if (String(url).endsWith('/data.json')) {
        return new Response(JSON.stringify({ sampleMarker: 'SAMPLE_NOTE_1', notes: [] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ notes: [{ title: '가상' }, { title: '가상' }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };
    const [dataLeak, apiRead] = await runAttackChecks(config);
    assert.deepEqual(requestUrls, [
      'https://student-defense.vercel.app/data.json',
      'https://student-defense.vercel.app/api/notes',
    ]);
    assert.match(dataLeak.observed, /보이지 않음/u);
    assert.match(apiRead.observed, /notes 길이 2/u);

    globalThis.fetch = async (url) => (String(url).endsWith('/data.json')
      ? new Response(JSON.stringify({ sampleMarker: 'SAMPLE_NOTE_1', notes: [{ title: '가상' }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
      : new Response(JSON.stringify({ notes: [] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    const [leaked] = await runAttackChecks(config);
    assert.match(leaked.observed, /메모가 보임/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
