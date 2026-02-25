const flattenIconBtn = document.getElementById("flatten-icon") as HTMLButtonElement;
const extractBtn     = document.getElementById("extract")      as HTMLButtonElement;
const copyBtn        = document.getElementById("copy")         as HTMLButtonElement;
const output         = document.getElementById("output")       as HTMLTextAreaElement;
const statusEl       = document.getElementById("status")       as HTMLDivElement;

const optOutlineStrokes     = document.getElementById("opt-outline-strokes")          as HTMLInputElement;
const optStrokeAlignCenter  = document.getElementById("opt-stroke-align-center")      as HTMLInputElement;
const optStrokePreserveOrig = document.getElementById("opt-stroke-preserve-original") as HTMLInputElement;
const optFlatten            = document.getElementById("opt-flatten")                   as HTMLInputElement;
const optFixWinding         = document.getElementById("opt-fix-winding")               as HTMLInputElement;
const optPrecision          = document.getElementById("opt-precision")                 as HTMLInputElement;
const optDebugSvg           = document.getElementById("opt-debug-svg")                as HTMLInputElement;
const strokeSubOpts         = document.getElementById("stroke-sub-opts")!;
const debugSvgPanel         = document.getElementById("debug-svg-panel")!             as HTMLDetailsElement;
const debugSvgOutput        = document.getElementById("debug-svg-output")             as HTMLTextAreaElement;
const debugToggle           = document.getElementById("debug-toggle")!                as HTMLSpanElement;
const debugSection          = document.getElementById("debug-section")!               as HTMLDivElement;
const debugLog              = document.getElementById("debug-log")!                   as HTMLPreElement;

debugToggle.addEventListener("click", () => {
  const hidden = debugSection.style.display === "none";
  debugSection.style.display = hidden ? "block" : "none";
  debugToggle.textContent = hidden ? "hide debug log" : "show debug log";
});

let logHasEntries = false;
function appendLog(text: string) {
  if (!text) return;
  if (!logHasEntries) {
    debugLog.textContent = "";
    logHasEntries = true;
  }
  const ts = new Date().toLocaleTimeString();
  debugLog.textContent += `[${ts}]\n${text}\n\n`;
  debugLog.scrollTop = debugLog.scrollHeight;
}

// ── Stroke sub-options visibility ─────────────────────────────────────────────
optOutlineStrokes.addEventListener("change", () => {
  strokeSubOpts.classList.toggle("hidden", !optOutlineStrokes.checked);
});

optDebugSvg.addEventListener("change", () => {
  if (!optDebugSvg.checked) debugSvgPanel.style.display = "none";
});

function setWorking(label: string) {
  flattenIconBtn.disabled = true;
  extractBtn.disabled     = true;
  copyBtn.disabled        = true;
  statusEl.className      = "";
  statusEl.textContent    = label;
}

function getPrecision() {
  return Math.max(1, Math.min(6, parseInt(optPrecision.value, 10) || 3));
}

// ── Flatten Icon — destructive, mutates the original frame ───────────────────
flattenIconBtn.addEventListener("click", () => {
  setWorking("Flattening…");
  // Don't clear output — this operation doesn't produce path data
  parent.postMessage({
    pluginMessage: {
      type: "flatten-icon",
      options: { precision: getPrecision(), debugSvg: optDebugSvg.checked },
    },
  }, "*");
});

// ── Extract Path Data ─────────────────────────────────────────────────────────
extractBtn.addEventListener("click", () => {
  setWorking("Working…");
  output.value = "";
  parent.postMessage({
    pluginMessage: {
      type: "extract",
      options: {
        outlineStrokes:         optOutlineStrokes.checked,
        strokeAlignCenter:      optStrokeAlignCenter.checked,
        strokePreserveOriginal: optStrokePreserveOrig.checked,
        flatten:                optFlatten.checked,
        fixWinding:             optFixWinding.checked,
        precision:              getPrecision(),
        debugSvg:               optDebugSvg.checked,
      },
    },
  }, "*");
});

// ── Copy ──────────────────────────────────────────────────────────────────────
copyBtn.addEventListener("click", () => {
  const text = output.value;
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => { statusEl.className = "success"; statusEl.textContent = "✓ Copied!"; })
      .catch((err) => { statusEl.className = "error"; statusEl.textContent = "✗ Copy failed: " + err; });
  } else {
    output.select();
    document.execCommand("copy");
    statusEl.className = "success";
    statusEl.textContent = "✓ Copied!";
  }
});

// ── Messages from sandbox ─────────────────────────────────────────────────────
window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage;
  if (!msg) return;

  if (msg.type === "flatten-done") {
    flattenIconBtn.disabled = false;
    extractBtn.disabled     = false;
    statusEl.className      = "success";
    statusEl.textContent    = `✓ "${msg.name}" flattened — groups removed, strokes outlined, shapes merged.`;
    if (msg.log) appendLog(msg.log as string);

  } else if (msg.type === "ready") {
    output.value            = msg.pathData as string;
    copyBtn.disabled        = false;
    extractBtn.disabled     = false;
    flattenIconBtn.disabled = false;
    statusEl.className      = "success";
    statusEl.textContent    = `✓ Ready — fill-rule: ${msg.fillRule || "nonzero"}`;
    if (msg.log) appendLog(msg.log as string);

  } else if (msg.type === "debug-svg") {
    debugSvgOutput.value        = msg.svg as string;
    debugSvgPanel.style.display = "block";
    debugSvgPanel.open          = true;

  } else if (msg.type === "error") {
    extractBtn.disabled     = false;
    flattenIconBtn.disabled = false;
    copyBtn.disabled        = true;
    statusEl.className      = "error";
    statusEl.textContent    = "✗ " + (msg.message ?? "Unknown error");
    if (msg.log) appendLog(msg.log as string);
  }
};
