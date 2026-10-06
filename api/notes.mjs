import { createClient } from '@supabase/supabase-js';

// 2단계: 가상 메모를 코드 밖(Supabase, t02_vault_notes)으로 옮기고
// 서버 전용 환경변수로만 읽습니다. 이 주소는 아직 로그인 없이 누구나 호출할 수
// 있다는 약점이 남아 있으며, 이는 README에 적어 둡니다(3단계 이후 과제).
export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'method_not_allowed' });
  }
  response.setHeader('Cache-Control', 'no-store');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecretKey) {
    console.error('notes API misconfigured: missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    return response.status(500).json({ error: 'server_not_configured' });
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const { data, error } = await supabase
    .from('t02_vault_notes')
    .select('title, content')
    .order('id', { ascending: true });

  if (error) {
    console.error('notes API read failed:', error.message);
    return response.status(500).json({ error: 'notes_read_failed' });
  }

  return response.status(200).json({ notes: data ?? [] });
}
