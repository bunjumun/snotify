#!/usr/bin/env node
// Build tracks.json from the tracks/ folder.
//
//   node generate-manifest.mjs
//
// Two conventions, mix freely:
//
//   tracks/Loose Song.mp3            -> a 1-version song
//   tracks/Midnight Drive/           -> a song whose VERSIONS are the files inside:
//       Rough Demo.mp3
//       Mix v2.mp3
//       Final Master.mp3             -> newest file is listed first = top of the stack
//
// Version order = most-recently-modified first (your latest mix goes on top).
// Reorder or rename freely by editing tracks.json afterward.
// Cover art: drop covers/<Song Name>.jpg, or cover.jpg inside the song folder.

import { readdirSync, writeFileSync, existsSync, statSync, readFileSync, utimesSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const AUDIO = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.aif', '.aiff', '.flac', '.webm']);
const IMAGE = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
// Lossless masters: auto-compressed to .m4a for hosting (see ensureCompressed)
// and gitignored, so exporting ONE wav from the DAW is the whole workflow.
const LOSSLESS = new Set(['.wav', '.aif', '.aiff', '.flac']);
const COLLECTION_TITLE = "S'notify";

const isAudio = (f) => AUDIO.has(extname(f).toLowerCase());
const isImage = (f) => IMAGE.includes(extname(f).toLowerCase());
const isLossless = (f) => LOSSLESS.has(extname(f).toLowerCase());

let transcodedCount = 0;

// Compress a lossless file to <base>.m4a (AAC ~256 kbps VBR — equal-or-better
// quality than MP3 320 at smaller size; macOS ships no MP3 encoder) using the
// built-in afconvert. Idempotent: skipped when an up-to-date .m4a exists. The
// .m4a inherits the source's mtime so version dates / stack order don't shift.
// Returns the compressed filename, or null if conversion failed.
const ensureCompressed = (dir, file) => {
  const base = basename(file, extname(file));
  const out = base + '.m4a';
  const src = join(dir, file), dst = join(dir, out);
  const srcStat = statSync(src);
  if (existsSync(dst) && statSync(dst).mtimeMs >= srcStat.mtimeMs) return out;
  try {
    execFileSync('afconvert',
      ['-f', 'm4af', '-d', 'aac', '-s', '3', '-ue', 'vbrq', '127', '-q', '127', src, dst],
      { stdio: 'pipe' });
    utimesSync(dst, srcStat.atime, srcStat.mtime);
    const mb = (n) => (n / 1048576).toFixed(1);
    console.log(`  ♪ ${file} → ${out}  (${mb(srcStat.size)} MB → ${mb(statSync(dst).size)} MB)`);
    transcodedCount++;
    return out;
  } catch {
    console.warn(`  ! afconvert failed on ${file} — using the original file`);
    return null;
  }
};

// From a folder's audio files, pick one file per version base name:
// compressed formats win; lossless files are transcoded (or kept as-is if
// conversion fails). Returns filenames sorted newest-first.
const pickVersionFiles = (dir, files) => {
  const audio = files.filter(isAudio);
  const chosen = new Map(); // base name -> filename
  for (const f of audio.filter((f) => !isLossless(f)))
    chosen.set(basename(f, extname(f)), f);
  for (const f of audio.filter(isLossless)) {
    const b = basename(f, extname(f));
    if (chosen.has(b)) continue;           // compressed twin already there
    chosen.set(b, ensureCompressed(dir, f) || f);
  }
  return [...chosen.values()]
    .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
    .map((x) => x.f);
};
const tidy = (s) => s.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
const dateOf = (p) => statSync(p).mtime.toISOString().slice(0, 10);

// Changelog sidecars: for an audio file <base>.<ext>, a sibling
// <base>.changelog.md becomes the version's editable change note, and an
// optional <base>.changes.json (array of strings) becomes structured bullets.
// These are written by the DAW-assistant bridge on "Save version" — or by hand.
const attachChangelog = (version, dir, base) => {
  const md = join(dir, base + '.changelog.md');
  if (existsSync(md)) {
    const text = readFileSync(md, 'utf8').trim();
    if (text) version.changelog = text;
  }
  const cj = join(dir, base + '.changes.json');
  if (existsSync(cj)) {
    try {
      const arr = JSON.parse(readFileSync(cj, 'utf8'));
      if (Array.isArray(arr) && arr.length) version.changes = arr.map(String);
    } catch { /* malformed json — skip, changelog.md still applies */ }
  }
  return version;
};

const covers = existsSync('covers') ? readdirSync('covers') : [];
const findCover = (base, folderFiles, folderPath) => {
  // 1) cover.* inside the song folder
  if (folderFiles) {
    const inFolder = folderFiles.find(f => isImage(f) && basename(f, extname(f)).toLowerCase() === 'cover');
    if (inFolder) return `${folderPath}/${inFolder}`;
  }
  // 2) covers/<base>.*
  for (const ext of IMAGE) {
    const hit = covers.find(c => c.toLowerCase() === (base + ext).toLowerCase());
    if (hit) return `covers/${hit}`;
  }
  return undefined;
};

if (!existsSync('tracks')) { writeFileSync('tracks.json', JSON.stringify({ title: COLLECTION_TITLE, songs: [] }, null, 2) + '\n'); console.log('No tracks/ folder — wrote empty manifest.'); process.exit(0); }

const entries = readdirSync('tracks', { withFileTypes: true });
const songs = [];

// Folders: a folder = a song; its audio files = versions.
for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
  if (ent.name.startsWith('.') || !ent.isDirectory()) continue;
  const dir = join('tracks', ent.name);
  const files = readdirSync(dir);
  const audio = pickVersionFiles(dir, files);   // newest first = top of stack
  if (!audio.length) continue;
  const versions = audio.map(f => {
    const base = basename(f, extname(f));
    return attachChangelog({
      name: tidy(base),
      src: `tracks/${ent.name}/${f}`,
      date: dateOf(join(dir, f)),
    }, dir, base);
  });
  const song = { title: tidy(ent.name), versions };
  const cover = findCover(ent.name, files, `tracks/${ent.name}`);
  if (cover) song.cover = cover;
  songs.push(song);
}

// Loose files in tracks/: each is a 1-version song; "Artist - Title" splits.
const rootFiles = entries
  .filter(e => !e.isDirectory() && !e.name.startsWith('.'))
  .map(e => e.name);
for (const file of pickVersionFiles('tracks', rootFiles).sort((a, b) => a.localeCompare(b))) {
  const base = basename(file, extname(file));
  let title = tidy(base), artist;
  const m = base.match(/^(.+?)\s*[-–]\s*(.+)$/);
  if (m) { artist = tidy(m[1]); title = tidy(m[2]); }
  const song = { title, versions: [attachChangelog(
    { name: 'Original', src: `tracks/${file}`, date: dateOf(join('tracks', file)) },
    'tracks', base,
  )] };
  if (artist) song.artist = artist;
  const cover = findCover(base);
  if (cover) song.cover = cover;
  songs.push(song);
}

writeFileSync('tracks.json', JSON.stringify({ title: COLLECTION_TITLE, songs }, null, 2) + '\n');
const vCount = songs.reduce((n, s) => n + s.versions.length, 0);
const enc = transcodedCount ? `, ${transcodedCount} file${transcodedCount===1?'':'s'} compressed to AAC` : '';
console.log(`Wrote tracks.json: ${songs.length} song${songs.length===1?'':'s'}, ${vCount} version${vCount===1?'':'s'}${enc}.`);
if (!songs.length) console.log('(No audio found in tracks/ — add some files and run again.)');
