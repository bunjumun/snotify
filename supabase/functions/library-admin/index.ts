// library-admin — the only operations that must remove storage objects, so
// they can't be plain SQL RPCs. Password-checked, service-role storage access.
// Deploy with:  supabase functions deploy library-admin --no-verify-jwt
//
// Request:  POST { band, pass, action: 'delete_song_forever',    song }
//           POST { band, pass, action: 'delete_version_forever', song, name }
// Response: { ok: true }  |  { error }

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });

async function api(path: string, opts: RequestInit = {}): Promise<Response> {
  const r = await fetch(SUPA_URL + path, {
    ...opts,
    headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE,
               ...(opts.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}: ${await r.text()}`);
  return r;
}

async function removeObjects(paths: string[]) {
  if (!paths.length) return;
  await api('/storage/v1/object/tracks', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: paths }),
  }).catch(() => { /* object may already be gone — rows are the truth */ });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const { band, pass, action, song, name } = await req.json();
    if (!band || !pass || !action || !song) return json({ error: 'missing fields' }, 400);

    const okRes = await api('/rest/v1/rpc/band_pass_ok', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ b: band, p: pass }),
    });
    if ((await okRes.json()) !== true) return json({ error: 'wrong band password' }, 403);
    const b = String(band).toLowerCase();

    const q = `band=eq.${encodeURIComponent(b)}&folder=eq.${encodeURIComponent(song)}`;
    const rows = await (await api(`/rest/v1/songs?${q}&select=id,cover`)).json();
    if (!rows.length) return json({ error: 'song not found' }, 404);
    const { id: songId, cover } = rows[0];

    if (action === 'delete_song_forever') {
      const vs = await (await api(`/rest/v1/versions?song_id=eq.${songId}&select=src`)).json();
      const paths = vs.map((v: { src: string }) => v.src);
      if (cover && !/^https?:/.test(cover)) paths.push(cover);
      await removeObjects(paths);
      await api(`/rest/v1/songs?id=eq.${songId}`, { method: 'DELETE' }); // versions cascade
    } else if (action === 'delete_version_forever') {
      if (!name) return json({ error: 'name required' }, 400);
      const vq = `song_id=eq.${songId}&name=eq.${encodeURIComponent(name)}`;
      const vs = await (await api(`/rest/v1/versions?${vq}&select=id,src`)).json();
      if (!vs.length) return json({ error: 'version not found' }, 404);
      await removeObjects([vs[0].src]);
      await api(`/rest/v1/versions?id=eq.${vs[0].id}`, { method: 'DELETE' });
    } else {
      return json({ error: 'unknown action' }, 400);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
