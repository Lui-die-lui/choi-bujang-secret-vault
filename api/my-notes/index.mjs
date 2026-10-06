import { createClient } from '@supabase/supabase-js';
import { verifyRequestLogin } from '../../src/notes-auth.mjs';

const TABLE = 't03_personal_notes';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function serialize(row) {
  return { id: row.id, title: row.title, body: row.content };
}

// 3단계: 로그인한 사용자 본인의 가상 메모 목록 조회·추가.
// 서버가 검증한 사용자 ID만 owner_id로 저장합니다(요청 본문의 값은 무시).
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

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
      .eq('owner_id', identity.userId)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('my-notes list failed:', error.message);
      return response.status(500).json({ error: 'notes_read_failed' });
    }
    return response.status(200).json({ notes: (data ?? []).map(serialize) });
  }

  if (request.method === 'POST') {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const { id, title, body: content } = body;
    if (typeof title !== 'string' || !title.trim() || typeof content !== 'string') {
      return response.status(400).json({ error: 'invalid_body' });
    }
    if (id !== undefined && (typeof id !== 'string' || !UUID.test(id))) {
      return response.status(400).json({ error: 'invalid_id' });
    }
    const insertRow = { owner_id: identity.userId, title, content };
    if (id) insertRow.id = id;

    const { data, error } = await supabase
      .from(TABLE)
      .insert(insertRow)
      .select('id')
      .single();
    if (error) {
      console.error('my-notes create failed:', error.message);
      return response.status(500).json({ error: 'notes_write_failed' });
    }
    return response.status(201).json({ id: data.id });
  }

  response.setHeader('Allow', 'GET, POST');
  return response.status(405).json({ error: 'method_not_allowed' });
}
