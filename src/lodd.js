import { t } from "./i18n.js";

const NOTIFY_NUMBER = "+4740343295";
const WAITLIST_KEY = "lodd:pt-waitlist";

const form = document.getElementById("signup-form");
const nameInput = document.getElementById("pt-name");
const phoneInput = document.getElementById("pt-phone");
const statusEl = document.querySelector("[data-pt-status]");

function iOSFamily() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function smsHref(body) {
  const text = encodeURIComponent(body);
  return iOSFamily()
    ? `sms:${NOTIFY_NUMBER}&body=${text}`
    : `sms:${NOTIFY_NUMBER}?body=${text}`;
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

function remember(name, phone) {
  try {
    const prev = JSON.parse(localStorage.getItem(WAITLIST_KEY) || "[]");
    prev.push({ name, phone, at: new Date().toISOString() });
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

function syncFilled() {
  for (const el of [nameInput, phoneInput]) {
    if (!el) continue;
    el.toggleAttribute("data-filled", Boolean(String(el.value).trim()));
  }
}

syncFilled();
nameInput?.addEventListener("input", syncFilled);
phoneInput?.addEventListener("input", syncFilled);
requestAnimationFrame(syncFilled);

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = String(nameInput?.value || "").trim();
  const phone = normalizePhone(phoneInput?.value);

  if (!name || !phone) {
    setStatus(t("missing"));
    (!name ? nameInput : phoneInput)?.focus();
    return;
  }

  remember(name, phone);
  setStatus(t("opening"));
  window.location.href = smsHref(
    `lodd.ai signup\n${t("smsName")}: ${name}\n${t("smsPhone")}: ${phone}`,
  );
});
