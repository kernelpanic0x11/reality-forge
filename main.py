"""Reality Forge entry point: starts every local service with one command.

    python3 main.py

Today there is one service, the web app. Add new ones to SERVICES and they
start and stop together. Everything binds to localhost only.

The app posts its session log (text events) to /log, and it is appended to
logs/run-<time>.jsonl. logs/latest.jsonl points at the current run. Clicking
Snapshot in the app saves one still frame to logs/, and Save clip saves a
short audio clip to assets/clips/, and Record saves a video to recordings/.
Nothing else stores images, audio or video.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote
import posixpath
import shutil
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parent
HOST = '127.0.0.1'

LOG_DIR = ROOT / 'logs'
LOG_FILE = LOG_DIR / time.strftime('run-%Y%m%d-%H%M%S.jsonl')
LOG_LOCK = threading.Lock()
MAX_LOG_POST = 1_000_000  # bytes per request
MAX_SNAPSHOT_POST = 8_000_000
MAX_CLIP_POST = 40_000_000
MAX_RECORDING_POST = 4_000_000_000
RECORDING_DIR = ROOT / 'recordings'
CLIP_DIR = ROOT / 'assets' / 'clips'
SNAPSHOT_NAMES = {'camera', 'screen'}
KEEP_LOG_RUNS = 30


def finish_for_instagram(raw):
    """Re-encode a browser recording into a standard Instagram Reel file.

    Browsers write a variable frame rate and their own audio rate. This makes
    it a constant 30 frames a second, H.264 in the standard colour format, AAC
    at 48 kHz, with the index at the front. Returns the finished file, or the
    raw one unchanged if ffmpeg is missing or fails.
    """
    ffmpeg = shutil.which('ffmpeg') or next((p for p in ('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg') if Path(p).exists()), None)
    if not ffmpeg:
        return raw
    final = raw.with_name(raw.stem.removesuffix('-raw') + '.mp4')
    command = [
        ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(raw),
        '-vf', 'fps=30,scale=out_range=tv,format=yuv420p', '-color_range', 'tv', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium', '-crf', '16',
        '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', str(final),
    ]
    try:
        subprocess.run(command, check=True, timeout=1800)
    except (subprocess.SubprocessError, OSError) as error:
        print(f'ffmpeg could not finish {raw.name}: {error}', flush=True)
        final.unlink(missing_ok=True)
        return raw
    raw.unlink()
    return final


def start_log():
    LOG_DIR.mkdir(exist_ok=True)
    for old in sorted(LOG_DIR.glob('run-*.jsonl'))[:-KEEP_LOG_RUNS + 1]:
        old.unlink()
    LOG_FILE.touch()
    latest = LOG_DIR / 'latest.jsonl'
    latest.unlink(missing_ok=True)
    latest.symlink_to(LOG_FILE.name)


class AppHandler(SimpleHTTPRequestHandler):
    """Serves the app from src/, the pinned runtime and models from vendor/,
    and the private recorded fixture from assets/. Nothing else is exposed."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'src'), **kwargs)

    def translate_path(self, path):
        clean = posixpath.normpath(unquote(path.split('?', 1)[0].split('#', 1)[0]))
        if clean == '/demo.mp4':
            return str(ROOT / 'assets' / 'demo.mp4')
        # /vendor/... lives beside src/, everything else is served from src/.
        self.directory = str(ROOT if clean.startswith('/vendor/') else ROOT / 'src')
        return super().translate_path(path)

    def do_POST(self):
        # Only the app's own page may write to the log.
        origin = self.headers.get('Origin')
        allowed = {f'http://{HOST}:{self.server.server_port}', f'http://localhost:{self.server.server_port}'}
        length = int(self.headers.get('Content-Length') or 0)
        if origin and origin not in allowed:
            self.send_error(404)
        elif self.path.startswith('/snapshot/'):
            # A still frame, saved only when the Snapshot button is clicked.
            name = self.path.rsplit('/', 1)[-1]
            if name not in SNAPSHOT_NAMES:
                self.send_error(404)
            elif not 0 < length <= MAX_SNAPSHOT_POST:
                self.send_error(413)
            else:
                target = LOG_DIR / f"snapshot-{time.strftime('%Y%m%d-%H%M%S')}-{name}.jpg"
                target.write_bytes(self.rfile.read(length))
                body = target.name.encode()
                self.send_response(200)
                self.send_header('Content-Type', 'text/plain')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        elif self.path in ('/recording/mp4', '/recording/webm'):
            # A video of the picture and sound, saved only when Record is clicked.
            if not 0 < length <= MAX_RECORDING_POST:
                self.send_error(413)
            else:
                RECORDING_DIR.mkdir(exist_ok=True)
                target = RECORDING_DIR / f"reel-{time.strftime('%Y%m%d-%H%M%S')}-raw.{self.path.rsplit('/', 1)[-1]}"
                with target.open('wb') as out:
                    remaining = length
                    while remaining:
                        chunk = self.rfile.read(min(remaining, 1 << 20))
                        if not chunk:
                            break
                        out.write(chunk)
                        remaining -= len(chunk)
                target = finish_for_instagram(target)
                body = target.name.encode()
                self.send_response(200)
                self.send_header('Content-Type', 'text/plain')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        elif self.path == '/clip':
            # A test clip of the audio input, saved only when Save clip is clicked.
            if not 0 < length <= MAX_CLIP_POST:
                self.send_error(413)
            else:
                CLIP_DIR.mkdir(parents=True, exist_ok=True)
                target = CLIP_DIR / f"clip-{time.strftime('%Y%m%d-%H%M%S')}.wav"
                target.write_bytes(self.rfile.read(length))
                body = target.name.encode()
                self.send_response(200)
                self.send_header('Content-Type', 'text/plain')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        elif self.path != '/log':
            self.send_error(404)
        elif not 0 < length <= MAX_LOG_POST:
            self.send_error(413)
        else:
            data = self.rfile.read(length)
            with LOG_LOCK, LOG_FILE.open('ab') as out:
                out.write(data if data.endswith(b'\n') else data + b'\n')
            self.send_response(204)
            self.end_headers()

    def log_message(self, format, *args):
        if self.command != 'POST':  # keep the terminal readable; log posts arrive every second
            super().log_message(format, *args)


class Server(ThreadingHTTPServer):
    # The default queue of 5 pending connections is too small: the browser
    # opens several at once to load the app's modules, and a refused one
    # leaves the page silently dead.
    request_queue_size = 128
    daemon_threads = True


# name, port, request handler
SERVICES = [
    ('web app', 8794, AppHandler),
]


def main():
    start_log()
    servers = []
    for name, port, handler in SERVICES:
        server = Server((HOST, port), handler)
        threading.Thread(target=server.serve_forever, name=name, daemon=True).start()
        servers.append(server)
        print(f'Reality Forge {name}: http://{HOST}:{port}', flush=True)
    print(f'Session log: {LOG_FILE.relative_to(ROOT)}', flush=True)
    print('Ctrl+C to stop.', flush=True)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        print('\nStopping.', flush=True)
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    main()
