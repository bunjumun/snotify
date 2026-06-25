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

import { readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const AUDIO = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac', '.webm']);
const IMAGE = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const COLLECTION_TITLE = "S'notify";

const isAudio = (f) => AUDIO.has(extname(f).toLowerCase());
const isImage = (f) => IMAGE.includes(extname(f).toLowerCase());
const tidy = (s) => s.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
const dateOf = (p) => statSync(p).mtime.toISOString().slice(0, 10);

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

for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
  if (ent.name.startsWith('.')) continue;

  if (ent.isDirectory()) {
    // a folder = a song; its audio files = versions
    const dir = join('tracks', ent.name);
    const files = readdirSync(dir);
    const audio = files.filter(isAudio)
      .map(f => ({ f, m: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)               // newest first = top of stack
      .map(x => x.f);
    if (!audio.length) continue;
    const versions = audio.map(f => ({
      name: tidy(basename(f, extname(f))),
      src: `tracks/${ent.name}/${f}`,
      date: dateOf(join(dir, f)),
    }));
    const song = { title: tidy(ent.name), versions };
    const cover = findCover(ent.name, files, `tracks/${ent.name}`);
    if (cover) song.cover = cover;
    songs.push(song);

  } else if (isAudio(ent.name)) {
    // a loose file = a 1-version song; "Artist - Title" splits artist/title
    const base = basename(ent.name, extname(ent.name));
    let title = tidy(base), artist;
    const m = base.match(/^(.+?)\s*[-–]\s*(.+)$/);
    if (m) { artist = tidy(m[1]); title = tidy(m[2]); }
    const song = { title, versions: [{ name: 'Original', src: `tracks/${ent.name}`, date: dateOf(join('tracks', ent.name)) }] };
    if (artist) song.artist = artist;
    const cover = findCover(base);
    if (cover) song.cover = cover;
    songs.push(song);
  }
}

writeFileSync('tracks.json', JSON.stringify({ title: COLLECTION_TITLE, songs }, null, 2) + '\n');
const vCount = songs.reduce((n, s) => n + s.versions.length, 0);
console.log(`Wrote tracks.json: ${songs.length} song${songs.length===1?'':'s'}, ${vCount} version${vCount===1?'':'s'}.`);
if (!songs.length) console.log('(No audio found in tracks/ — add some files and run again.)');
