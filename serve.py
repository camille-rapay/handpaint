"""A tiny local web server for HandPaint that tells the browser never to cache, so edits show up on a normal reload.

    python3 serve.py          # then open http://localhost:8000
"""
import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), Handler) as server:
    print(f"HandPaint web: http://localhost:{PORT}  (Ctrl+C to stop)")
    server.serve_forever()
