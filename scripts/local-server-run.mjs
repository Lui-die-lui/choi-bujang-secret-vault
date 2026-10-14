import { startLocalServer } from './local-server.mjs';

// npm run ops:serve — api/*.mjs를 로컬(127.0.0.1)에서 실행합니다. 중지는 Ctrl+C.
// 이 서버는 배포 플랫폼이 아니며, SUPABASE_URL·SUPABASE_SECRET_KEY 환경변수가 있어야 자료가 열립니다.
const { baseUrl } = await startLocalServer({ port: Number(process.env.PORT) || 3000 });
process.stdout.write(`로컬 API 서버: ${baseUrl} (중지: Ctrl+C)\n`);
