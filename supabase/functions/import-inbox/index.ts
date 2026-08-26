// import-inbox — moves a band's fresh inbox uploads into the permanent
// 'tracks' bucket and registers them in the songs/versions tables.
// Called by the site right after an upload (replaces the studio Mac's
// 60-second polling importer). Deploy with:
//   supabase functions deploy import-inbox --no-verify-jwt
//
// Request:  POST { band, pass, song, kind? }
//   kind: 'audio' (default) | 'art' | 'ref' | 'img' | 'tool'
// Response: { ok: true, imported: n }  |  { ok: true, ref: '<path>' }  |  { error }
//
// 'art' is S'nart: the same import, pointed at images. A revision of a piece
// of art stacks exactly like a new mix of a song — same songs/versions rows,
// distinguished only by songs.kind — so the only thing that varies here is
// which file extensions count and what MIME type they go up as.
//
// 'ref', 'img' and 'tool' are PASSTHROUGH kinds: move one file into permanent
// storage, hand the path back, write no rows at all. Same code, differing
// only in what they will accept and where it lands:
//
//   ref    audio   <band>/<song>/_ref/<file>   what a mix was chasing
//   img    images  <band>/<song>/_img/<file>   a picture with no song of its own
//   tool   any     <band>/_tools/<file>        an admin's own tool page (CR-99)
//
// 'img' exists for share-link thumbnails (CR-21), which are the first image on
// this site that belongs to no piece and no song. It is called with the
// reserved folder '_shares', giving <band>/_shares/_img/<file>. It could not
// reuse 'ref' because 'ref' filters on AUDIO_RE and would reject every picture,
// and it must not reuse 'art' because 'art' creates a songs row and the
// thumbnail would appear in Sn'art as a piece nobody made.
//
// 'tool' exists so the Tools menu's "Add" form can take a file instead of only
// a link (CR-99): most of Lakehorse's own tools are one HTML file with no home
// on the web yet. Called with the reserved folder '_tools', so every uploaded
// tool for a band lands flat at <band>/_tools/<file> with no per-song nesting.
// Unlike 'ref'/'img' it applies no extension filter — a tool page can arrive
// with a companion .js or .css, and rejecting those would silently break it.

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AUDIO_RE = /\.(mp3|m4a|aac|ogg|opus|wav|aif|aiff|flac)$/i;
const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif|tiff?|bmp|heic)$/i;
const MIME: Record<string, string> = {
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.wav': 'audio/wav',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.tif': 'image/tiff', '.tiff': 'image/tiff', '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.html': 'text/html', '.htm': 'text/html',
  '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
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
    const { band, pass, song, kind } = await req.json();
    if (!band || !pass || !song) return json({ error: 'band, pass, song required' }, 400);
    const k = kind === 'art' ? 'art' : kind === 'ref' ? 'ref'
            : kind === 'img' ? 'img' : kind === 'tool' ? 'tool' : 'audio';
    // 'tool' takes anything — a tool page can ship with a companion .js/.css
    // and rejecting those on extension would silently break the upload.
    const MEDIA_RE = k === 'tool' ? /./ : (k === 'art' || k === 'img') ? IMAGE_RE : AUDIO_RE;

    // A reference is not a version of anything: it is the track this song is
    // chasing. Move the one file into the permanent bucket under the song's
    // own _ref/ folder and hand the path back — no songs or versions rows.
    // 'img' is the same move for a picture that belongs to no song at all,
    // 'tool' the same again for an admin's own tool page.
    if (k === 'ref' || k === 'img' || k === 'tool') {
      // The Tools menu is a SITE-ADMIN feature, gated by the site admin
      // password (admin_login), not any one band's password — a tool can be
      // uploaded under 'tools.custom' (every band) with no band logged in at
      // all. 'ref'/'img' stay on band_pass_ok as before.
      if (k === 'tool') {
        const okAdmin = await api('/rest/v1/rpc/admin_login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass }),
        });
        if ((await okAdmin.json()) !== true) return json({ error: 'wrong admin password' }, 403);
      } else {
        const okRef = await api('/rest/v1/rpc/band_pass_ok', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ b: band, p: pass }),
        });
        if ((await okRef.json()) !== true) return json({ error: 'wrong band password' }, 403);
      }
      const bb = String(band).toLowerCase();
      const listed = await api('/storage/v1/object/list/inbox', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: `${bb}/${pass}/${song}`, limit: 20 }),
      });
      const names = ((await listed.json()) as { name: string }[])
        .map((e) => e.name).filter((n) => n && !n.endsWith('/') && MEDIA_RE.test(n));
      if (!names.length) {
        return json({ error: k === 'img' ? 'no image found to use as a picture'
                            : k === 'tool' ? 'no file found to use as a tool'
                                           : 'no audio found to use as a reference' }, 400);
      }
      const file = names[0];
      const from = `${bb}/${pass}/${song}/${file}`;
      // 'tool' has no per-song nesting: song is already the reserved '_tools'
      // folder, so the destination is just <band>/_tools/<file>.
      const to = k === 'tool' ? `${bb}/${song}/${file}`
               : `${bb}/${song}/${k === 'img' ? '_img' : '_ref'}/${file}`;
      const ext = (file.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
      try {
        await api('/storage/v1/object/move', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucketId: 'inbox', sourceKey: from,
                                 destinationBucket: 'tracks', destinationKey: to }),
        });
      } catch {
        // storage-api without cross-bucket move, same fallback the mixes use
        const blob = await (await api('/storage/v1/object/inbox/' + enc(from))).blob();
        await api('/storage/v1/object/tracks/' + enc(to), {
          method: 'POST', body: blob,
          headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream',
                     'x-upsert': 'true', 'cache-control': 'max-age=31536000' },
        });
        await api('/storage/v1/object/inbox/' + enc(from), { method: 'DELETE' });
      }
      return json({ ok: true, ref: to, name: file.replace(/\.[^.]+$/, '') });
    }

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
    const media = files.filter((n) => MEDIA_RE.test(n));
    const sidecars = files.filter((n) => n.endsWith('.changelog.md'));
    if (!media.length && !sidecars.length) return json({ ok: true, imported: 0 });

    // changelogs by version base name — read them, then delete from the inbox
    const changelogs = new Map<string, string>();
    for (const f of sidecars) {
      const obj = `${b}/${pass}/${song}/${f}`;
      const body = await (await api('/storage/v1/object/inbox/' + enc(obj))).text();
      changelogs.set(f.replace(/\.changelog\.md$/, ''), body.trim());
      await api('/storage/v1/object/inbox/' + enc(obj), { method: 'DELETE' });
    }

    // ensure the song/artwork row (new ones land at the top of the library).
    // ensure_song is service-role-only and owns the slug + position logic, so
    // both kinds get an identical row shape.
    const songId: string = await (await api('/rest/v1/rpc/ensure_song', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ b, f: song, k }),
    })).json();

    let imported = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const f of media) {
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
