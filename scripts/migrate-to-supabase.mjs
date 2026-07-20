#!/usr/bin/env node
// One-time migration: tracks.json + projects.json + tracks/ audio → Supabase.
// Idempotent (upserts everywhere) — safe to re-run.
//
// Usage (service key never on the command line — read from the bridge config):
//   SUPABASE_SERVICE_KEY="$(python3 -c 'import json;print(json.load(open("/Users/bunj/claude/daw assistant/bridge/.supabase.json"))["service_key"])')" \
//     node scripts/migrate-to-supabase.mjs

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUPA_URL = 'https://twgukeyoayfqldnojrkg.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error('Set SUPABASE_SERVICE_KEY'); process.exit(1); }

// byte-identical to index.html's slug() — comments keep matching
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const filename = (p) => decodeURIComponent(p.split('/').pop().replace(/\.[^.]+$/, ''));

const MIME = { '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp' };

async function api(pathname, opts = {}) {
  const r = await fetch(SUPA_URL + pathname, {
    ...opts,
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`${opts.method || 'GET'} ${pathname} → ${r.status}: ${await r.text()}`);
  return r;
}

async function uploadObject(bucketPath, localFile) {
  const ext = path.extname(localFile).toLowerCase();
  const body = await readFile(localFile);
  await api('/storage/v1/object/tracks/' + bucketPath.split('/').map(encodeURIComponent).join('/'), {
    method: 'POST', body,
    headers: {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'x-upsert': 'true',
      // version files are immutable — let the CDN keep them for a year
      'cache-control': 'max-age=31536000',
    },
  });
  return body.length;
}

const tracks = JSON.parse(await readFile(path.join(ROOT, 'tracks.json'), 'utf8'));
const projects = JSON.parse(await readFile(path.join(ROOT, 'projects.json'), 'utf8')).projects || [];

let nSongs = 0, nVers = 0, nBytes = 0;
const publicUrls = [];

for (const band of tracks.bands || []) {
  // band title
  await api(`/rest/v1/bands?slug=eq.${encodeURIComponent(band.slug)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: band.title || band.slug }),
  });

  for (const [si, song] of (band.songs || []).entries()) {
    const folder = song.folder || song.title;
    const commentKey = song.id || slug(song.title || filename(song.versions[0].src)) || 'song-' + si;

    // cover
    let cover = song.cover || null;
    if (cover && !/^https?:/.test(cover)) {
      const local = path.join(ROOT, cover);
      const dest = cover.replace(/^tracks\//, '');
      try { await stat(local); nBytes += await uploadObject(dest, local); cover = dest; }
      catch { console.warn(`  ! cover missing on disk: ${cover}`); cover = null; }
    }

    const sres = await api(`/rest/v1/songs?on_conflict=band,folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
                 Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ band: band.slug, folder, title: song.title || folder,
        artist: song.artist || '', album: song.album || null, cover,
        comment_key: commentKey, position: si }),
    });
    const songId = (await sres.json())[0].id;
    nSongs++;

    for (const [vi, v] of (song.versions || []).entries()) {
      const bucketPath = v.src.replace(/^tracks\//, '');   // <band>/<folder>/<file>
      const local = path.join(ROOT, v.src);
      try { await stat(local); }
      catch { console.warn(`  ! audio missing on disk, skipping: ${v.src}`); continue; }
      process.stdout.write(`  ↑ ${bucketPath} … `);
      nBytes += await uploadObject(bucketPath, local);
      console.log('ok');
      publicUrls.push(`${SUPA_URL}/storage/v1/object/public/tracks/` +
        bucketPath.split('/').map(encodeURIComponent).join('/'));

      await api(`/rest/v1/versions?on_conflict=song_id,name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ song_id: songId, name: v.name || 'Version', src: bucketPath,
          date: v.date || null, changelog: v.changelog || '',
          changes: Array.isArray(v.changes) ? v.changes : null, position: vi }),
      });
      nVers++;
    }
  }
}

for (const pr of projects) {
  await api(`/rest/v1/projects?on_conflict=slug`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ slug: pr.slug, band: pr.band || 'lakehorse',
      name: pr.name, songs: pr.songs || [], created: pr.created || null }),
  });
}
console.log(`Projects upserted: ${projects.length}`);

// ---- verify -----------------------------------------------------------------
console.log(`\nMigrated: ${nSongs} songs, ${nVers} versions, ${(nBytes / 1048576).toFixed(1)} MB uploaded`);

for (const u of publicUrls) {
  const r = await fetch(u, { method: 'HEAD' });
  const ranges = r.headers.get('accept-ranges');
  console.log(`  HEAD ${r.status} ranges=${ranges} ${decodeURIComponent(u.split('/').pop())}`);
  if (!r.ok) process.exitCode = 1;
}

// smoke-test: band passwords are hashed (schema-v5), so there's no plaintext
// left to call get_library with — the service key bypasses RLS instead,
// reading songs/versions straight from the tables.
const bandsRows = await (await api('/rest/v1/bands?select=slug')).json();
for (const b of bandsRows) {
  const songs = await (await api(
    `/rest/v1/songs?band=eq.${encodeURIComponent(b.slug)}&trashed_at=is.null&select=title,id`
  )).json();
  const counts = await Promise.all(songs.map(async (s) => {
    const vs = await (await api(
      `/rest/v1/versions?song_id=eq.${s.id}&trashed_at=is.null&select=id`
    )).json();
    return vs.length;
  }));
  console.log(`  ${b.slug}: ${songs.length} songs — ` +
    songs.map((s, i) => `${s.title}(${counts[i]}v)`).join(', '));
}
console.log('\nDone.');
