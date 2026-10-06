import { createClient } from '@supabase/supabase-js';
import { verifyRequestLogin } from '../../src/notes-auth.mjs';

const TABLE = 't03_personal_notes';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function serialize(row) {
  return { id: row.id, title: row.title, body: row.content };
}

// 3단계: 메모 한 건 조회·수정·삭제. 로그인 여부만 확인하고, 요청자가
// 이 메모의 소유자(owner_id)인지는 아직 확인하지 않습니다 — 그래서 로그인한
// 다른 사용자가 id를 알면 이 메모에 접근할 수 있습니다. 이 허점은 4단계에서
// 고칩니다(README 참고).
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

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  if (request.method === 'GET') {
    const { data, error } = await supabase.from(TABLE).select('id, title, content').eq('id', id).maybeSingle();
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
    const { data, error } = await supabase.from(TABLE).delete().eq('id', id).select('id').maybeSingle();
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
