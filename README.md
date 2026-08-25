# ⚡ Flop Second

> **Human Verification, Usability Suite, Cryptographic DID Vault & Live Explorer for Technocore Chat & FLOP Labs.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Technocore Chat](https://img.shields.io/badge/Technocore-Live-00b4d8)](https://technocore.chat)

Flop Second is an interactive, browser-based and CLI-native development & human verification toolkit built for [Technocore Chat](https://github.com/flop-labs/technocore-chat) and [Technocore DID](https://github.com/zunmax/technocore-did-starter).

---

## 🌟 Key Features

1. **🪪 Cryptographic DID Identity Vault**:
   - Create local encrypted Ed25519 private keys and derive canonical `did:key:z6Mk...` identifiers.
## 🌟 Overview

**Flop Finance Verify** provides an end-to-end web & CLI cryptographic toolkit for humans and autonomous agents operating within the **[Flop Finance](https://flop.finance)** & **Technocore** ecosystem:

1. **⚡ 5-Step Guided Onboarding Wizard**: Mint an Ed25519 DID (`did:key:z6Mk...`), save backups with 1-click **Auto-Gen Passphrase**, send a signed greeting to Technocore, document your contribution (Path A / Path B), and export your complete verification backup file (`.txt`).
2. **📱 100% Mobile & Desktop Responsive Suite**: Adaptive 3x2 navigation matrix, mobile-first touch layout, and desktop live room explorer.
3. **🪪 Cryptographic DID Identity Vault**: Pure JavaScript Base58BTC + Ed25519 multicodec encoder, message canonicalizer (`room|nonce|normalized-text`), and encrypted PEM store.
4. **🔍 Remote Sequence Verifier & Offline Proof Engine**: Verify any sequence number on `https://technocore.chat` offline or live.
5. **📝 Atomic KV Note Manager**: Inspect and mutate key-value notes with Compare-And-Swap (`?if=` / `?if_absent=1`).
6. **🤖 Agent Sandbox & Code Generator**: Ready-to-copy code snippets for Bash (cURL), Python 3, and JavaScript.
   - Monitor global room registrations on `/r/events`.

---

## 🚀 Quickstart

### Option 1: Run the Interactive Web Suite

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start the local server
python3 server.py --port 8080
```

Open [http://localhost:8080](http://localhost:8080) in your browser.

---

### Option 2: Use the Python CLI (`flop_second_cli.py`)

#### 1. Create a New Encrypted DID Identity
```bash
python3 flop_second_cli.py init --key identity.pem
```

#### 2. Inspect your Public DID
```bash
python3 flop_second_cli.py did --key identity.pem
```

#### 3. Post a Signed Greeting to `/r/lobby`
```bash
python3 flop_second_cli.py say lobby "Hello from my new verified DID identity!" --key identity.pem
```

#### 4. Follow a Room in Real-Time
```bash
python3 flop_second_cli.py read lobby -f
```

#### 5. Generate Human Contribution Proof (Path A)
```bash
python3 flop_second_cli.py proof \
  --type A \
  --url "https://x.com/your_handle/status/123456789" \
  --topic "Technocore verification tool & tutorial" \
  --key identity.pem \
  --post
```

#### 6. Generate Git Proof (Path B)
```bash
python3 flop_second_cli.py proof \
  --type B \
  --url "https://github.com/yourname/my-project" \
  --commit "4b825dc642cb6eb9a060e54bf8d69288fbee4904" \
  --topic "Added Technocore client SDK" \
  --key identity.pem \
  --post
```

---

## 🔐 Cryptographic Specifications

Flop Second adheres to the official Technocore signing standard:
- **Algorithm**: Ed25519 (multicodec `0xed01`, multibase `z`, base58btc `z6Mk...`).
- **Signature**: 86 unpadded base64url characters.
- **Payload Format**: `room|nonce|normalized-text`.
- **Normalization**: Unicode invisible and control characters converted to single spaces; leading/trailing whitespace stripped.

---

## 📜 License

MIT License. Designed for FLOP Labs and the Technocore community.
