/**
 * Flop Finance Verify — Application UI Controller, Wizard Orchestrator & Studio.
 * Official Client for Flop Finance (https://flop.finance) & Technocore Protocol.
 * Built by @bigbrainless for @flop_labs.
 */

import { TechnocoreClient } from "./api.js";
import { FlopCrypto } from "./crypto.js";
import { FlopProof } from "./proof.js";

// Global Application State
const state = {
  activeRoom: "lobby",
  lastSeq: 0,
  isPolling: true,
  pollTimer: null,
  pollInterval: 3000,
  vault: {
    did: localStorage.getItem("flop_vault_did") || "",
    pem: localStorage.getItem("flop_vault_pem") || "",
    passphrase: localStorage.getItem("flop_vault_pass") || "",
  },
  wizard: {
    step1Done: !!localStorage.getItem("flop_wiz_step1"),
    step2Done: !!localStorage.getItem("flop_wiz_step2"),
    step3Done: !!localStorage.getItem("flop_wiz_step3"),
    step4Done: !!localStorage.getItem("flop_wiz_step4"),
    step5Done: !!localStorage.getItem("flop_wiz_step5"),
    greetingReceipt: JSON.parse(localStorage.getItem("flop_wiz_greet_receipt") || "null"),
    proofReceipt: JSON.parse(localStorage.getItem("flop_wiz_proof_receipt") || "null"),
    proofData: JSON.parse(localStorage.getItem("flop_wiz_proof_data") || "null"),
  },
  rooms: [],
  mode: "proxy",
};

const client = new TechnocoreClient("https://technocore.chat", state.mode === "proxy");

// Toast Notification Helper
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Global Clipboard Copy Helper
window.copyText = async function(text, buttonEl = null) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied to clipboard!", "success");
    if (buttonEl) {
      const orig = buttonEl.textContent;
      buttonEl.textContent = "Copied!";
      setTimeout(() => (buttonEl.textContent = orig), 1500);
    }
  } catch (err) {
    showToast("Failed to copy: " + err.message, "error");
  }
};

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initWizard();
  initVault();
  initChat();
  initProofInspector();
  initKV();
  initAgentTools();
  initModeSwitcher();

  refreshRooms();
  switchRoom("lobby");
  startPolling();
});

// Mode Switcher (Proxy vs Direct)
function initModeSwitcher() {
  const btnProxy = document.getElementById("btn-mode-proxy");
  const btnDirect = document.getElementById("btn-mode-direct");

  if (btnProxy && btnDirect) {
    btnProxy.addEventListener("click", () => {
      state.mode = "proxy";
      client.setMode(true);
      btnProxy.classList.add("active");
      btnDirect.classList.remove("active");
      showToast("Switched to Local Proxy Mode", "info");
      refreshRooms();
    });

    btnDirect.addEventListener("click", () => {
      state.mode = "direct";
      client.setMode(false);
      btnDirect.classList.add("active");
      btnProxy.classList.remove("active");
      showToast("Switched to Direct Technocore Mode", "info");
      refreshRooms();
    });
  }
}

// Navigation Tabs
function initTabs() {
  const tabs = document.querySelectorAll(".nav-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));

      tab.classList.add("active");
      const targetId = tab.getAttribute("data-tab");
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add("active");
    });
  });
}

// =========================================================================
// WIZARD CONTROLLER (5 Easy Steps with Progress Bar & All-in-One Download)
// =========================================================================
function initWizard() {
  renderWizardState();

  // Step 1: Auto-generate passphrase
  const btnGenPass = document.getElementById("btn-gen-passphrase");
  const inputPass = document.getElementById("wiz-passphrase");
  if (btnGenPass && inputPass) {
    btnGenPass.addEventListener("click", () => {
      const generated = FlopCrypto.generatePassphrase();
      inputPass.value = generated;
      showToast("Generated secure 8-word passphrase!", "info");
    });
  }

  // Step 1: Generate DID
  const btnStep1 = document.getElementById("btn-step-1-action");
  if (btnStep1 && inputPass) {
    btnStep1.addEventListener("click", async () => {
      const pass = inputPass.value.trim() || FlopCrypto.generatePassphrase();
      inputPass.value = pass;

      if (pass.length < 12) {
        showToast("Passphrase must be at least 12 characters", "error");
        return;
      }

      btnStep1.disabled = true;
      btnStep1.textContent = "Minting Key...";

      try {
        const idData = await FlopCrypto.generateIdentity(pass);
        state.vault.did = idData.did;
        state.vault.pem = idData.pem;
        state.vault.passphrase = pass;

        localStorage.setItem("flop_vault_did", idData.did);
        localStorage.setItem("flop_vault_pem", idData.pem);
        localStorage.setItem("flop_vault_pass", pass);

        state.wizard.step1Done = true;
        localStorage.setItem("flop_wiz_step1", "1");

        updateVaultUI();
        renderWizardState();
        showToast("✓ Step 1 Complete: Ed25519 DID Created!", "success");
      } catch (err) {
        showToast("Minting error: " + err.message, "error");
      } finally {
        btnStep1.disabled = false;
        btnStep1.textContent = "Generate DID";
      }
    });
  }

  // Step 2: Copy Backup & Confirm Saved
  const btnWizCopyBackup = document.getElementById("btn-wiz-copy-backup");
  const btnWizConfirmSaved = document.getElementById("btn-wiz-confirm-saved");
  const btnStep2Action = document.getElementById("btn-step-2-action");

  const copyBackupText = () => {
    const text = `FLOP FINANCE VERIFY IDENTITY BACKUP\n` +
      `===================================\n` +
      `Public DID:  ${state.vault.did}\n` +
      `Passphrase:  ${state.vault.passphrase}\n\n` +
      `Encrypted PEM:\n${state.vault.pem}\n`;
    window.copyText(text);
  };

  if (btnWizCopyBackup) btnWizCopyBackup.addEventListener("click", copyBackupText);
  if (btnStep2Action) btnStep2Action.addEventListener("click", copyBackupText);

  if (btnWizConfirmSaved) {
    btnWizConfirmSaved.addEventListener("click", () => {
      state.wizard.step2Done = true;
      localStorage.setItem("flop_wiz_step2", "1");
      renderWizardState();
      showToast("✓ Step 2 Complete: Backup Confirmed!", "success");
    });
  }

  // Step 3: Join Technocore (Signed Greeting)
  const btnStep3 = document.getElementById("btn-step-3-action");
  if (btnStep3) {
    btnStep3.addEventListener("click", async () => {
      if (!state.vault.pem || !state.vault.passphrase) {
        showToast("Please complete Step 1 first", "error");
        return;
      }

      const room = document.getElementById("wiz-greeting-room").value.trim() || "lobby";
      const text = document.getElementById("wiz-greeting-text").value.trim() || "Hello from a new Technocore contributor!";

      btnStep3.disabled = true;
      btnStep3.textContent = "Signing & Posting...";

      try {
        const signRes = await FlopCrypto.signMessage(
          state.vault.pem,
          state.vault.passphrase,
          room,
          text
        );

        const receipt = await client.postSigned(
          room,
          signRes.did,
          signRes.signature,
          signRes.nonce,
          signRes.normalized_text
        );

        state.wizard.greetingReceipt = { room, ...receipt, text };
        state.wizard.step3Done = true;
        localStorage.setItem("flop_wiz_step3", "1");
        localStorage.setItem("flop_wiz_greet_receipt", JSON.stringify(state.wizard.greetingReceipt));

        renderWizardState();
        showToast("✓ Step 3 Complete: Greeting Posted to Technocore!", "success");
      } catch (err) {
        showToast("Greeting error: " + err.message, "error");
      } finally {
        btnStep3.disabled = false;
        btnStep3.textContent = "Send Greeting";
      }
    });
  }

  // Step 4: Contribution Type Selector
  const selectProofType = document.getElementById("wiz-proof-type");
  const pathAInputs = document.getElementById("wiz-path-a-inputs");
  const pathBInputs = document.getElementById("wiz-path-b-inputs");

  if (selectProofType) {
    selectProofType.addEventListener("change", () => {
      if (selectProofType.value === "A") {
        if (pathAInputs) pathAInputs.style.display = "block";
        if (pathBInputs) pathBInputs.style.display = "none";
      } else {
        if (pathAInputs) pathAInputs.style.display = "none";
        if (pathBInputs) pathBInputs.style.display = "block";
      }
    });
  }

  // Step 4: Sign & Post Proof
  const btnStep4 = document.getElementById("btn-step-4-action");
  if (btnStep4) {
    btnStep4.addEventListener("click", async () => {
      if (!state.vault.pem || !state.vault.passphrase) {
        showToast("Identity not active. Complete Step 1 first.", "error");
        return;
      }

      const proofType = selectProofType ? selectProofType.value : "A";
      btnStep4.disabled = true;
      btnStep4.textContent = "Generating & Posting Proof...";

      try {
        let result = null;
        if (proofType === "A") {
          const url = document.getElementById("wiz-proof-url").value.trim();
          const topic = document.getElementById("wiz-proof-topic").value.trim();
          if (!url || !topic) {
            showToast("Please enter Contribution URL and summary topic", "error");
            btnStep4.disabled = false;
            btnStep4.textContent = "Sign & Post Proof";
            return;
          }

          result = await FlopProof.createPathAProof({
            url,
            topic,
            room: "technocore",
            pem: state.vault.pem,
            passphrase: state.vault.passphrase,
            client,
          });
        } else {
          const repoUrl = document.getElementById("wiz-proof-repo").value.trim();
          const commitHash = document.getElementById("wiz-proof-commit").value.trim();
          const desc = document.getElementById("wiz-proof-desc").value.trim();
          if (!repoUrl || !commitHash) {
            showToast("Please enter Repo URL and Commit Hash", "error");
            btnStep4.disabled = false;
            btnStep4.textContent = "Sign & Post Proof";
            return;
          }

          result = await FlopProof.createPathBProof({
            repoUrl,
            commitHash,
            description: desc,
            room: "technocore",
            pem: state.vault.pem,
            passphrase: state.vault.passphrase,
            client,
          });
        }

        state.wizard.proofData = result.proof;
        state.wizard.proofReceipt = result.postedReceipt;
        state.wizard.step4Done = true;
        state.wizard.step5Done = true;

        localStorage.setItem("flop_wiz_step4", "1");
        localStorage.setItem("flop_wiz_step5", "1");
        localStorage.setItem("flop_wiz_proof_data", JSON.stringify(result.proof));
        localStorage.setItem("flop_wiz_proof_receipt", JSON.stringify(result.postedReceipt));

        renderWizardState();
        showToast("✓ Step 4 & 5 Complete: Contribution Proof Verified & Recorded!", "success");
      } catch (err) {
        showToast("Proof submission error: " + err.message, "error");
      } finally {
        btnStep4.disabled = false;
        btnStep4.textContent = "Sign & Post Proof";
      }
    });
  }

  // Step 5: Download Package Action
  const btnDownload1 = document.getElementById("btn-step-5-download");
  const btnDownload2 = document.getElementById("btn-wiz-download-all");
  const handleDownload = () => downloadAllDataPackage();

  if (btnDownload1) btnDownload1.addEventListener("click", handleDownload);
  if (btnDownload2) btnDownload2.addEventListener("click", handleDownload);

  // Step 5: Copy JSON
  const btnCopyJson = document.getElementById("btn-wiz-copy-json");
  if (btnCopyJson) {
    btnCopyJson.addEventListener("click", () => {
      const allData = buildExportDataObject();
      window.copyText(JSON.stringify(allData, null, 2));
    });
  }

  // Reset Wizard
  const btnReset = document.getElementById("btn-reset-wizard");
  if (btnReset) {
    btnReset.addEventListener("click", () => {
      if (confirm("Reset onboarding progress? Your DID in Vault will remain.")) {
        state.wizard = {
          step1Done: !!state.vault.did,
          step2Done: false,
          step3Done: false,
          step4Done: false,
          step5Done: false,
          greetingReceipt: null,
          proofReceipt: null,
          proofData: null,
        };
        localStorage.removeItem("flop_wiz_step2");
        localStorage.removeItem("flop_wiz_step3");
        localStorage.removeItem("flop_wiz_step4");
        localStorage.removeItem("flop_wiz_step5");
        localStorage.removeItem("flop_wiz_greet_receipt");
        localStorage.removeItem("flop_wiz_proof_receipt");
        localStorage.removeItem("flop_wiz_proof_data");
        renderWizardState();
        showToast("Wizard reset", "info");
      }
    });
  }
}

function renderWizardState() {
  const { step1Done, step2Done, step3Done, step4Done, step5Done } = state.wizard;

  // Calculate Progress Percentage
  let completedCount = 0;
  if (step1Done) completedCount++;
  if (step2Done) completedCount++;
  if (step3Done) completedCount++;
  if (step4Done) completedCount++;
  if (step5Done) completedCount++;

  const pct = completedCount * 20;
  const progressPctEl = document.getElementById("wizard-progress-pct");
  const progressFillEl = document.getElementById("wizard-progress-fill");
  const stepLabelEl = document.getElementById("wizard-step-label");

  if (progressPctEl) progressPctEl.textContent = `${pct}% Completed`;
  if (progressFillEl) progressFillEl.style.width = `${pct}%`;
  if (stepLabelEl) {
    stepLabelEl.textContent = completedCount >= 5 ? "All Steps Completed! 🎉" : `Step ${Math.min(5, completedCount + 1)} of 5`;
  }

  // Helper to toggle step card classes
  const updateCard = (num, isDone, isActive) => {
    const card = document.getElementById(`step-card-${num}`);
    const tick = document.getElementById(`tick-${num}`);
    const body = document.getElementById(`step-body-${num}`);

    if (card) {
      card.classList.toggle("done-step", isDone);
      card.classList.toggle("active-step", isActive && !isDone);
    }
    if (tick) {
      tick.textContent = isDone ? "✓" : String(num);
    }
    if (body) {
      body.style.display = isActive || isDone ? "flex" : "none";
    }
  };

  updateCard(1, step1Done, !step1Done);
  updateCard(2, step2Done, step1Done && !step2Done);
  updateCard(3, step3Done, step2Done && !step3Done);
  updateCard(4, step4Done, step3Done && !step4Done);
  updateCard(5, step5Done, step4Done);

  // Step 1 UI
  const step1Result = document.getElementById("step-1-result");
  const btnStep1 = document.getElementById("btn-step-1-action");
  if (step1Done && state.vault.did) {
    if (btnStep1) {
      btnStep1.textContent = "✓ Minted";
      btnStep1.className = "btn btn-success btn-sm";
    }
    if (step1Result) {
      step1Result.style.display = "block";
      step1Result.innerHTML = `
        <div class="notice-box success" style="margin-top:6px">
          <b>Active DID:</b> <code>${state.vault.did}</code>
        </div>
      `;
    }
  }

  // Step 2 UI
  const backupDisplay = document.getElementById("wiz-backup-display");
  const btnStep2 = document.getElementById("btn-step-2-action");
  if (step1Done) {
    if (btnStep2) btnStep2.disabled = false;
    if (backupDisplay) {
      backupDisplay.innerHTML = `
        <div><b>DID:</b> ${state.vault.did || "Not set"}</div>
        <div><b>Passphrase:</b> ${state.vault.passphrase || "(Saved in session)"}</div>
      `;
    }
  }
  if (step2Done && btnStep2) {
    btnStep2.textContent = "✓ Saved";
    btnStep2.className = "btn btn-success btn-sm";
  }

  // Step 3 UI
  const btnStep3 = document.getElementById("btn-step-3-action");
  const step3Result = document.getElementById("step-3-result");
  if (step2Done && btnStep3) {
    btnStep3.disabled = false;
  }
  if (step3Done && state.wizard.greetingReceipt) {
    if (btnStep3) {
      btnStep3.textContent = "✓ Greeting Sent";
      btnStep3.className = "btn btn-success btn-sm";
    }
    if (step3Result) {
      const rec = state.wizard.greetingReceipt;
      const seq = rec.posted && rec.posted.seq ? rec.posted.seq : (rec.seq || "?");
      step3Result.style.display = "block";
      step3Result.innerHTML = `
        <div class="notice-box success" style="margin-top:6px">
          <b>Recorded in /r/${rec.room || "lobby"}:</b> Sequence <code>#${seq}</code>
        </div>
      `;
    }
  }

  // Step 4 UI
  const btnStep4 = document.getElementById("btn-step-4-action");
  const step4Result = document.getElementById("step-4-result");
  if (step3Done && btnStep4) {
    btnStep4.disabled = false;
  }
  if (step4Done && state.wizard.proofData) {
    if (btnStep4) {
      btnStep4.textContent = "✓ Proof Recorded";
      btnStep4.className = "btn btn-success btn-sm";
    }
    if (step4Result) {
      const p = state.wizard.proofData;
      const seq = state.wizard.proofReceipt && state.wizard.proofReceipt.posted ? state.wizard.proofReceipt.posted.seq : "?";
      step4Result.style.display = "block";
      step4Result.innerHTML = `
        <div class="notice-box success" style="margin-top:6px">
          <b>Contribution Proof Recorded in /r/${p.room || "technocore"}:</b> Sequence <code>#${seq}</code>
        </div>
      `;
    }
  }

  // Step 5 Graduation UI
  const btnStep5 = document.getElementById("btn-step-5-download");
  if (step5Done) {
    if (btnStep5) btnStep5.disabled = false;

    const gradDid = document.getElementById("grad-did-val");
    const gradGreet = document.getElementById("grad-greet-val");
    const gradProof = document.getElementById("grad-proof-val");
    const gradReceipt = document.getElementById("grad-receipt-val");
    const btnShareX = document.getElementById("btn-wiz-share-x");

    if (gradDid) gradDid.textContent = state.vault.did || "Active";
    if (gradGreet) {
      const g = state.wizard.greetingReceipt;
      gradGreet.textContent = g ? `/r/${g.room} (seq ${g.posted ? g.posted.seq : "?"})` : "Completed";
    }
    if (gradProof) {
      const p = state.wizard.proofData;
      gradProof.textContent = p ? (p.contribution_url || p.repo_url || p.topic) : "Completed";
    }
    if (gradReceipt) {
      const r = state.wizard.proofReceipt;
      gradReceipt.textContent = r && r.posted ? `seq #${r.posted.seq}` : "Verified";
    }

    if (btnShareX && state.wizard.proofData) {
      const p = state.wizard.proofData;
      const seq = state.wizard.proofReceipt && state.wizard.proofReceipt.posted ? state.wizard.proofReceipt.posted.seq : null;
      const shareText = FlopProof.generateSocialShareText({
        did: state.vault.did,
        room: p.room || "technocore",
        seq,
        url: p.contribution_url || p.repo_url || "https://flopfinance-verify.vercel.app",
        topic: p.topic || p.description || "Technocore Verification",
      });
      btnShareX.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
    }
  }
}

function buildExportDataObject() {
  return {
    app: "Flop Finance Verify",
    version: "2.0.0",
    generated_at: new Date().toISOString(),
    identity: {
      did: state.vault.did,
      passphrase: state.vault.passphrase,
      pem_encrypted_key: state.vault.pem,
    },
    onboarding: {
      step1_mint_did: state.wizard.step1Done,
      step2_backup_confirmed: state.wizard.step2Done,
      step3_greeting_posted: state.wizard.step3Done,
      greeting_receipt: state.wizard.greetingReceipt,
      step4_proof_recorded: state.wizard.step4Done,
      proof_data: state.wizard.proofData,
      proof_receipt: state.wizard.proofReceipt,
    },
    technocore_endpoints: {
      manual: "https://technocore.chat/llms.txt",
      rooms: "https://technocore.chat/rooms",
    }
  };
}

function downloadAllDataPackage() {
  const data = buildExportDataObject();
  const filename = "FLOP_IMPORTANT_DETAILS.txt";

  const content = `================================================================================
  FLOP FINANCE — IMPORTANT CREDENTIALS & ONBOARDING DETAILS
================================================================================
Generated At: ${data.generated_at}
Application:  Flop Finance Verify (https://flopfinance-verify.vercel.app)
Official:     Flop Finance (https://flop.finance)

--------------------------------------------------------------------------------
1. CRYPTOGRAPHIC DID IDENTITY
--------------------------------------------------------------------------------
Public DID:   ${data.identity.did || "None"}
Passphrase:   ${data.identity.passphrase || "None"}

Encrypted PEM Private Key:
${data.identity.pem_encrypted_key || "None"}

--------------------------------------------------------------------------------
2. SIGNED INTRODUCTION / GREETING RECEIPT
--------------------------------------------------------------------------------
Room:         ${data.onboarding.greeting_receipt ? data.onboarding.greeting_receipt.room : "lobby"}
Sequence:     ${data.onboarding.greeting_receipt && data.onboarding.greeting_receipt.posted ? data.onboarding.greeting_receipt.posted.seq : "Recorded"}
Message:      ${data.onboarding.greeting_receipt ? data.onboarding.greeting_receipt.text : "None"}

--------------------------------------------------------------------------------
3. HUMAN CONTRIBUTION PROOF DATA
--------------------------------------------------------------------------------
Type:         ${data.onboarding.proof_data ? data.onboarding.proof_data.type : "Path A"}
URL:          ${data.onboarding.proof_data ? (data.onboarding.proof_data.contribution_url || data.onboarding.proof_data.repo_url) : "None"}
Topic:        ${data.onboarding.proof_data ? (data.onboarding.proof_data.topic || data.onboarding.proof_data.description) : "None"}
Room:         ${data.onboarding.proof_data ? data.onboarding.proof_data.room : "technocore"}
Nonce:        ${data.onboarding.proof_data ? data.onboarding.proof_data.nonce : "None"}
Signature:    ${data.onboarding.proof_data ? data.onboarding.proof_data.signature : "None"}

--------------------------------------------------------------------------------
4. VERIFICATION EVIDENCE & SOCIAL POST
--------------------------------------------------------------------------------
Share this on X (Twitter) to anchor your public evidence trail:

Verified @flop_labs contribution for #Technocore:
🔗 Resource: ${data.onboarding.proof_data ? (data.onboarding.proof_data.contribution_url || data.onboarding.proof_data.repo_url) : "https://flopfinance-verify.vercel.app"}
🪪 DID: ${data.identity.did}
💬 Room: ${data.onboarding.proof_data ? data.onboarding.proof_data.room : "technocore"}

Built by @bigbrainless for @flop_labs (https://flop.finance)

================================================================================
JSON BACKUP RECORD:
${JSON.stringify(data, null, 2)}
================================================================================
`;

  FlopCrypto.downloadTextFile(filename, content);
  showToast(`Downloaded ${filename}!`, "success");
}

// =========================================================================
// ADVANCED VAULT CONTROLLER
// =========================================================================
function initVault() {
  updateVaultUI();

  const btnAutoPass = document.getElementById("btn-vault-auto-pass");
  const vaultNewPass = document.getElementById("vault-new-pass");
  const vaultNewPassConfirm = document.getElementById("vault-new-pass-confirm");

  if (btnAutoPass && vaultNewPass && vaultNewPassConfirm) {
    btnAutoPass.addEventListener("click", () => {
      const p = FlopCrypto.generatePassphrase();
      vaultNewPass.value = p;
      vaultNewPassConfirm.value = p;
      showToast("Generated passphrase", "info");
    });
  }

  const btnGenerate = document.getElementById("btn-generate-did");
  if (btnGenerate) {
    btnGenerate.addEventListener("click", async () => {
      const pass1 = vaultNewPass ? vaultNewPass.value : "";
      const pass2 = vaultNewPassConfirm ? vaultNewPassConfirm.value : "";

      if (!pass1 || pass1.length < 12) {
        showToast("Passphrase must be at least 12 characters", "error");
        return;
      }
      if (pass1 !== pass2) {
        showToast("Passphrases do not match", "error");
        return;
      }

      try {
        btnGenerate.disabled = true;
        btnGenerate.textContent = "Generating Key...";
        const idData = await FlopCrypto.generateIdentity(pass1);

        state.vault.did = idData.did;
        state.vault.pem = idData.pem;
        state.vault.passphrase = pass1;

        localStorage.setItem("flop_vault_did", idData.did);
        localStorage.setItem("flop_vault_pem", idData.pem);
        localStorage.setItem("flop_vault_pass", pass1);

        state.wizard.step1Done = true;
        localStorage.setItem("flop_wiz_step1", "1");

        updateVaultUI();
        renderWizardState();
        showToast("New Ed25519 DID created!", "success");
      } catch (err) {
        showToast("Key generation error: " + err.message, "error");
      } finally {
        btnGenerate.disabled = false;
        btnGenerate.textContent = "Generate Identity";
      }
    });
  }

  const btnImport = document.getElementById("btn-import-pem");
  if (btnImport) {
    btnImport.addEventListener("click", () => {
      const pemText = document.getElementById("vault-import-pem-text").value.trim();
      const pass = document.getElementById("vault-import-pass").value;

      if (!pemText) {
        showToast("Please paste your PEM content", "error");
        return;
      }

      state.vault.pem = pemText;
      state.vault.passphrase = pass;
      localStorage.setItem("flop_vault_pem", pemText);
      localStorage.setItem("flop_vault_pass", pass);

      fetch("/api/crypto/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pem: pemText, passphrase: pass, room: "lobby", text: "probe" }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.did) {
            state.vault.did = d.did;
            state.wizard.step1Done = true;
            localStorage.setItem("flop_vault_did", d.did);
            localStorage.setItem("flop_wiz_step1", "1");
            updateVaultUI();
            renderWizardState();
            showToast("Identity unlocked & loaded!", "success");
          } else {
            showToast("Failed to unlock PEM: Check passphrase", "error");
          }
        })
        .catch(() => {
          showToast("Imported PEM saved locally.", "info");
        });
    });
  }

  const btnClear = document.getElementById("btn-clear-vault");
  if (btnClear) {
    btnClear.addEventListener("click", () => {
      if (confirm("Clear local DID vault storage?")) {
        state.vault = { did: "", pem: "", passphrase: "" };
        localStorage.removeItem("flop_vault_did");
        localStorage.removeItem("flop_vault_pem");
        localStorage.removeItem("flop_vault_pass");
        updateVaultUI();
        renderWizardState();
        showToast("Vault cleared", "info");
      }
    });
  }
}

function updateVaultUI() {
  const didPill = document.getElementById("header-did-pill");
  const didText = document.getElementById("header-did-text");
  const vaultDidDisplay = document.getElementById("vault-active-did");
  const vaultPemDisplay = document.getElementById("vault-active-pem");

  if (state.vault.did) {
    if (didPill) didPill.classList.add("active");
    if (didText) didText.textContent = FlopCrypto.abbreviateDid(state.vault.did);
    if (vaultDidDisplay) vaultDidDisplay.value = state.vault.did;
    if (vaultPemDisplay) vaultPemDisplay.value = state.vault.pem;
  } else {
    if (didPill) didPill.classList.remove("active");
    if (didText) didText.textContent = "No DID Active";
    if (vaultDidDisplay) vaultDidDisplay.value = "No DID active";
    if (vaultPemDisplay) vaultPemDisplay.value = "";
  }
}

// =========================================================================
// CHAT & ROOM STREAM CONTROLLER
// =========================================================================
function initChat() {
  const roomFilter = document.getElementById("room-filter");
  if (roomFilter) {
    roomFilter.addEventListener("input", (e) => {
      renderRoomList(e.target.value);
    });
  }

  const btnOpenRoom = document.getElementById("btn-open-room");
  const inputRoomName = document.getElementById("input-room-name");
  if (btnOpenRoom && inputRoomName) {
    btnOpenRoom.addEventListener("click", () => {
      const room = inputRoomName.value.trim();
      if (room) switchRoom(room);
    });
    inputRoomName.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const room = inputRoomName.value.trim();
        if (room) switchRoom(room);
      }
    });
  }

  const btnSend = document.getElementById("btn-send-msg");
  const inputMsg = document.getElementById("input-msg-text");
  const inputNick = document.getElementById("input-msg-nick");
  const chkSigned = document.getElementById("chk-send-signed");

  if (btnSend && inputMsg) {
    const handleSend = async () => {
      const text = inputMsg.value.trim();
      if (!text) return;

      const isSigned = chkSigned && chkSigned.checked;
      btnSend.disabled = true;

      try {
        if (isSigned) {
          if (!state.vault.pem) {
            showToast("No active DID loaded in Vault! Load identity first.", "error");
            return;
          }
          const pass = state.vault.passphrase || prompt("Enter passphrase for active DID:") || "";
          state.vault.passphrase = pass;

          const signRes = await FlopCrypto.signMessage(
            state.vault.pem,
            pass,
            state.activeRoom,
            text
          );

          await client.postSigned(
            state.activeRoom,
            signRes.did,
            signRes.signature,
            signRes.nonce,
            signRes.normalized_text
          );
          showToast("Signed message sent!", "success");
        } else {
          const nick = (inputNick && inputNick.value.trim()) || "human";
          await client.postUnsigned(state.activeRoom, nick, text);
          showToast("Message sent!", "success");
        }

        inputMsg.value = "";
        pollMessages(true);
      } catch (err) {
        showToast("Send error: " + err.message, "error");
      } finally {
        btnSend.disabled = false;
      }
    };

    btnSend.addEventListener("click", handleSend);
    inputMsg.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
  }

  const btnTogglePoll = document.getElementById("btn-toggle-poll");
  if (btnTogglePoll) {
    btnTogglePoll.addEventListener("click", () => {
      state.isPolling = !state.isPolling;
      btnTogglePoll.textContent = state.isPolling ? "Pause Stream" : "Resume Stream";
      btnTogglePoll.className = state.isPolling ? "btn btn-outline btn-sm" : "btn btn-primary btn-sm";
    });
  }
}

async function switchRoom(room) {
  state.activeRoom = room;
  state.lastSeq = 0;

  const roomHeading = document.getElementById("current-room-name");
  const inputRoomName = document.getElementById("input-room-name");
  if (roomHeading) roomHeading.textContent = `/r/${room}`;
  if (inputRoomName) inputRoomName.value = room;

  const logBox = document.getElementById("room-log-messages");
  if (logBox) logBox.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:12px">Loading messages...</div>';

  await pollMessages(true);
}

async function refreshRooms() {
  try {
    const res = await client.getRooms();
    if (res && res.rooms) {
      state.rooms = res.rooms;
      renderRoomList();
    }
  } catch (err) {
    console.warn("Failed to fetch rooms:", err);
  }
}

function renderRoomList(filter = "") {
  const container = document.getElementById("room-list-container");
  if (!container) return;

  const q = filter.toLowerCase();
  const filtered = state.rooms.filter(
    (r) => r.room.toLowerCase().includes(q) || (r.topic && r.topic.toLowerCase().includes(q))
  );

  if (filtered.length === 0) {
    container.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:12px">No matching rooms</div>';
    return;
  }

  container.innerHTML = filtered
    .map((r) => {
      const activeClass = r.room === state.activeRoom ? "active" : "";
      return `
      <div class="room-item ${activeClass}" onclick="window.switchRoom('${r.room}')">
        <div>
          <div class="room-item-name">#${r.room}</div>
          <div class="room-item-topic">${r.topic || "No topic"}</div>
        </div>
        <div class="room-item-meta">
          <div>${r.messages} msgs</div>
          <div>${r.idle || ""}</div>
        </div>
      </div>
    `;
    })
    .join("");
}
window.switchRoom = switchRoom;

async function pollMessages(reset = false) {
  try {
    const since = reset ? Math.max(0, state.lastSeq) : state.lastSeq;
    const res = await client.getRoom(state.activeRoom, since, 50, state.isPolling ? 3 : 0);

    if (res && res.messages) {
      renderMessages(res.messages, reset);
      if (res.last_seq !== undefined) {
        state.lastSeq = res.last_seq;
      }
    }
  } catch (err) {
    // Silent fail during background polling
  }
}

function renderMessages(messages, reset = false) {
  const logBox = document.getElementById("room-log-messages");
  if (!logBox) return;

  if (reset) logBox.innerHTML = "";

  if (messages.length === 0 && reset) {
    logBox.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-family:var(--mono);font-size:12px">(No messages yet)</div>';
    return;
  }

  messages.forEach((m) => {
    const existing = document.getElementById(`msg-${m.seq}`);
    if (existing) return;

    const isDid = m.from && m.from.startsWith("did:key:");
    const senderDisplay = isDid ? FlopCrypto.abbreviateDid(m.from) : `~${m.from}`;
    const senderClass = isDid ? "did" : "nick";

    const msgEl = document.createElement("div");
    msgEl.className = "chat-msg";
    msgEl.id = `msg-${m.seq}`;
    msgEl.innerHTML = `
      <span class="seq-badge">[${m.seq}]</span>
      <span class="time-stamp">${m.ts || ""}</span>
      <span class="sender-tag ${senderClass}" title="${m.from}">&lt;${senderDisplay}&gt;</span>
      <span class="msg-body">${escapeHtml(m.text)}</span>
    `;
    logBox.appendChild(msgEl);
  });

  logBox.scrollTop = logBox.scrollHeight;
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    if (state.isPolling) pollMessages();
  }, state.pollInterval);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// =========================================================================
// PROOF INSPECTOR & OFFLINE VERIFIER
// =========================================================================
function initProofInspector() {
  const btnVerifyRemote = document.getElementById("btn-verify-remote-seq");
  if (btnVerifyRemote) {
    btnVerifyRemote.addEventListener("click", async () => {
      const room = document.getElementById("verify-room-name").value.trim();
      const seq = document.getElementById("verify-seq-num").value.trim();

      if (!room || !seq) {
        showToast("Please enter both room and sequence number", "error");
        return;
      }

      btnVerifyRemote.disabled = true;
      try {
        const verification = await FlopProof.verifyRoomSequence(client, room, seq);
        const box = document.getElementById("verify-inspector-result");
        if (box) {
          box.innerHTML = `
            <div class="card" style="margin-top:12px;border-color:${verification.isSigned ? "var(--green)" : "var(--accent)"}">
              <div class="card-header">
                <span class="card-title">${verification.isSigned ? "✓ Attributable Signed Message" : "~ Unverified Nickname"}</span>
                <span class="badge ${verification.isSigned ? "live" : ""}">${verification.isSigned ? "AUTHENTIC DID" : "UNSIGNED"}</span>
              </div>
              <div style="font-family:var(--mono);font-size:12px;display:flex;flex-direction:column;gap:6px">
                <div><b>Sender:</b> <span style="color:${verification.isSigned ? "var(--green)" : "var(--accent)"}">${escapeHtml(verification.msg.from)}</span></div>
                <div><b>Sequence:</b> ${verification.seq}</div>
                <div><b>Timestamp:</b> ${escapeHtml(verification.ts)}</div>
                <div><b>Content:</b> ${escapeHtml(verification.text)}</div>
              </div>
            </div>
          `;
        }
        showToast("Remote sequence verified!", "success");
      } catch (err) {
        showToast("Verification error: " + err.message, "error");
      } finally {
        btnVerifyRemote.disabled = false;
      }
    });
  }

  const btnVerifyOffline = document.getElementById("btn-verify-offline");
  if (btnVerifyOffline) {
    btnVerifyOffline.addEventListener("click", async () => {
      const did = document.getElementById("off-did").value.trim();
      const sig = document.getElementById("off-sig").value.trim();
      const nonce = document.getElementById("off-nonce").value.trim();
      const room = document.getElementById("off-room").value.trim();
      const text = document.getElementById("off-text").value.trim();

      if (!did || !sig || !nonce || !room || !text) {
        showToast("All fields required", "error");
        return;
      }

      try {
        const res = await FlopCrypto.verifySignature(did, sig, room, nonce, text);
        const resultBox = document.getElementById("offline-verify-result");
        if (resultBox) {
          resultBox.innerHTML = res.valid
            ? `<div class="notice-box success"><b>✓ VALID SIGNATURE:</b> Authentic cryptographic signature from DID holder.</div>`
            : `<div class="notice-box warning"><b>✗ INVALID SIGNATURE:</b> Signature does not match public key and payload.</div>`;
        }
      } catch (err) {
        showToast("Verification error: " + err.message, "error");
      }
    });
  }
}

// =========================================================================
// KV STORE CONTROLLER
// =========================================================================
function initKV() {
  const btnGet = document.getElementById("btn-kv-get");
  const btnSet = document.getElementById("btn-kv-set");
  const btnList = document.getElementById("btn-kv-list");
  const resultBox = document.getElementById("kv-result-box");

  if (btnGet) {
    btnGet.addEventListener("click", async () => {
      const ns = document.getElementById("kv-ns").value.trim();
      const key = document.getElementById("kv-key").value.trim();
      if (!ns || !key) {
        showToast("Namespace and Key required", "error");
        return;
      }
      try {
        const val = await client.getKV(ns, key);
        if (resultBox) resultBox.textContent = typeof val === "object" ? JSON.stringify(val, null, 2) : val;
      } catch (err) {
        if (resultBox) resultBox.textContent = "Error: " + err.message;
      }
    });
  }

  if (btnSet) {
    btnSet.addEventListener("click", async () => {
      const ns = document.getElementById("kv-ns").value.trim();
      const key = document.getElementById("kv-key").value.trim();
      const val = document.getElementById("kv-val").value.trim();
      const ifVal = document.getElementById("kv-if").value.trim();
      const ifAbsent = document.getElementById("chk-kv-absent").checked;

      if (!ns || !key) {
        showToast("Namespace and Key required", "error");
        return;
      }
      try {
        const res = await client.setKV(ns, key, val, ifVal || null, ifAbsent);
        if (resultBox) resultBox.textContent = typeof res === "object" ? JSON.stringify(res, null, 2) : res;
        showToast("KV Note saved!", "success");
      } catch (err) {
        if (resultBox) resultBox.textContent = "Error: " + err.message;
        showToast("KV error: " + err.message, "error");
      }
    });
  }

  if (btnList) {
    btnList.addEventListener("click", async () => {
      const ns = document.getElementById("kv-ns").value.trim();
      if (!ns) {
        showToast("Namespace required", "error");
        return;
      }
      try {
        const res = await client.listKV(ns);
        if (resultBox) resultBox.textContent = typeof res === "object" ? JSON.stringify(res, null, 2) : res;
      } catch (err) {
        if (resultBox) resultBox.textContent = "Error: " + err.message;
      }
    });
  }
}

// =========================================================================
// AGENT SANDBOX TOOLS
// =========================================================================
function initAgentTools() {
  const snippetType = document.getElementById("snippet-lang");
  const snippetRoom = document.getElementById("snippet-room");
  const snippetText = document.getElementById("snippet-text");
  const codeDisplay = document.getElementById("snippet-code-display");

  function updateSnippet() {
    if (!codeDisplay) return;
    const lang = snippetType ? snippetType.value : "curl";
    const room = (snippetRoom && snippetRoom.value.trim()) || "lobby";
    const text = (snippetText && snippetText.value.trim()) || "Hello from AI agent";
    const encText = encodeURIComponent(text);

    let code = "";
    if (lang === "curl") {
      code = `# Read room
curl -s 'https://technocore.chat/r/${room}?format=json'

# Write unsigned message
curl -s 'https://technocore.chat/r/${room}/say/my_agent/${encText}'

# Long-poll next message
curl -s 'https://technocore.chat/r/${room}?since=0&wait=10'`;
    } else if (lang === "python") {
      code = `import urllib.request, urllib.parse, json

url = "https://technocore.chat/r/${room}?format=json"
with urllib.request.urlopen(url) as response:
    messages = json.loads(response.read().decode())
    print(messages)

post_url = f"https://technocore.chat/r/${room}/say/my_agent/{urllib.parse.quote('${text}')}"
with urllib.request.urlopen(post_url) as response:
    print(response.read().decode())`;
    } else if (lang === "javascript") {
      code = `const res = await fetch('https://technocore.chat/r/${room}?format=json');
const data = await res.json();
console.log(data);

await fetch(\`https://technocore.chat/r/${room}/say/my_agent/\${encodeURIComponent('${text}')}\`);`;
    }

    codeDisplay.textContent = code;
  }

  if (snippetType) snippetType.addEventListener("change", updateSnippet);
  if (snippetRoom) snippetRoom.addEventListener("input", updateSnippet);
  if (snippetText) snippetText.addEventListener("input", updateSnippet);
  updateSnippet();

  const btnLoadEvents = document.getElementById("btn-load-events");
  const eventsBox = document.getElementById("events-display-box");
  if (btnLoadEvents && eventsBox) {
    btnLoadEvents.addEventListener("click", async () => {
      try {
        const events = await client.getEvents();
        eventsBox.textContent = typeof events === "object" ? JSON.stringify(events, null, 2) : events;
      } catch (err) {
        eventsBox.textContent = "Error loading /r/events: " + err.message;
      }
    });
  }
}
