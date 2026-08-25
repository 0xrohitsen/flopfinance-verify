/**
 * Flop Second — Human Verification & Proof Wizard Logic.
 * Enables generating, signing, submitting, and verifying Path A / Path B contributions.
 */

import { FlopCrypto } from "./crypto.js";

export const FlopProof = {
  /**
   * Build Path A (Public Content) Proof
   */
  async createPathAProof({ url, topic, room = "technocore", pem, passphrase, client }) {
    if (!url || !topic) {
      throw new Error("Contribution URL and topic description are required");
    }

    const messageText = `I published a Technocore contribution: ${url}. It helps people understand ${topic}.`;
    
    // Sign message
    const signResult = await FlopCrypto.signMessage(pem, passphrase, room, messageText);
    const { did, nonce, signature, normalized_text, payload } = signResult;

    const proof = {
      version: "1.0",
      type: "Path A - Public Contribution",
      did,
      room,
      nonce,
      message: normalized_text,
      signature,
      payload,
      contribution_url: url,
      topic,
      created_at: new Date().toISOString(),
    };

    // If client provided, post to Technocore
    let postedReceipt = null;
    if (client) {
      postedReceipt = await client.postSigned(room, did, signature, nonce, normalized_text);
      proof.receipt = postedReceipt;
    }

    return { proof, messageText, signResult, postedReceipt };
  },

  /**
   * Build Path B (Git Open Source) Proof
   */
  async createPathBProof({ repoUrl, commitHash, description, room = "technocore", pem, passphrase, client }) {
    if (!repoUrl || !commitHash) {
      throw new Error("Repository URL and Commit Hash are required");
    }
    if (!/^[0-9a-fA-F]{40}$|^[0-9a-fA-F]{64}$/.test(commitHash)) {
      throw new Error("Commit hash must be 40 or 64 hex characters");
    }

    const messageText = `I published an open-source contribution for Technocore at ${repoUrl} (commit ${commitHash}): ${description || "Flop Second verification"}`;

    const signResult = await FlopCrypto.signMessage(pem, passphrase, room, messageText);
    const { did, nonce, signature, normalized_text, payload } = signResult;

    const proof = {
      version: "1.0",
      type: "Path B - Git Proof",
      did,
      room,
      nonce,
      message: normalized_text,
      signature,
      payload,
      repo_url: repoUrl,
      commit: commitHash,
      description,
      created_at: new Date().toISOString(),
    };

    let postedReceipt = null;
    if (client) {
      postedReceipt = await client.postSigned(room, did, signature, nonce, normalized_text);
      proof.receipt = postedReceipt;
    }

    return { proof, messageText, signResult, postedReceipt };
  },

  /**
   * Fetch and verify a posted message in a room by its sequence number
   */
  async verifyRoomSequence(client, room, seq) {
    const targetSeq = parseInt(seq, 10);
    if (isNaN(targetSeq) || targetSeq < 0) {
      throw new Error("Invalid sequence number");
    }

    // Fetch window around sequence
    const sinceSeq = Math.max(0, targetSeq - 1);
    const res = await client.getRoom(room, sinceSeq, 10);

    if (!res || !res.messages || !res.messages.length) {
      throw new Error(`No message found at seq ${targetSeq} in room ${room}`);
    }

    const msg = res.messages.find((m) => m.seq === targetSeq);
    if (!msg) {
      throw new Error(`Sequence ${targetSeq} not found in room ${room}`);
    }

    const isSigned = msg.from && msg.from.startsWith("did:key:");
    return {
      msg,
      isSigned,
      verified: isSigned,
      did: isSigned ? msg.from : null,
      text: msg.text,
      seq: msg.seq,
      ts: msg.ts,
    };
  },

  /**
   * Generate formatted X (Twitter) post text
   */
  generateSocialShareText(proofData) {
    const seqStr = proofData.seq ? ` [seq #${proofData.seq}]` : "";
    return `Verified contribution for @flop_labs #Technocore${seqStr} ⚡🚀

🪪 DID: ${proofData.did}
💬 Room: /r/${proofData.room}
🔗 Evidence: ${proofData.url}

Built by @bigbrainless via https://flopfinance-verify.vercel.app #FLOP`;
  }
};
