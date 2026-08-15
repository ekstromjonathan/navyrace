const PT_NUMBER = "+14044465379";
const WAITLIST_KEY = "lodd:pt-waitlist";

const sheet = document.getElementById("pt-sheet");
const openBtn = document.querySelector("[data-open-pt]");
const form = sheet?.querySelector("form");
const phoneInput = document.getElementById("pt-phone");
const statusEl = document.querySelector("[data-pt-status]");

function iOSFamily() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function smsHref(body) {
  const text = encodeURIComponent(body);
  return iOSFamily()
    ? `sms:${PT_NUMBER}&body=${text}`
    : `sms:${PT_NUMBER}?body=${text}`;
}

function normalizePhone(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("47") && digits.length >= 10) return `+${digits}`;
  if (digits.length === 8) return `+47${digits}`;
  return digits;
}

function remember(phone) {
  try {
    const prev = JSON.parse(localStorage.getItem(WAITLIST_KEY) || "[]");
    prev.push({ phone, at: new Date().toISOString() });
    localStorage.setItem(WAITLIST_KEY, JSON.stringify(prev.slice(-20)));
  } catch {
    /* private mode — signup still opens Messages */
  }
}

function setStatus(text) {
  if (!statusEl) return;
  statusEl.hidden = !text;
  statusEl.textContent = text;
}

openBtn?.addEventListener("click", () => {
  setStatus("");
  sheet.showModal();
  queueMicrotask(() => phoneInput?.focus());
});

sheet?.addEventListener("click", (event) => {
  if (event.target === sheet) sheet.close();
});

form?.addEventListener("submit", (event) => {
  const submitter = event.submitter;
  if (submitter?.value === "cancel") return;

  event.preventDefault();
  const phone = normalizePhone(phoneInput?.value);
  if (phone) remember(phone);

  const greeting = phone
    ? `Hei, jeg vil starte med PT. Nummeret mitt er ${phone}.`
    : "Hei, jeg vil starte med PT.";

  setStatus("Åpner Meldinger…");
  window.location.href = smsHref(greeting);
});
