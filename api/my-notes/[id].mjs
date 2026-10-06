import { createClient } from '@supabase/supabase-js';
import { verifyRequestLogin } from '../../src/notes-auth.mjs';

const TABLE = 't03_personal_notes';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function serialize(row) {
  return { id: row.id, title: row.title, body: row.content };
}

// 3단계: 메모 한 건 조회·수정·삭제.
// 4단계: id 조건과 함께 owner_id = 서버가 검증한 사용자 ID 조건을 쿼리에
// 같이 넣습니다. 남의 메모는 쿼리 결과가 아예 없으므로 "없는 메모"와 구분
// 없이 404로 거부합니다(존재 여부를 알려주지 않음). 요청 본문의 owner_id는
// 애초에 읽지 않으므로 소유자 변경 자체가 불가능합니다.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  const { id } = request.query;
  if (typeof id !== 'string' || !UUID.test(id)) {
    return response.status(400).json({ error: 'invalid_id' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecretKey) {
    console.error('my-notes API misconfigured: missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    return response.status(500).json({ error: 'server_not_configured' });
  }

  const auth = await verifyRequestLogin(request, supabaseSecretKey);
  if (!auth.ok) return response.status(auth.status).json(auth.body);
  const { identity } = auth;

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  if (request.method === 'GET') {
    const { data, error } = await supabase
      .from(TABLE)
      .select('id, title, content')
      .eq('id', id)
      .eq('owner_id', identity.userId)
      .maybeSingle();
    if (error) {
      console.error('my-notes read failed:', error.message);
      return response.status(500).json({ error: 'notes_read_failed' });
    }
    if (!data) return response.status(404).json({ error: 'not_found' });
    return response.status(200).json(serialize(data));
  }

  if (request.method === 'PUT') {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const { title, body: content } = body;
    if (typeof title !== 'string' || !title.trim() || typeof content !== 'string') {
      return response.status(400).json({ error: 'invalid_body' });
    }
    const { data, error } = await supabase
      .from(TABLE)
      .update({ title, content })
      .eq('id', id)
      .eq('owner_id', identity.userId)
      .select('id, title, content')
      .maybeSingle();
    if (error) {
      console.error('my-notes update failed:', error.message);
      return response.status(500).json({ error: 'notes_write_failed' });
    }
    if (!data) return response.status(404).json({ error: 'not_found' });
    return response.status(200).json(serialize(data));
  }

  if (request.method === 'DELETE') {
    const { data, error } = await supabase
      .from(TABLE)
      .delete()
      .eq('id', id)
      .eq('owner_id', identity.userId)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('my-notes delete failed:', error.message);
      return response.status(500).json({ error: 'notes_write_failed' });
    }
    if (!data) return response.status(404).json({ error: 'not_found' });
    return response.status(204).end();
  }

  response.setHeader('Allow', 'GET, PUT, DELETE');
  return response.status(405).json({ error: 'method_not_allowed' });
}
