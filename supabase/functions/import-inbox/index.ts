// import-inbox — moves a band's fresh inbox uploads into the permanent
// 'tracks' bucket and registers them in the songs/versions tables.
// Called by the site right after an upload (replaces the studio Mac's
// 60-second polling importer). Deploy with:
//   supabase functions deploy import-inbox --no-verify-jwt
//
// Request:  POST { band, pass, song }
// Response: { ok: true, imported: n }  |  { error }

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AUDIO_RE = /\.(mp3|m4a|aac|ogg|opus|wav|aif|aiff|flac)$/i;
const MIME: Record<string, string> = {
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.wav': 'audio/wav',
};

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
const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const { band, pass, song } = await req.json();
    if (!band || !pass || !song) return json({ error: 'band, pass, song required' }, 400);

    const okRes = await api('/rest/v1/rpc/band_pass_ok', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ b: band, p: pass }),
    });
    if ((await okRes.json()) !== true) return json({ error: 'wrong band password' }, 403);
    const b = String(band).toLowerCase();

    // list this song's folder in the inbox
    const listRes = await api('/storage/v1/object/list/inbox', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: `${b}/${pass}/${song}`, limit: 1000 }),
    });
    const entries: { name: string }[] = await listRes.json();
    const files = entries.map((e) => e.name).filter((n) => n && !n.endsWith('/'));
    const audio = files.filter((n) => AUDIO_RE.test(n));
    const sidecars = files.filter((n) => n.endsWith('.changelog.md'));
    if (!audio.length && !sidecars.length) return json({ ok: true, imported: 0 });

    // changelogs by version base name — read them, then delete from the inbox
    const changelogs = new Map<string, string>();
    for (const f of sidecars) {
      const obj = `${b}/${pass}/${song}/${f}`;
      const body = await (await api('/storage/v1/object/inbox/' + enc(obj))).text();
      changelogs.set(f.replace(/\.changelog\.md$/, ''), body.trim());
      await api('/storage/v1/object/inbox/' + enc(obj), { method: 'DELETE' });
    }

    // ensure the song row (new songs land at the top of the library)
    const q = `band=eq.${encodeURIComponent(b)}&folder=eq.${encodeURIComponent(song)}`;
    let rows = await (await api(`/rest/v1/songs?${q}&select=id`)).json();
    if (!rows.length) {
      const key = String(song).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const minRes = await api(
        `/rest/v1/songs?band=eq.${encodeURIComponent(b)}&select=position&order=position.asc&limit=1`);
      const minRows = await minRes.json();
      const top = minRows.length ? minRows[0].position - 1 : 0;
      rows = await (await api('/rest/v1/songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ band: b, folder: song, title: song,
                               comment_key: key || 'song', position: top }),
      })).json();
    }
    const songId = rows[0].id;

    let imported = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const f of audio) {
      const srcObj = `${b}/${pass}/${song}/${f}`;
      const ext = (f.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
      const verName = f.replace(/\.[^.]+$/, '');

      // move inbox → tracks; on a name collision add " (n)"
      let destName = f, n = 1;
      for (;;) {
        try {
          await api('/storage/v1/object/move', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bucketId: 'inbox', sourceKey: srcObj,
              destinationBucket: 'tracks', destinationKey: `${b}/${song}/${destName}` }),
          });
          break;
        } catch (e) {
          const msg = String(e);
          if (/exists|duplicate|409/i.test(msg) && n < 20) {
            n += 1; destName = `${verName} (${n})${ext}`;
          } else if (n === 1 && /destination/i.test(msg)) {
            // storage-api without cross-bucket move: download + upload + delete
            const blob = await (await api('/storage/v1/object/inbox/' + enc(srcObj))).blob();
            await api('/storage/v1/object/tracks/' + enc(`${b}/${song}/${destName}`), {
              method: 'POST', body: blob,
              headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream',
                         'x-upsert': 'true', 'cache-control': 'max-age=31536000' },
            });
            await api('/storage/v1/object/inbox/' + enc(srcObj), { method: 'DELETE' });
            break;
          } else throw e;
        }
      }

      // re-uploading a version with the same name replaces it (bridge semantics)
      await api(`/rest/v1/versions?song_id=eq.${songId}&name=eq.${encodeURIComponent(verName)}`,
        { method: 'DELETE' });
      // make room at the top of the stack (service-role-only helper RPC)
      await api('/rest/v1/rpc/shift_versions_down', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid: songId }),
      });
      await api('/rest/v1/versions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ song_id: songId, name: verName,
          src: `${b}/${song}/${destName}`, date: today,
          changelog: changelogs.get(verName) ?? '', position: 0 }),
      });
      imported += 1;
    }

    return json({ ok: true, imported });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
