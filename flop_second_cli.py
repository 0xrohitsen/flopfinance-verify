#!/usr/bin/env python3
"""Flop Second CLI — Complete Human Verification, DID Management, and Technocore Suite.

Supports:
- Generating and loading encrypted Ed25519 DIDs (did:key:z6Mk...)
- Publishing signed & unsigned messages to Technocore rooms
- Creating and validating Path A (Public Content) & Path B (Git commit) proofs
- Offline & live signature verification
- Persistent KV notes & CAS operations
"""

from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

APP_NAME = "Flop Second"
APP_VERSION = "2.0.0"
DEFAULT_BASE_URL = "https://technocore.chat"
DEFAULT_KEY_PATH = Path("identity.pem")
DEFAULT_TIMEOUT_SECONDS = 20.0
MAX_MESSAGE_CHARS = 4096

MULTICODEC_ED25519 = b"\xed\x01"
MULTIBASE_LENGTH = 48
SIGNATURE_LENGTH = 86

BASE58BTC_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
BASE58BTC_INDEX = {
    character: index for index, character in enumerate(BASE58BTC_ALPHABET)
}
INVISIBLE_CATEGORIES = frozenset({"Cc", "Cf", "Cs", "Co", "Zl", "Zp"})
NAME_PATTERN = re.compile(r"[a-z0-9][a-z0-9_-]{0,47}")
NONCE_PATTERN = re.compile(r"[0-9]{1,19}")
SIGNATURE_PATTERN = re.compile(rf"[A-Za-z0-9_-]{{{SIGNATURE_LENGTH}}}")
COMMIT_PATTERN = re.compile(r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})")


class IdentityError(ValueError):
    """The identity cannot be created or loaded."""


class ProtocolError(ValueError):
    """Input fails the Technocore protocol."""


class NetworkError(RuntimeError):
    """Technocore HTTP request failed."""


def base58btc_encode(data: bytes) -> str:
    """Encode bytes using Base58BTC alphabet."""
    zeroes = len(data) - len(data.lstrip(b"\x00"))
    number = int.from_bytes(data, "big")
    encoded = ""
    while number:
        number, remainder = divmod(number, 58)
        encoded = BASE58BTC_ALPHABET[remainder] + encoded
    return "1" * zeroes + encoded


def base58btc_decode(value: str) -> bytes:
    """Decode a Base58BTC string into bytes."""
    number = 0
    for char in value:
        if char not in BASE58BTC_INDEX:
            raise ProtocolError(f"Invalid Base58BTC char: {char!r}")
        number = number * 58 + BASE58BTC_INDEX[char]
    decoded = number.to_bytes((number.bit_length() + 7) // 8, "big") if number else b""
    zeroes = len(value) - len(value.lstrip("1"))
    return b"\x00" * zeroes + decoded


def did_from_private_key(private_key: Ed25519PrivateKey) -> str:
    """Derive public did:key from private key."""
    pub_bytes = private_key.public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    multibase = "z" + base58btc_encode(MULTICODEC_ED25519 + pub_bytes)
    if len(multibase) != MULTIBASE_LENGTH or not multibase.startswith("z6Mk"):
        raise IdentityError("Generated an invalid Ed25519 did:key")
    return "did:key:" + multibase


def public_key_from_did(did: str) -> Ed25519PublicKey:
    """Parse did:key into an Ed25519 public key."""
    prefix = "did:key:"
    if not isinstance(did, str) or not did.startswith(prefix):
        raise ProtocolError("DID must start with 'did:key:z6Mk'")
    multibase = did[len(prefix) :]
    if len(multibase) != MULTIBASE_LENGTH or not multibase.startswith("z6Mk"):
        raise ProtocolError("DID must be a 48-char Ed25519 multibase string starting with z6Mk")
    decoded = base58btc_decode(multibase[1:])
    if len(decoded) != 34 or not decoded.startswith(MULTICODEC_ED25519):
        raise ProtocolError("DID does not contain valid Ed25519 public key header")
    return Ed25519PublicKey.from_public_bytes(decoded[2:])


def normalize_message(text: str) -> str:
    """Normalizes message removing invisible characters and single-lining."""
    if not isinstance(text, str):
        raise ProtocolError("Message text must be a string")
    normalized = "".join(
        " " if unicodedata.category(c) in INVISIBLE_CATEGORIES else c for c in text
    ).strip()
    if not normalized:
        raise ProtocolError("Message has no visible text after normalization")
    if len(normalized) > MAX_MESSAGE_CHARS:
        raise ProtocolError(f"Message exceeds {MAX_MESSAGE_CHARS} characters (got {len(normalized)})")
    return normalized


def validate_name(value: str, label: str = "room") -> str:
    """Validate room or identifier name."""
    if not isinstance(value, str) or NAME_PATTERN.fullmatch(value) is None:
        raise ProtocolError(f"{label} must match ^[a-z0-9][a-z0-9_-]{{0,47}}$ (got: {value!r})")
    return value


def validate_nonce(value: str | int) -> str:
    """Validate 1-19 digit numeric nonce."""
    nonce = str(value)
    if NONCE_PATTERN.fullmatch(nonce) is None:
        raise ProtocolError(f"Nonce must contain 1-19 ASCII digits (got: {nonce!r})")
    return nonce


def next_nonce() -> str:
    """Generate high-resolution wall-clock nonce."""
    return validate_nonce(time.time_ns())


def sign_bytes(private_key: Ed25519PrivateKey, payload: bytes) -> str:
    """Sign payload and return unpadded Base64URL signature."""
    sig = base64.urlsafe_b64encode(private_key.sign(payload)).decode("ascii").rstrip("=")
    if SIGNATURE_PATTERN.fullmatch(sig) is None:
        raise IdentityError("Generated invalid signature format")
    return sig


def verify_signature(did: str, signature: str, payload: bytes) -> bool:
    """Verify Ed25519 signature against DID and payload."""
    if SIGNATURE_PATTERN.fullmatch(signature or "") is None:
        raise ProtocolError(f"Signature must be {SIGNATURE_LENGTH} unpadded base64url characters")
    raw_sig = base64.urlsafe_b64decode(signature + "==")
    try:
        public_key_from_did(did).verify(raw_sig, payload)
        return True
    except InvalidSignature:
        return False


def message_payload(room: str, nonce: str | int, text: str) -> tuple[str, bytes]:
    """Construct normalized text and signed payload bytes: room|nonce|text."""
    v_room = validate_name(room, "room")
    v_nonce = validate_nonce(nonce)
    v_text = normalize_message(text)
    return v_text, f"{v_room}|{v_nonce}|{v_text}".encode("utf-8")


def create_identity(path: Path, passphrase: str) -> tuple[str, Path]:
    """Create a new encrypted Ed25519 PEM file."""
    path = path.expanduser().resolve()
    if path.exists():
        raise IdentityError(f"Identity file already exists at: {path}")
    if len(passphrase) < 12:
        raise IdentityError("Passphrase must be at least 12 characters long")

    key = Ed25519PrivateKey.generate()
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.BestAvailableEncryption(passphrase.encode("utf-8")),
    )

    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(pem)
    os.chmod(path, 0o600)

    did = did_from_private_key(key)
    return did, path


def load_identity(path: Path, passphrase: str) -> tuple[Ed25519PrivateKey, str]:
    """Load private key and derive DID from encrypted PEM."""
    path = path.expanduser().resolve()
    if not path.is_file():
        raise IdentityError(f"Identity file not found at: {path}")
    with open(path, "rb") as f:
        pem = f.read()
    try:
        key = serialization.load_pem_private_key(pem, password=passphrase.encode("utf-8"))
    except Exception as e:
        raise IdentityError(f"Failed to unlock identity (incorrect passphrase or corrupted PEM): {e}")
    if not isinstance(key, Ed25519PrivateKey):
        raise IdentityError("Identity key is not an Ed25519 private key")
    did = did_from_private_key(key)
    return key, did


def http_get(url: str, headers: dict[str, str] | None = None, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> dict[str, Any] | str:
    """Perform HTTP GET using fast curl transport with fallback."""
    try:
        cmd = ["curl", "-s", "-m", str(int(timeout)), url]
        if headers:
            for k, v in headers.items():
                cmd.extend(["-H", f"{k}: {v}"])
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        raw = proc.stdout.strip()
        if raw.startswith("{") or raw.startswith("["):
            try:
                return json.loads(raw)
            except Exception:
                return raw
        return raw
    except Exception:
        pass

    # Fallback to urllib
    req_headers = {"User-Agent": f"FlopSecond/{APP_VERSION}"}
    if headers:
        req_headers.update(headers)
    req = Request(url, headers=req_headers)
    try:
        with urlopen(req, timeout=timeout) as res:
            raw = res.read().decode("utf-8", errors="replace")
            if raw.strip().startswith("{") or raw.strip().startswith("["):
                try:
                    return json.loads(raw)
                except Exception:
                    return raw
            return raw
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise NetworkError(f"HTTP {e.code}: {body.strip()}") from e
    except URLError as e:
        raise NetworkError(f"Network connection failed: {e.reason}") from e


def cmd_init(args: argparse.Namespace) -> None:
    """Initialize a new encrypted DID."""
    path = Path(args.key)
    if path.exists() and not args.force:
        print(f"[-] Identity already exists at: {path}", file=sys.stderr)
        print("    Use another path with --key or inspect with 'flop_second_cli.py did'", file=sys.stderr)
        sys.exit(1)

    if args.passphrase:
        passphrase = args.passphrase
    else:
        passphrase = getpass.getpass("Enter passphrase for new identity (min 12 chars): ")
        confirm = getpass.getpass("Confirm passphrase: ")
        if passphrase != confirm:
            print("[-] Passphrases do not match!", file=sys.stderr)
            sys.exit(1)

    if len(passphrase) < 12:
        print("[-] Passphrase must be at least 12 characters!", file=sys.stderr)
        sys.exit(1)

    did, saved_path = create_identity(path, passphrase)
    print("\n[+] Identity created successfully!")
    print(f"    File: {saved_path}")
    print(f"    DID:  \033[92m{did}\033[0m")
    print("\n[!] Keep your identity.pem and passphrase safe. Share only your DID.\n")


def cmd_did(args: argparse.Namespace) -> None:
    """Read existing DID from encrypted PEM."""
    path = Path(args.key)
    if not path.is_file():
        print(f"[-] Identity file not found at: {path}", file=sys.stderr)
        sys.exit(1)

    passphrase = args.passphrase or getpass.getpass("Enter passphrase for identity: ")
    _, did = load_identity(path, passphrase)
    if args.json:
        print(json.dumps({"path": str(path.resolve()), "did": did}, indent=2))
    else:
        print(f"DID: \033[92m{did}\033[0m")


def cmd_say(args: argparse.Namespace) -> None:
    """Post message to room (signed or unsigned)."""
    room = validate_name(args.room, "room")
    base = args.server.rstrip("/")

    if args.unsigned:
        nick = args.nick or "human"
        encoded_text = quote(args.text, safe="")
        url = f"{base}/r/{room}/say/{quote(nick, safe='')}/{encoded_text}"
        res = http_get(url)
        print(res if isinstance(res, str) else json.dumps(res, indent=2))
        return

    # Signed lane
    path = Path(args.key)
    passphrase = args.passphrase or getpass.getpass("Enter passphrase for identity: ")
    key, did = load_identity(path, passphrase)
    nonce = next_nonce()
    norm_text, payload = message_payload(room, nonce, args.text)
    sig = sign_bytes(key, payload)

    encoded_text = quote(norm_text, safe="")
    url = f"{base}/r/{room}/say-signed/{quote(did, safe='')}/{quote(sig, safe='')}/{nonce}/{encoded_text}"
    
    if args.format == "json":
        url += "?format=json"

    res = http_get(url)
    if isinstance(res, dict):
        print(json.dumps(res, indent=2))
    else:
        print(res)


def cmd_read(args: argparse.Namespace) -> None:
    """Read room history or tail in real-time."""
    room = validate_name(args.room, "room")
    base = args.server.rstrip("/")

    if not args.tail:
        params: dict[str, Any] = {}
        if args.since is not None:
            params["since"] = args.since
        if args.limit:
            params["limit"] = args.limit
        if args.json:
            params["format"] = "json"

        qs = ("?" + urlencode(params)) if params else ""
        url = f"{base}/r/{room}{qs}"
        res = http_get(url)
        print(json.dumps(res, indent=2) if isinstance(res, dict) else res)
        return

    # Live tail mode
    last_seq = args.since if args.since is not None else 0
    print(f"[*] Tailing /r/{room} starting after seq {last_seq}... (Ctrl+C to stop)")
    while True:
        try:
            url = f"{base}/r/{room}?since={last_seq}&wait=10&format=json"
            res = http_get(url, timeout=15.0)
            if isinstance(res, dict):
                msgs = res.get("messages", [])
                for m in msgs:
                    seq = m.get("seq")
                    sender = m.get("from", "")
                    text = m.get("text", "")
                    ts = m.get("ts", "")
                    sender_disp = f"\033[94m{sender}\033[0m" if sender.startswith("did:key:") else f"\033[93m~{sender}\033[0m"
                    print(f"[{seq}] ({ts}) <{sender_disp}> {text}")
                    if seq is not None and seq > last_seq:
                        last_seq = seq
                if res.get("last_seq") is not None and res["last_seq"] > last_seq:
                    last_seq = res["last_seq"]
        except KeyboardInterrupt:
            print("\n[*] Stopped tailing.")
            break
        except Exception as e:
            print(f"[!] Polling error: {e}", file=sys.stderr)
            time.sleep(2.0)


def cmd_verify(args: argparse.Namespace) -> None:
    """Verify cryptographic signature offline and against Technocore."""
    did = args.did
    sig = args.sig
    nonce = args.nonce
    room = args.room
    text = args.text

    _, payload = message_payload(room, nonce, text)
    valid = verify_signature(did, sig, payload)

    print("\n--- Signature Verification Result ---")
    print(f"DID:       {did}")
    print(f"Room:      {room}")
    print(f"Nonce:     {nonce}")
    print(f"Text:      {text}")
    print(f"Signature: {sig}")
    print(f"Payload:   {payload.decode('utf-8', errors='replace')}")
    if valid:
        print("\n\033[92m[✓] VALID SIGNATURE — Authentic cryptographic signature from DID holder.\033[0m\n")
    else:
        print("\n\033[91m[✗] INVALID SIGNATURE — Payload does not match signature or public key.\033[0m\n")
        sys.exit(1)


def cmd_proof(args: argparse.Namespace) -> None:
    """Human & Agent Contribution Proof Generator (Path A & Path B)."""
    path = Path(args.key)
    passphrase = args.passphrase or getpass.getpass("Enter passphrase for identity: ")
    key, did = load_identity(path, passphrase)

    print("\n" + "=" * 60)
    print("  Flop Second — Technocore Human Verification & Proof Wizard")
    print("=" * 60)
    print(f"Active DID: \033[92m{did}\033[0m\n")

    kind = args.type or "A"
    if kind.upper() == "A":
        url = args.url
        topic = args.topic
        if not url:
            url = input("Enter Public Contribution URL (X post, video, article, tool): ").strip()
        if not topic:
            topic = input("Enter brief description of what was built/demonstrated: ").strip()

        msg = f"I published a Technocore contribution: {url}. It helps people understand {topic}."
        room = args.room or "technocore"
        nonce = next_nonce()
        norm_text, payload = message_payload(room, nonce, msg)
        sig = sign_bytes(key, payload)

        proof_data = {
            "version": "1.0",
            "type": "Path A - Public Contribution",
            "did": did,
            "room": room,
            "nonce": nonce,
            "message": norm_text,
            "signature": sig,
            "contribution_url": url,
            "topic": topic,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

        print("\n[+] Generated Proof:")
        print(json.dumps(proof_data, indent=2))

        if args.post or input("\nPost signed announcement to Technocore now? [y/N]: ").strip().lower() == "y":
            base = args.server.rstrip("/")
            post_url = f"{base}/r/{room}/say-signed/{quote(did, safe='')}/{quote(sig, safe='')}/{nonce}/{quote(norm_text, safe='')}?format=json"
            res = http_get(post_url)
            print("\n[+] Technocore Response:")
            print(json.dumps(res, indent=2) if isinstance(res, dict) else res)
            if isinstance(res, dict) and "posted" in res:
                proof_data["technocore_receipt"] = res["posted"]

        if args.out:
            Path(args.out).write_text(json.dumps(proof_data, indent=2), encoding="utf-8")
            print(f"[+] Proof saved to {args.out}")

    else:
        # Path B - Git commit proof
        repo_url = args.url or input("Enter Public Git Repository HTTPS URL: ").strip()
        commit = args.commit or input("Enter Full Git Commit Hash (40/64 hex): ").strip()
        desc = args.topic or input("Enter Description of Git contribution: ").strip()

        if COMMIT_PATTERN.fullmatch(commit) is None:
            print("[-] Invalid commit hash format!", file=sys.stderr)
            sys.exit(1)

        msg = f"I published an open-source contribution for Technocore at {repo_url} (commit {commit}): {desc}"
        room = args.room or "technocore"
        nonce = next_nonce()
        norm_text, payload = message_payload(room, nonce, msg)
        sig = sign_bytes(key, payload)

        proof_data = {
            "version": "1.0",
            "type": "Path B - Git Proof",
            "did": did,
            "room": room,
            "nonce": nonce,
            "repo_url": repo_url,
            "commit": commit,
            "description": desc,
            "message": norm_text,
            "signature": sig,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

        print("\n[+] Generated Git Proof:")
        print(json.dumps(proof_data, indent=2))

        if args.post or input("\nPost signed announcement to Technocore now? [y/N]: ").strip().lower() == "y":
            base = args.server.rstrip("/")
            post_url = f"{base}/r/{room}/say-signed/{quote(did, safe='')}/{quote(sig, safe='')}/{nonce}/{quote(norm_text, safe='')}?format=json"
            res = http_get(post_url)
            print("\n[+] Technocore Response:")
            print(json.dumps(res, indent=2) if isinstance(res, dict) else res)


def cmd_kv(args: argparse.Namespace) -> None:
    """Manage persistent KV notes."""
    base = args.server.rstrip("/")
    ns = validate_name(args.ns, "namespace")
    
    if args.action == "get":
        key = validate_name(args.key, "key")
        url = f"{base}/kv/{ns}/{key}"
        res = http_get(url)
        print(res if isinstance(res, str) else json.dumps(res, indent=2))

    elif args.action == "set":
        key = validate_name(args.key, "key")
        val = quote(args.value, safe="")
        url = f"{base}/kv/{ns}/{key}/set/{val}"
        if args.if_val:
            url += f"?if={quote(args.if_val, safe='')}"
        elif args.if_absent:
            url += "?if_absent=1"
        res = http_get(url)
        print(res if isinstance(res, str) else json.dumps(res, indent=2))

    elif args.action == "list":
        url = f"{base}/kv/{ns}"
        res = http_get(url)
        print(res if isinstance(res, str) else json.dumps(res, indent=2))


def cmd_rooms(args: argparse.Namespace) -> None:
    """List Technocore rooms."""
    base = args.server.rstrip("/")
    url = f"{base}/rooms"
    if args.json:
        url += "?format=json"
    res = http_get(url)
    print(json.dumps(res, indent=2) if isinstance(res, dict) else res)


def main() -> None:
    common_parser = argparse.ArgumentParser(add_help=False)
    common_parser.add_argument("--server", default=DEFAULT_BASE_URL, help="Technocore server base URL")
    common_parser.add_argument("--key", default=str(DEFAULT_KEY_PATH), help="Path to identity.pem")
    common_parser.add_argument("--passphrase", help="Passphrase for identity.pem (omit to prompt safely)")

    parser = argparse.ArgumentParser(
        prog="flop_second_cli",
        description=f"{APP_NAME} v{APP_VERSION} — Human Verification & Technocore Suite",
        parents=[common_parser],
    )
    parser.add_argument("--version", action="version", version=f"{APP_NAME} {APP_VERSION}")

    sub = parser.add_subparsers(dest="command", required=True)

    # init
    p_init = sub.add_parser("init", parents=[common_parser], help="Create a new encrypted Ed25519 DID")
    p_init.add_argument("--force", action="store_true", help="Overwrite existing identity")

    # did
    p_did = sub.add_parser("did", parents=[common_parser], help="Display public DID from identity.pem")
    p_did.add_argument("--json", action="store_true", help="Output as JSON")

    # say
    p_say = sub.add_parser("say", parents=[common_parser], help="Post a signed or unsigned message to a room")
    p_say.add_argument("room", help="Target room name (e.g. lobby, technocore)")
    p_say.add_argument("text", help="Message body")
    p_say.add_argument("--unsigned", action="store_true", help="Post unsigned as nickname")
    p_say.add_argument("--nick", default="human", help="Nickname when unsigned")
    p_say.add_argument("--format", choices=["text", "json"], default="text", help="Response format")

    # read
    p_read = sub.add_parser("read", parents=[common_parser], help="Read messages from a room")
    p_read.add_argument("room", help="Room name")
    p_read.add_argument("--since", type=int, help="Sequence cursor (read newer)")
    p_read.add_argument("--limit", type=int, help="Number of messages (1..200)")
    p_read.add_argument("--tail", "-f", action="store_true", help="Follow / tail room in real-time")
    p_read.add_argument("--json", action="store_true", help="Output JSON format")

    # verify
    p_ver = sub.add_parser("verify", parents=[common_parser], help="Verify cryptographic signature")
    p_ver.add_argument("--did", required=True, help="Public DID (did:key:z6Mk...)")
    p_ver.add_argument("--sig", required=True, help="86-char Base64URL signature")
    p_ver.add_argument("--nonce", required=True, help="Message nonce")
    p_ver.add_argument("--room", required=True, help="Target room")
    p_ver.add_argument("--text", required=True, help="Message text")

    # proof
    p_proof = sub.add_parser("proof", parents=[common_parser], help="Human Proof & Contribution Generator")
    p_proof.add_argument("--type", choices=["A", "B"], default="A", help="Path A (Social/URL) or Path B (Git)")
    p_proof.add_argument("--url", help="Contribution or Git repository URL")
    p_proof.add_argument("--topic", help="Summary / topic of contribution")
    p_proof.add_argument("--commit", help="Commit hash (for Path B)")
    p_proof.add_argument("--room", default="technocore", help="Room to announce proof in")
    p_proof.add_argument("--post", action="store_true", help="Post directly to Technocore")
    p_proof.add_argument("--out", help="Save proof JSON artifact to file")

    # kv
    p_kv = sub.add_parser("kv", parents=[common_parser], help="Key-Value note storage operations")
    p_kv.add_argument("action", choices=["get", "set", "list"], help="KV action")
    p_kv.add_argument("ns", help="Namespace")
    p_kv.add_argument("key", nargs="?", default="", help="Note key")
    p_kv.add_argument("value", nargs="?", default="", help="Value to set")
    p_kv.add_argument("--if-val", dest="if_val", help="CAS: only set if current value matches")
    p_kv.add_argument("--if-absent", action="store_true", help="CAS: only set if key is absent")

    # rooms
    p_rooms = sub.add_parser("rooms", parents=[common_parser], help="List Technocore rooms")
    p_rooms.add_argument("--json", action="store_true", help="JSON output")

    args = parser.parse_args()

    try:
        if args.command == "init":
            cmd_init(args)
        elif args.command == "did":
            cmd_did(args)
        elif args.command == "say":
            cmd_say(args)
        elif args.command == "read":
            cmd_read(args)
        elif args.command == "verify":
            cmd_verify(args)
        elif args.command == "proof":
            cmd_proof(args)
        elif args.command == "kv":
            cmd_kv(args)
        elif args.command == "rooms":
            cmd_rooms(args)
    except (IdentityError, ProtocolError, NetworkError) as e:
        print(f"[-] Error: {e}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nInterrupted.")
        sys.exit(130)


if __name__ == "__main__":
    main()
