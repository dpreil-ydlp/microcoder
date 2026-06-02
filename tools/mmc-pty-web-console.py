#!/usr/bin/env python3
import http.server
import json
import os
import pty
import secrets
import select
import signal
import subprocess
import threading
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

CWD = os.environ.get("MMC_WEB_TUI_CWD", os.getcwd())
PORT = int(os.environ.get("MMC_WEB_TUI_PORT", "4180"))
TUI_ARGV = json.loads(os.environ["MMC_WEB_TUI_ARGV"])
PROOF_DIR = os.environ.get("MMC_WEB_TUI_PROOF_DIR")
MISSION_DIR = os.environ.get("MMC_WEB_TUI_MISSION_DIR", ".mission")

OUTPUT = ""
TRANSCRIPT = []
LOCK = threading.Lock()
TOKEN = secrets.token_urlsafe(24)
SERVER = None


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def append_transcript(event, payload):
    with LOCK:
        TRANSCRIPT.append({"at": now_iso(), "event": event, **payload})
        del TRANSCRIPT[:-500]


def mission_root():
    root = Path(MISSION_DIR)
    return root if root.is_absolute() else Path(CWD) / root


def artifact_manifest():
    root = mission_root()
    if not root.exists():
        return []
    files = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if "/worktrees/" in f"/{rel}/":
            continue
        stat = path.stat()
        files.append({
            "path": rel,
            "bytes": stat.st_size,
            "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat().replace("+00:00", "Z"),
        })
    return sorted(files, key=lambda item: item["path"])


def build_proof_payload():
    with LOCK:
        output = OUTPUT
        transcript = list(TRANSCRIPT)
    return {
        "generated_at": now_iso(),
        "cwd": CWD,
        "argv": TUI_ARGV,
        "pid": proc.pid,
        "alive": proc.poll() is None,
        "exit_code": proc.poll(),
        "output_chars": len(output),
        "output_tail": output[-12000:],
        "transcript": transcript,
        "artifacts": artifact_manifest(),
    }


def write_proof_files(reason):
    if not PROOF_DIR:
        return
    proof_root = Path(PROOF_DIR)
    proof_root.mkdir(parents=True, exist_ok=True)
    payload = build_proof_payload()
    payload["reason"] = reason
    (proof_root / "web-pty-proof.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    (proof_root / "web-pty-transcript.txt").write_text(payload["output_tail"], encoding="utf-8")

master_fd, slave_fd = pty.openpty()
proc = subprocess.Popen(
    TUI_ARGV,
    cwd=CWD,
    stdin=slave_fd,
    stdout=slave_fd,
    stderr=slave_fd,
    close_fds=True,
)
os.close(slave_fd)


def reader():
    global OUTPUT
    while True:
        readable, _, _ = select.select([master_fd], [], [], 0.25)
        if not readable:
            if proc.poll() is not None:
                break
            continue
        try:
            data = os.read(master_fd, 8192)
        except OSError:
            break
        if not data:
            break
        with LOCK:
            OUTPUT += data.decode("utf-8", errors="replace")
            OUTPUT = OUTPUT[-120000:]
            chunk = data.decode("utf-8", errors="replace")
        append_transcript("output", {"text": chunk})


threading.Thread(target=reader, daemon=True).start()


PAGE_TEMPLATE = """<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Microcoder PTY Console</title>
  <style>
    body { margin: 0; font: 14px ui-monospace, SFMono-Regular, Menlo, monospace; background: #101010; color: #eee; }
    header { padding: 14px 18px; border-bottom: 1px solid #333; }
    main { padding: 14px 18px; }
    button, input { font: inherit; border: 1px solid #555; background: #1f1f1f; color: #eee; border-radius: 4px; padding: 8px 10px; }
    button { margin-right: 6px; cursor: pointer; }
    input { width: min(720px, 70vw); }
    pre { height: 66vh; overflow: auto; padding: 14px; border: 1px solid #333; background: #020202; color: #dcffdc; white-space: pre-wrap; }
    .ok { color: #8ee98e; }
  </style>
</head>
<body>
  <header>
    <h1>Microcoder PTY Console</h1>
    <div>This page drives a real PTY running the Microcoder chat and build console.</div>
  </header>
  <main>
    <input id="cmd" aria-label="command" placeholder="Tell microcoder what you want to build" autofocus />
    <button id="send">Send</button>
    <button data-cmd="/chat status">Chat Status</button>
    <button data-cmd="/build status">Status</button>
    <button data-cmd="/models">Models</button>
    <button data-cmd="/probe-extra test_writer">Bad Prefix</button>
    <button data-cmd="/build validate">Validate</button>
    <button data-cmd="/exit">Exit</button>
    <span id="state" class="ok">running</span>
    <span id="proof"></span>
    <pre id="out"></pre>
  </main>
  <script>
    const TOKEN = "__MMC_TOKEN__";
    async function send(text) {
      await fetch("/send", { method: "POST", headers: { "x-mmc-token": TOKEN }, body: text + "\\n" });
      document.getElementById("cmd").value = "";
      await poll();
    }
    async function poll() {
      const res = await fetch("/output");
      const data = await res.json();
      document.getElementById("state").textContent = data.alive ? "running" : "exited:" + data.code;
      document.getElementById("proof").textContent = " artifacts:" + data.artifacts.length + " output:" + data.output.length;
      const out = document.getElementById("out");
      out.textContent = data.output;
      out.scrollTop = out.scrollHeight;
    }
    document.getElementById("send").addEventListener("click", () => send(document.getElementById("cmd").value));
    document.getElementById("cmd").addEventListener("keydown", ev => {
      if (ev.key === "Enter") send(document.getElementById("cmd").value);
    });
    for (const button of document.querySelectorAll("button[data-cmd]")) {
      button.addEventListener("click", () => send(button.dataset.cmd));
    }
    setInterval(poll, 500);
    poll();
  </script>
</body>
</html>"""
PAGE = PAGE_TEMPLATE.replace("__MMC_TOKEN__", TOKEN)


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/health":
            body = json.dumps({
                "ok": True,
                "alive": proc.poll() is None,
                "code": proc.poll(),
                "pid": proc.pid,
                "cwd": CWD,
                "argv": TUI_ARGV,
                "output_chars": len(OUTPUT),
            }).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/output":
            with LOCK:
                output = OUTPUT
            body = json.dumps({"alive": proc.poll() is None, "code": proc.poll(), "output": output, "artifacts": artifact_manifest()}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/artifacts":
            body = json.dumps({"mission_dir": str(mission_root()), "artifacts": artifact_manifest()}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/transcript":
            body = json.dumps(build_proof_payload()).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(PAGE.encode())

    def do_POST(self):
        if self.path != "/send":
            self.send_error(404)
            return
        if self.headers.get("x-mmc-token") != TOKEN:
            self.send_error(403)
            return
        length = int(self.headers.get("content-length", "0"))
        data = self.rfile.read(length)
        append_transcript("input", {"text": data.decode("utf-8", errors="replace")})
        if proc.poll() is None:
            os.write(master_fd, data)
            time.sleep(0.1)
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        body = json.dumps({"ok": True, "alive": proc.poll() is None, "output_chars": len(OUTPUT)}).encode()
        self.wfile.write(body)


class LocalThreadingHTTPServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True


def shutdown(signum, frame):
    write_proof_files(f"signal_{signum}")
    if proc.poll() is None:
        try:
            os.write(master_fd, b"/exit\n")
            time.sleep(0.2)
        except OSError:
            pass
        proc.terminate()
    raise SystemExit


signal.signal(signal.SIGTERM, shutdown)
signal.signal(signal.SIGINT, shutdown)


def shutdown_when_tui_exits():
    proc.wait()
    time.sleep(1.5)
    write_proof_files("tui_exit")
    deadline = time.time() + 5
    while SERVER is None and time.time() < deadline:
        time.sleep(0.05)
    if SERVER is not None:
        SERVER.shutdown()


threading.Thread(target=shutdown_when_tui_exits, daemon=True).start()

print(f"Microcoder PTY Console http://127.0.0.1:{PORT}", flush=True)
SERVER = LocalThreadingHTTPServer(("127.0.0.1", PORT), Handler)
SERVER.serve_forever()
