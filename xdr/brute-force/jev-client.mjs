// Jev 연동 자리입니다. 현재 이 자료실에는 실제 Jev 주소·키 정보가 없습니다.
// JEV_ENDPOINT·JEV_API_KEY 환경변수가 없으면 네트워크 호출 없이 바로 null을 돌려주고,
// decide.mjs는 null을 "응답 실패"와 같이 취급해 alert로 떨어집니다.
// 값이 필요하면 학생이 Vercel/로컬 환경변수 화면에 직접 넣으세요 — 이 파일에 적지 마세요.
export async function askJev(context) {
  const endpoint = process.env.JEV_ENDPOINT;
  const apiKey = process.env.JEV_API_KEY;
  if (!endpoint || !apiKey) return null;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(context),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const confidence = body?.confidence;
    if (typeof confidence !== 'number' || Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
      return null;
    }
    return { confidence };
  } catch {
    return null;
  }
}
