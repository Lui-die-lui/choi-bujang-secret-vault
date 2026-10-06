import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentIdentity } from '../scripts/deployment-identity.mjs';
import { runAttackChecks } from '../src/attack-check.mjs';

const config = {
  step: 4,
  judgeIssuer: 'https://aleph-judge-production.up.railway.app/defense/judge',
  sampleMarker: 'SAMPLE_NOTE_1',
  publicAppUrl: 'https://student-defense.vercel.app',
  identityProvider: {
    issuer: 'https://test-project.supabase.co/auth/v1',
    audience: 'authenticated',
    jwksUrl: 'https://test-project.supabase.co/auth/v1/.well-known/jwks.json',
  },
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
    step: 4,
    repoUrl: 'https://github.com/student-a/aleph-defense',
    commit: 'a'.repeat(40),
    publicAppUrl: 'https://student-defense-123.vercel.app',
    judgeIssuer: config.judgeIssuer,
    sampleMarker: config.sampleMarker,
  });
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_PROVIDER: undefined }, config));
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_COMMIT_SHA: 'short' }, config));
});

test('fourth-stage attack check confirms data.json stays empty, the notes APIs and direct Data API reject anonymous/anon-key requests', async () => {
  const originalFetch = globalThis.fetch;
  const requestUrls = [];
  try {
    globalThis.fetch = async (url, init) => {
      requestUrls.push(String(url));
      if (String(url).endsWith('/data.json')) {
        assert.equal(init.redirect, 'error');
        return new Response(JSON.stringify({ notes: [] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (String(url).includes('/rest/v1/t03_personal_notes')) {
        return new Response(JSON.stringify({ code: '42501', message: 'permission denied' }), {
          status: 401, headers: { 'content-type': 'application/json' },
        });
      }
      assert.equal(init.redirect, 'error');
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { 'content-type': 'application/json' },
      });
    };
    const [dataLeak, notesDenied, myNotesDenied, directDbDenied] = await runAttackChecks(config);
    assert.deepEqual(requestUrls, [
      'https://student-defense.vercel.app/data.json',
      'https://student-defense.vercel.app/api/notes',
      'https://student-defense.vercel.app/api/my-notes',
      'https://test-project.supabase.co/rest/v1/t03_personal_notes?select=id',
    ]);
    assert.match(dataLeak.observed, /보이지 않음/u);
    assert.match(notesDenied.observed, /거부됨/u);
    assert.match(myNotesDenied.observed, /거부됨/u);
    assert.match(directDbDenied.observed, /거부됨/u);

    globalThis.fetch = async (url) => (String(url).includes('/rest/v1/t03_personal_notes')
      ? new Response(JSON.stringify([{ id: '1' }]), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
      : new Response(JSON.stringify({ notes: [] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    const [, , , directDbStillOpen] = await runAttackChecks(config);
    assert.match(directDbStillOpen.observed, /거부되지 않음/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
