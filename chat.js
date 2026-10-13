/**
 * chat.js – Aroma Bakery AI Inventory Assistant
 * Connects the chat UI to a local Langflow API endpoint.
 *
 * Langflow endpoint format:
 *   POST http://localhost:7860/api/v1/run/<FLOW_ID>
 */

const LANGFLOW_BASE_URL = "http://localhost:7860";
const FLOW_ID           = "60164c42-ba90-4ec1-b660-d9e02a6d888b";
const API_URL           = `${LANGFLOW_BASE_URL}/api/v1/run/${FLOW_ID}`;
const LANGFLOW_API_KEY  = "sk-H5FZOFv2laWFWIn24llAaamBOLPyhSl61FXugZTpmU8";

// ⚠️  Ganti dengan nama component "Prompt" di Langflow flow kamu.
//     Cara lihat: buka flow → klik node Prompt → lihat header node, contoh "Prompt-abc12"
const PROMPT_COMPONENT_ID = "Prompt-XXXXX"; // ← ganti ini

// Path ke file CSV stok (relatif dari index.html)
const STOK_CSV_PATH = "stok-aroma.txt";

/* ------------------------------------------------------------------ */
/*  DOM References                                                      */
/* ------------------------------------------------------------------ */
const chatMessages  = document.getElementById("chatMessages");
const chatInput     = document.getElementById("chatInput");
const sendBtn       = document.getElementById("sendBtn");

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Format jam HH:MM */
function getTime() {
  return new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Render satu bubble pesan ke area chat.
 * @param {"bot"|"user"} role
 * @param {string} text  – bisa berisi HTML sederhana
 * @returns {HTMLElement} elemen bubble yang dibuat
 */
function appendMessage(role, text) {
  const msg = document.createElement("div");
  msg.classList.add("msg", role);

  const bubble = document.createElement("div");
  bubble.classList.add("bubble");
  bubble.innerHTML = text; // innerHTML agar newline/bold dari bot bisa ditampilkan

  const time = document.createElement("span");
  time.classList.add("msg-time");
  time.textContent = getTime();

  msg.appendChild(bubble);
  msg.appendChild(time);
  chatMessages.appendChild(msg);
  scrollToBottom();
  return msg;
}

/** Tampilkan animasi "bot sedang mengetik" */
function showTyping() {
  const msg = document.createElement("div");
  msg.classList.add("msg", "bot");
  msg.id = "typingIndicator";

  const bubble = document.createElement("div");
  bubble.classList.add("bubble", "typing-indicator");
  bubble.innerHTML = "<span></span><span></span><span></span>";

  msg.appendChild(bubble);
  chatMessages.appendChild(msg);
  scrollToBottom();
}

/** Hapus animasi typing */
function removeTyping() {
  const el = document.getElementById("typingIndicator");
  if (el) el.remove();
}

/** Scroll ke bawah area pesan */
function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Sanitasi teks biasa → HTML (escape karakter berbahaya, ubah \n → <br>).
 * Langflow kadang mengembalikan teks biasa atau markdown sederhana.
 */
function formatBotText(raw) {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") // **bold**
    .replace(/\n/g, "<br>");
}

/* ------------------------------------------------------------------ */
/*  CSV Loader                                                          */
/* ------------------------------------------------------------------ */

/** Cache agar tidak fetch berulang kali */
let _stokCache = null;

/**
 * Fetch dan parse CSV stok, kembalikan sebagai string tabel rapi.
 * Format output:
 *   Tanggal     | Cabang   | Nama Roti        | Dikirim | Terjual | Sisa
 *   2026-10-13  | Halat    | Roti Cokelat     | 50      | 10      | 40
 *   ...
 */
async function loadStokData() {
  if (_stokCache) return _stokCache;

  try {
    const res = await fetch(STOK_CSV_PATH);
    if (!res.ok) throw new Error(`Gagal memuat ${STOK_CSV_PATH}: HTTP ${res.status}`);

    const raw  = await res.text();
    const rows = raw.trim().split("\n").map(r => r.trim()).filter(Boolean);

    // Konversi CSV ke tabel teks rapi (aligned dengan separator |)
    const parsed = rows.map(r => r.split(",").map(c => c.trim()));
    const cols   = parsed[0].length;

    // Hitung lebar maksimum tiap kolom
    const widths = Array.from({ length: cols }, (_, i) =>
      Math.max(...parsed.map(r => (r[i] || "").length))
    );

    const pad = (str, w) => String(str || "").padEnd(w);
    const sep = widths.map(w => "-".repeat(w)).join("-+-");

    const tableLines = parsed.map((r, idx) => {
      const line = r.map((c, i) => pad(c, widths[i])).join(" | ");
      return idx === 0 ? line + "\n" + sep : line;
    });

    _stokCache = tableLines.join("\n");
    return _stokCache;
  } catch (err) {
    console.warn("[StokLoader]", err.message);
    // Fallback: kembalikan pesan error agar AI tahu data tidak tersedia
    return "(Data stok tidak dapat dimuat. Periksa file " + STOK_CSV_PATH + ")";
  }
}


/* ------------------------------------------------------------------ */
/*  Langflow API Call                                                   */
/* ------------------------------------------------------------------ */

/**
 * Kirim pesan ke Langflow.
 * Data stok di-inject ke Prompt component via tweaks agar
 * placeholder {data_stok} dan {pertanyaan} terisi dengan benar.
 */
async function callLangflow(userMessage) {
  const headers = {
    "Content-Type": "application/json",
    ...(LANGFLOW_API_KEY ? { "x-api-key": LANGFLOW_API_KEY } : {}),
  };

  // Load dan inject data stok ke tweaks
  const dataStok = await loadStokData();

  const body = {
    input_value: userMessage,   // mengisi {pertanyaan} via Chat Input node
    output_type: "chat",
    input_type:  "chat",
    tweaks: {
      // Inject {data_stok} langsung ke Prompt component.
      // Ganti PROMPT_COMPONENT_ID dengan ID node Prompt di flow kamu.
      [PROMPT_COMPONENT_ID]: {
        data_stok: dataStok,
      },
    },
  };

  const response = await fetch(API_URL, {
    method:  "POST",
    headers: headers,
    body:    JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errText}`);
  }

  const data = await response.json();

  /*
   * Langflow v1 run response structure:
   * {
   *   "outputs": [{
   *     "outputs": [{
   *       "results": { "message": { "text": "..." } }
   *     }]
   *   }]
   * }
   * Kita ekstrak teks dari sini, dengan fallback aman.
   */
  try {
    const text =
      data?.outputs?.[0]?.outputs?.[0]?.results?.message?.text ||
      data?.outputs?.[0]?.outputs?.[0]?.messages?.[0]?.message ||
      data?.outputs?.[0]?.outputs?.[0]?.artifacts?.message ||
      "Maaf, saya tidak mendapat respons yang valid dari server.";
    return text;
  } catch {
    return "Maaf, format respons tidak dikenali.";
  }
}

/* ------------------------------------------------------------------ */
/*  Send Message Handler                                                */
/* ------------------------------------------------------------------ */

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  // Tampilkan pesan user
  appendMessage("user", text);
  chatInput.value = "";
  chatInput.style.height = "auto";
  sendBtn.disabled = true;

  // Tampilkan indikator typing
  showTyping();

  try {
    const reply = await callLangflow(text);
    removeTyping();
    appendMessage("bot", formatBotText(reply));
  } catch (err) {
    removeTyping();
    appendMessage(
      "bot",
      `⚠️ Gagal menghubungi server AI.<br><small style="opacity:.7">${err.message}</small>`
    );
    console.error("[Langflow Error]", err);
  } finally {
    sendBtn.disabled = false;
    chatInput.focus();
  }
}

/* ------------------------------------------------------------------ */
/*  Event Listeners                                                     */
/* ------------------------------------------------------------------ */

// Tombol kirim
sendBtn.addEventListener("click", sendMessage);

// Enter untuk kirim (Shift+Enter = baris baru)
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + "px";
});

/* ------------------------------------------------------------------ */
/*  Quick-Prompt Chips                                                  */
/* ------------------------------------------------------------------ */

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    chatInput.value = chip.dataset.prompt;
    chatInput.dispatchEvent(new Event("input")); // trigger auto-resize
    chatInput.focus();
  });
});

/* ------------------------------------------------------------------ */
/*  Pesan Sambutan (Welcome Message)                                    */
/* ------------------------------------------------------------------ */

window.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    appendMessage(
      "bot",
      "👋 Halo! Saya <strong>Aroma AI</strong>, asisten inventaris pintar Aroma Bakery.<br>" +
        "Tanyakan apa saja tentang stok roti, rekomendasi restok, atau laporan cabang. 🍞"
    );
  }, 600);
});
