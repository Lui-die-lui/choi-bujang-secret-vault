// npm run xdr:run -- <모듈 이름> 으로 호출합니다. 지금은 brute-force 모듈만 있습니다.
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleName = process.argv[2];
if (!moduleName || !/^[a-z][a-z-]*$/u.test(moduleName)) {
  process.stderr.write('사용법: npm run xdr:run -- <모듈 이름> (예: brute-force)\n');
  process.exitCode = 1;
} else {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const targetUrl = pathToFileURL(resolve(moduleDir, moduleName, 'run.mjs'));
  try {
    const { run } = await import(targetUrl.href);
    await run();
  } catch (error) {
    process.stderr.write(`xdr ${moduleName} 실행 중 첫 오류: ${error.message}\n`);
    process.exitCode = 1;
  }
}
