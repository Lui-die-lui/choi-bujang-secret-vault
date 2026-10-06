import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentIdentity } from '../scripts/deployment-identity.mjs';
import { runAttackChecks } from '../src/attack-check.mjs';

const config = {
  step: 5,
  judgeIssuer: 'https://aleph-judge-production.up.railway.app/defense/judge',
  sampleMarker: 'SAMPLE_NOTE_1',
  publicAppUrl: 'https://student-defense.vercel.app',
  identityProvider: {
    issuer: 'https://test-project.supabase.co/auth/v1',
    audience: 'authenticated',
    jwksUrl: 'https://test-project.supabase.co/auth/v1/.well-known/jwks.json',
  },
  allowedRoutes: ['GET /api/notes', 'POST /api/auth/login'],
  originalApiUrl: 'https://test-project.supabase.co/rest/v1/t03_personal_notes',
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
    step: 5,
    repoUrl: 'https://github.com/student-a/aleph-defense',
    commit: 'a'.repeat(40),
    publicAppUrl: 'https://student-defense-123.vercel.app',
    judgeIssuer: config.judgeIssuer,
    sampleMarker: config.sampleMarker,
    allowedRoutes: config.allowedRoutes,
    originalApiUrl: config.originalApiUrl,
  });
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_PROVIDER: undefined }, config));
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_COMMIT_SHA: 'short' }, config));
});

test('fifth-stage attack check confirms data.json stays empty, server APIs and the original Data API reject anon-key requests, and no secret key leaks into the static bundle', async () => {
  const originalFetch = globalThis.fetch;
  const requestUrls = [];
  try {
    globalThis.fetch = async (url, init) => {
      const href = String(url);
      requestUrls.push(href);
      if (href.endsWith('/data.json')) {
        assert.equal(init.redirect, 'error');
        return new Response(JSON.stringify({ notes: [] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (href.startsWith(config.originalApiUrl)) {
        return new Response(JSON.stringify({ code: '42501', message: 'permission denied' }), {
          status: 401, headers: { 'content-type': 'application/json' },
        });
      }
      if (href === config.publicAppUrl + '/') {
        assert.equal(init.redirect, 'error');
        return new Response('<html>no secrets here</html>', {
          status: 200, headers: { 'content-type': 'text/html' },
        });
      }
      assert.equal(init.redirect, 'error');
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { 'content-type': 'application/json' },
      });
    };
    const [dataLeak, notesDenied, myNotesDenied, readDenied, writeDenied, noSecretKey]
      = await runAttackChecks(config);
    assert.deepEqual(requestUrls, [
      'https://student-defense.vercel.app/data.json',
      'https://student-defense.vercel.app/api/notes',
      'https://student-defense.vercel.app/api/my-notes',
      'https://test-project.supabase.co/rest/v1/t03_personal_notes?select=id',
      'https://test-project.supabase.co/rest/v1/t03_personal_notes',
      'https://student-defense.vercel.app/',
    ]);
    assert.match(dataLeak.observed, /보이지 않음/u);
    assert.match(notesDenied.observed, /거부됨/u);
    assert.match(myNotesDenied.observed, /거부됨/u);
    assert.match(readDenied.observed, /거부됨/u);
    assert.match(writeDenied.observed, /거부됨/u);
    assert.match(noSecretKey.observed, /발견되지 않음/u);

    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href.startsWith(config.originalApiUrl)) {
        return new Response(JSON.stringify([{ id: '1' }]), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (href === config.publicAppUrl + '/') {
        return new Response('<html>sb_secret_abcdefghijklmnop leaked here</html>', {
          status: 200, headers: { 'content-type': 'text/html' },
        });
      }
      return new Response(JSON.stringify({ notes: [] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };
    const [, , , readStillOpen, writeStillOpen, secretKeyLeaked] = await runAttackChecks(config);
    assert.match(readStillOpen.observed, /거부되지 않음/u);
    assert.match(writeStillOpen.observed, /거부되지 않음/u);
    assert.match(secretKeyLeaked.observed, /발견됨/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
