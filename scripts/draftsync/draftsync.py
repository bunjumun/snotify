#!/usr/bin/env python3
"""
draftsync — watch a folder on this Mac and push new audio files into the
music player, landing them in a "Recently uploaded" folder to sort by hand.

CR-1. It does exactly what the site's own batch folder-upload does, just
unattended: PUT each file into the `inbox` storage bucket (band password in
the object path, same as the browser), POST `import-inbox` to register it as
a song + first mix, then file every new song into one music folder via
`create_music_folder` / `set_song_folder`.

Add-only by design: a file removed locally is never removed from the site.

Triggered by a launchd WatchPaths agent (see install.sh) — no polling, no
third-party dependency, stdlib only. Safe to run by hand too:  python3 draftsync.py

Config lives OUTSIDE the repo at ~/.snalbum-draftsync/config (chmod 600):

    BAND=dando
    BAND_PASS=your-band-password
    WATCH_DIR=/Users/bunj/Music/SnAlbum drafts
    # optional overrides:
    # FOLDER_NAME=Recently uploaded
    # MAX_MB=50
    # STABLE_SECONDS=10
"""

import hashlib
import json
import logging
import mimetypes
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HOME = Path.home()
CFG_DIR = HOME / ".snalbum-draftsync"
CFG_FILE = CFG_DIR / "config"
STATE_FILE = CFG_DIR / "state.json"
LOCK_FILE = CFG_DIR / "lock"
LOG_FILE = CFG_DIR / "draftsync.log"

# Public, ships in core.js — safe to hardcode as defaults.
SUPABASE_URL = "https://twgukeyoayfqldnojrkg.supabase.co"
SUPABASE_KEY = "sb_publishable_zIiAxxA5Zk1yRNzignANXA_rEp3vKdG"

AUDIO_RE = re.compile(r"\.(mp3|m4a|aac|ogg|opus|wav|aif|aiff|flac)$", re.I)
# Storage's key whitelist is narrower than a real title; this is the exact
# strip music.html applies to a song/version name before upload.
SANITISE_RE = re.compile(r"[^A-Za-z0-9_.\- ]+")

DEFAULTS = {
    "FOLDER_NAME": "Recently uploaded",
    "MAX_MB": "50",          # Supabase free-tier per-file ceiling, not adjustable
    "STABLE_SECONDS": "10",  # ignore a file whose mtime is younger than this (still bouncing)
    "SUPABASE_URL": SUPABASE_URL,
    "SUPABASE_KEY": SUPABASE_KEY,
}


def setup_logging() -> None:
    CFG_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(message)s",
        handlers=[logging.StreamHandler(sys.stdout),
                  logging.FileHandler(LOG_FILE)],
    )


def load_config() -> dict:
    if not CFG_FILE.exists():
        logging.error("no config at %s — see the header of this script", CFG_FILE)
        sys.exit(2)
    cfg = dict(DEFAULTS)
    for raw in CFG_FILE.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        cfg[key.strip()] = val.strip()
    missing = [k for k in ("BAND", "BAND_PASS", "WATCH_DIR") if not cfg.get(k)]
    if missing:
        logging.error("config is missing: %s", ", ".join(missing))
        sys.exit(2)
    cfg["WATCH_DIR"] = os.path.expanduser(cfg["WATCH_DIR"])
    if not Path(cfg["WATCH_DIR"]).is_dir():
        logging.error("WATCH_DIR does not exist: %s", cfg["WATCH_DIR"])
        sys.exit(2)
    return cfg


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {"files": {}, "folder_id": None}


def save_state(state: dict) -> None:
    tmp = STATE_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True))
    tmp.replace(STATE_FILE)


def acquire_lock():
    """Single instance. launchd can fire again while we run; that's fine, it
    re-fires on the next change too."""
    import fcntl
    fh = open(LOCK_FILE, "w")
    try:
        fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        logging.info("another run holds the lock — exiting")
        sys.exit(0)
    return fh  # keep the handle alive for the process lifetime


def sha1(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sanitise(name: str) -> str:
    return SANITISE_RE.sub("", name).strip()


def _request(url: str, *, data: bytes, headers: dict, method: str = "POST"):
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read().decode("utf-8", "replace")
            return resp.status, body
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except urllib.error.URLError as exc:
        return 0, str(exc)


def put_inbox(cfg: dict, song: str, filename: str, blob: bytes) -> None:
    band, pw = cfg["BAND"], cfg["BAND_PASS"]
    seg = "/".join(urllib.parse.quote(s, safe="") for s in (band, pw, song, filename))
    url = f'{cfg["SUPABASE_URL"]}/storage/v1/object/inbox/{seg}'
    ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    status, body = _request(url, data=blob, method="POST", headers={
        "apikey": cfg["SUPABASE_KEY"],
        "Authorization": "Bearer " + cfg["SUPABASE_KEY"],
        "Content-Type": ctype,
        "x-upsert": "true",
    })
    if status not in (200, 201):
        raise RuntimeError(f"inbox PUT {filename} -> {status}: {body[:300]}")


def call_json(cfg: dict, path: str, payload: dict):
    url = f'{cfg["SUPABASE_URL"]}{path}'
    status, body = _request(url, data=json.dumps(payload).encode(), method="POST", headers={
        "apikey": cfg["SUPABASE_KEY"],
        "Authorization": "Bearer " + cfg["SUPABASE_KEY"],
        "Content-Type": "application/json",
    })
    if status not in (200, 201, 204):
        raise RuntimeError(f"{path} -> {status}: {body[:300]}")
    try:
        return json.loads(body) if body else None
    except json.JSONDecodeError:
        return body


def import_inbox(cfg: dict, song: str) -> int:
    res = call_json(cfg, "/functions/v1/import-inbox",
                    {"band": cfg["BAND"], "pass": cfg["BAND_PASS"], "song": song})
    if isinstance(res, dict) and res.get("error"):
        raise RuntimeError(f"import-inbox {song}: {res['error']}")
    return (res or {}).get("imported", 0) if isinstance(res, dict) else 0


def ensure_folder(cfg: dict) -> str:
    return call_json(cfg, "/rest/v1/rpc/create_music_folder",
                     {"b": cfg["BAND"], "p": cfg["BAND_PASS"], "fname": cfg["FOLDER_NAME"]})


def file_into_folder(cfg: dict, song: str, fid: str) -> None:
    call_json(cfg, "/rest/v1/rpc/set_song_folder",
              {"b": cfg["BAND"], "p": cfg["BAND_PASS"], "f": song, "fid": fid})


def main() -> None:
    setup_logging()
    cfg = load_config()
    lock = acquire_lock()  # noqa: F841 — held for process lifetime
    state = load_state()
    files_state = state.setdefault("files", {})

    root = Path(cfg["WATCH_DIR"])
    max_bytes = int(cfg["MAX_MB"]) * 1024 * 1024
    stable = float(cfg["STABLE_SECONDS"])
    now = time.time()

    candidates = [p for p in root.rglob("*") if p.is_file() and AUDIO_RE.search(p.name)]
    new_songs = []   # (song, filename) filed this run
    touched_songs = set()

    for path in sorted(candidates):
        rel = str(path.relative_to(root))
        try:
            st = path.stat()
        except FileNotFoundError:
            continue

        if now - st.st_mtime < stable:
            logging.info("skip (still being written): %s", rel)
            continue

        prev = files_state.get(rel)
        if prev and prev.get("size") == st.st_size and prev.get("mtime") == int(st.st_mtime):
            continue  # unchanged since last time — cheap path, no hashing

        digest = sha1(path)
        if prev and prev.get("sha1") == digest:
            prev.update(size=st.st_size, mtime=int(st.st_mtime))  # touched but identical
            continue

        if st.st_size > max_bytes:
            if not (prev and prev.get("skipped")):
                logging.warning("SKIPPED (%d MB, over the %s MB ceiling): %s",
                                st.st_size // (1024 * 1024), cfg["MAX_MB"], rel)
            files_state[rel] = {"size": st.st_size, "mtime": int(st.st_mtime),
                                "sha1": digest, "skipped": True}
            continue

        song = sanitise(path.stem) or "untitled"
        ext = path.suffix.lower()
        upname = sanitise(path.stem) + ext
        try:
            logging.info("uploading: %s  ->  song “%s”", rel, song)
            put_inbox(cfg, song, upname, path.read_bytes())
        except Exception as exc:  # leave it out of state so it retries next fire
            logging.error("%s", exc)
            continue

        files_state[rel] = {"size": st.st_size, "mtime": int(st.st_mtime),
                            "sha1": digest, "song": song,
                            "uploaded_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        touched_songs.add(song)
        if not prev:
            new_songs.append(song)

    if not touched_songs:
        save_state(state)
        return

    imported_total = 0
    registered = set()
    for song in sorted(touched_songs):
        try:
            imported_total += import_inbox(cfg, song)
            registered.add(song)
        except Exception as exc:
            logging.error("%s", exc)

    # File the freshly-created songs into "Recently uploaded". Only ones new
    # this run — a song he has since dragged elsewhere is left where he put it.
    to_file = [s for s in new_songs if s in registered]
    if to_file:
        try:
            fid = ensure_folder(cfg)
            state["folder_id"] = fid
            for song in to_file:
                file_into_folder(cfg, song, fid)
            logging.info("filed %d new song(s) into “%s”", len(to_file), cfg["FOLDER_NAME"])
        except Exception as exc:
            logging.error("could not file into %s: %s", cfg["FOLDER_NAME"], exc)

    save_state(state)
    logging.info("done — %d file(s) up, %d mix(es) registered", len(touched_songs), imported_total)


if __name__ == "__main__":
    main()
