#!/usr/bin/env python3
"""
Local preview server for the Lunar Arcade.

Serves only this repository (the folder above tools/), on 127.0.0.1, with
caching off so edits show on reload.

Usage:
    python3 tools/serve.py [port]
    PORT=1234 python3 tools/serve.py   # environment takes precedence
Default port: 8433
"""
import http.server
import os
import socketserver
import sys

PORT = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 8433))
DIRECTORY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"Lunar Arcade running at http://127.0.0.1:{PORT}/")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
