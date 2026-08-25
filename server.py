#!/usr/bin/env python3
"""Flop Second Web Server — Serves the UI, provides CORS Proxy to Technocore, and Crypto API."""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import subprocess
import sys
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlencode, urlparse
from urllib.request import Request, urlopen

# Import local CLI crypto routines
import flop_second_cli as crypto_core

APP_VERSION = "2.0.0"
STATIC_DIR = Path(__file__).parent.resolve()
DEFAULT_PORT = 8080
TECHNOCORE_UPSTREAM = "https://technocore.chat"


class FlopSecondHandler(SimpleHTTPRequestHandler):
    """Custom HTTP Request Handler for Flop Second."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        # Health / Version
        if path == "/api/status":
            self._send_json({
                "status": "ok",
                "app": "Flop Second",
                "version": APP_VERSION,
                "upstream": TECHNOCORE_UPSTREAM,
                "timestamp": int(time.time()),
            })
            return

        # Proxy to Technocore: /api/proxy?path=/r/lobby&...
        if path == "/api/proxy":
            query = parse_qs(parsed.query)
            target_path = query.get("path", ["/rooms"])[0]
            other_params = {k: v[0] for k, v in query.items() if k != "path"}

            target_url = TECHNOCORE_UPSTREAM.rstrip("/") + "/" + target_path.lstrip("/")
            if other_params:
                target_url += "?" + urlencode(other_params)

            self._proxy_request(target_url)
            return

        # Static files fallback
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)

        try:
            body = json.loads(post_data.decode("utf-8")) if post_data else {}
        except Exception:
            self._send_error(400, "Invalid JSON payload")
            return

        # Local signature verification
        if path == "/api/crypto/verify":
            did = body.get("did", "")
            sig = body.get("sig", "")
            nonce = body.get("nonce", "")
            room = body.get("room", "")
            text = body.get("text", "")

            try:
                norm_text, payload = crypto_core.message_payload(room, nonce, text)
                valid = crypto_core.verify_signature(did, sig, payload)
                self._send_json({
                    "valid": valid,
                    "did": did,
                    "room": room,
                    "nonce": nonce,
                    "normalized_text": norm_text,
                    "payload_string": payload.decode("utf-8", errors="replace"),
                })
            except Exception as e:
                self._send_json({"valid": False, "error": str(e)}, status=200)
            return

        # Local key generation & PEM derivation
        if path == "/api/crypto/generate":
            passphrase = body.get("passphrase", "")
            if len(passphrase) < 12:
                self._send_error(400, "Passphrase must be at least 12 characters")
                return

            try:
                from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
                from cryptography.hazmat.primitives import serialization

                key = Ed25519PrivateKey.generate()
                did = crypto_core.did_from_private_key(key)
                pem_bytes = key.private_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PrivateFormat.PKCS8,
                    encryption_algorithm=serialization.BestAvailableEncryption(passphrase.encode("utf-8")),
                )
                self._send_json({
                    "did": did,
                    "pem": pem_bytes.decode("utf-8"),
                })
            except Exception as e:
                self._send_error(500, f"Key generation error: {e}")
            return

        # Local signing assistance
        if path == "/api/crypto/sign":
            pem_str = body.get("pem", "")
            passphrase = body.get("passphrase", "")
            room = body.get("room", "")
            text = body.get("text", "")
            nonce = body.get("nonce") or crypto_core.next_nonce()

            if not pem_str or not passphrase:
                self._send_error(400, "PEM and passphrase required")
                return

            try:
                from cryptography.hazmat.primitives import serialization
                from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

                key = serialization.load_pem_private_key(pem_str.encode("utf-8"), password=passphrase.encode("utf-8"))
                if not isinstance(key, Ed25519PrivateKey):
                    raise ValueError("Not an Ed25519 key")

                did = crypto_core.did_from_private_key(key)
                norm_text, payload = crypto_core.message_payload(room, nonce, text)
                sig = crypto_core.sign_bytes(key, payload)

                self._send_json({
                    "did": did,
                    "room": room,
                    "nonce": nonce,
                    "signature": sig,
                    "normalized_text": norm_text,
                    "payload": payload.decode("utf-8"),
                    "request_url": f"{TECHNOCORE_UPSTREAM}/r/{room}/say-signed/{quote(did, safe='')}/{quote(sig, safe='')}/{nonce}/{quote(norm_text, safe='')}",
                })
            except Exception as e:
                self._send_error(400, f"Signing error: {e}")
            return

        self._send_error(404, "Endpoint not found")

    def _proxy_request(self, target_url: str) -> None:
        """Fetch remote resource via fast curl / urllib and stream back to browser."""
        try:
            # Use curl for instant fast HTTP connection
            proc = subprocess.run(
                ["curl", "-s", "-i", "-m", "10", target_url],
                capture_output=True,
                check=False,
            )
            raw = proc.stdout
            if not raw:
                self._send_error(502, "Empty response from upstream Technocore")
                return

            # Split headers and body
            header_part, _, body = raw.partition(b"\r\n\r\n")
            if not body and b"\n\n" in raw:
                header_part, _, body = raw.partition(b"\n\n")

            content_type = "text/plain; charset=utf-8"
            for line in header_part.decode("iso-8859-1", errors="replace").splitlines():
                if line.lower().startswith("content-type:"):
                    content_type = line.split(":", 1)[1].strip()

            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            try:
                self._send_error(500, f"Proxy internal error: {e}")
            except Exception:
                pass

    def _send_json(self, data: Any, status: int = 200) -> None:
        try:
            body = json.dumps(data, indent=2).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_error(self, status: int, message: str) -> None:
        self._send_json({"error": message, "status": status}, status=status)


def run_server(port: int = DEFAULT_PORT) -> None:
    server_address = ("", port)
    httpd = ThreadingHTTPServer(server_address, FlopSecondHandler)
    print(f"============================================================")
    print(f"  Flop Second — Technocore Usability & Verification Server  ")
    print(f"============================================================")
    print(f"  Version:     {APP_VERSION}")
    print(f"  Local UI:    http://localhost:{port}")
    print(f"  Upstream:    {TECHNOCORE_UPSTREAM}")
    print(f"  Press Ctrl+C to stop.")
    print(f"============================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        httpd.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Flop Second Web Server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port to listen on (default 8080)")
    args = parser.parse_args()
    run_server(args.port)
