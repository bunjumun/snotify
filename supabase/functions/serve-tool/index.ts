// serve-tool — re-serves an admin-uploaded tool file (CR-99) out of the
// 'tracks' bucket with its real Content-Type and no lockdown headers.
//
// Supabase Storage's public object endpoint deliberately serves any object
// whose stored mimetype is HTML/SVG/XML as `text/plain`, wrapped in
// `Content-Security-Policy: default-src 'none'; sandbox` — a stored-XSS
// guard so an arbitrary upload can never execute on the storage origin.
// Right instinct for band media, wrong one for CR-99: a tool page is
// *meant* to run, and that guard is why an uploaded tool opened as raw
// source instead of launching (confirmed live, colsep.html, 26 Aug).
//
// This function fetches the same object with the service role, which
// bypasses that public-CDN transform entirely, and re-serves the bytes
// under their real type. No password: a tool page has never been gated
// once uploaded, only the Add step is (admin_login, checked at upload —
// see import-inbox's 'tool' kind), so this matches the access level the
// plain public URL already had.
//
// GET /serve-tool/<band>/_tools/<file> — the path is exactly a tool's
// `ref` as import-inbox hands it back, so the client needs no separate
// URL-building logic beyond swapping which base it points at.
// Deploy: supabase functions deploy serve-tool --no-verify-jwt

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.gif': 'image/gif', '.webp': 'image/webp',
  '.wasm': 'application/wasm',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('GET only', { status: 405, headers: CORS });
  }

  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const i = parts.indexOf('serve-tool');
  const rest = i >= 0 ? parts.slice(i + 1) : []; // <band>/_tools/<file...>
  if (rest.length < 3 || rest[1] !== '_tools') {
    return new Response('expected /serve-tool/<band>/_tools/<file>', { status: 400, headers: CORS });
  }
  const file = rest[rest.length - 1];
  const ext = (file.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
  const objectPath = rest.map(encodeURIComponent).join('/');

  const obj = await fetch(`${SUPA_URL}/storage/v1/object/tracks/${objectPath}`, {
    headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE },
  });
  if (!obj.ok) return new Response('not found', { status: 404, headers: CORS });

  return new Response(obj.body, {
    headers: {
      ...CORS,
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});
