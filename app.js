/* ==========================================================================
   Seva Circle – AI assistant (proof of concept)
   - "Chat" tab : a helper that answers visitors' questions about the NGO.
   - "Edit page" tab : you describe a change in plain English, the AI returns
     a small JSON list of actions, and this script applies them to the page.
   Providers (pick in ⚙ settings):
     1. Puter.js   – free, no API key; visitor signs in to a free Puter account
                     on first use ("user pays" model, so you pay nothing).
     2. OpenRouter – free ":free" models / the "openrouter/free" router;
                     needs your own key, kept only in the browser.
   ========================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const STORE = { settings: "seva-ai-settings", edits: "seva-page-edits" };
const THEME_VARS = ["--primary", "--primary-ink", "--accent", "--bg", "--surface", "--ink", "--muted", "--radius", "--font"];

const safeGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const safeDel = (k) => { try { localStorage.removeItem(k); } catch {} };

let settings = Object.assign({ provider: "puter", model: "", apiKey: "" }, safeGet(STORE.settings) || {});
let mode = "chat";
const history = { chat: [], edit: [] };
const undoStack = [];

/* ------------------------------------------------------------------ AI call */

function loadPuter() {
  if (window.puter) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://js.puter.com/v2/";
    s.onload = () => res();
    s.onerror = () => rej(new Error("Could not load Puter.js (blocked network or offline)."));
    document.head.appendChild(s);
  });
}

function extractText(resp) {
  if (typeof resp === "string") return resp;
  const c = resp?.message?.content ?? resp?.choices?.[0]?.message?.content ?? resp?.text;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => p.text || "").join("");
  return String(resp ?? "");
}

async function callAI(messages) {
  if (settings.provider === "openrouter") {
    if (!settings.apiKey) throw new Error("Add your OpenRouter API key in ⚙ settings (free at openrouter.ai/keys).");
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + settings.apiKey,
        "Content-Type": "application/json",
        "HTTP-Referer": location.origin,
        "X-Title": "Seva Circle AI POC",
      },
      body: JSON.stringify({ model: settings.model || "openrouter/free", messages }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error?.message || `OpenRouter error ${r.status}`);
    return extractText(data);
  }
  // Default: Puter.js (free, no key)
  await loadPuter();
  const opts = settings.model ? { model: settings.model } : undefined;
  const resp = await puter.ai.chat(messages, opts);
  return extractText(resp);
}

/* ------------------------------------------------------ page introspection */

function pageSummary() {
  const parts = [];
  $$("[data-edit]").forEach((el) => parts.push(el.textContent.trim()));
  programCards().forEach((p) => parts.push(`Program: ${p.title} – ${p.description}`));
  return parts.join("\n").slice(0, 4000);
}

function programCards() {
  return $$("#programCards .card").map((c) => ({
    icon: $(".icon", c)?.textContent || "",
    title: $("h3", c)?.textContent || "",
    description: $("p", c)?.textContent || "",
  }));
}

function editableState() {
  const texts = {};
  $$("[data-edit]").forEach((el) => (texts[el.dataset.edit] = el.textContent.trim()));
  const cs = getComputedStyle(document.documentElement);
  const theme = {};
  THEME_VARS.forEach((v) => (theme[v] = cs.getPropertyValue(v).trim()));
  return { texts, theme, programs: programCards() };
}

/* ---------------------------------------------------------------- prompts */

function chatSystemPrompt() {
  return `You are the friendly volunteer helper on the website of "${$('[data-edit="brand-name"]').textContent}", a community volunteering NGO.
Answer visitors' questions briefly (2-5 sentences), warmly, and based on the page content below. If something isn't on the page, say so and suggest using the sign-up form.

PAGE CONTENT:
${pageSummary()}`;
}

function editSystemPrompt() {
  return `You are a website editing assistant. The user describes changes to their web page; you respond with ONLY a JSON object, no markdown fences, in this exact shape:
{"reply": "<one short sentence describing what you changed>", "actions": [ ... ]}

Allowed actions:
- {"type":"setText","id":"<one of the text ids below>","value":"<new text>"}
- {"type":"setTheme","var":"<one of the theme variables below>","value":"<CSS value, e.g. #2e7d32 or 20px or 'Georgia, serif'>"}
- {"type":"addProgram","icon":"<one emoji>","title":"<title>","description":"<one sentence>"}
- {"type":"updateProgram","index":<0-based>,"icon":"...","title":"...","description":"..."}   (include only the fields to change)
- {"type":"removeProgram","index":<0-based>}

Rules: use only the ids/vars listed. Keep colors readable (good contrast). If the request is unclear or impossible, return "actions": [] and explain in "reply".

CURRENT PAGE STATE:
${JSON.stringify(editableState(), null, 2)}`;
}

/* ------------------------------------------------------------- apply edits */

function flash(el) { el.classList.remove("ai-flash"); void el.offsetWidth; el.classList.add("ai-flash"); }

function makeCard({ icon = "✨", title = "", description = "" }) {
  const a = document.createElement("article");
  a.className = "card";
  const i = document.createElement("div"); i.className = "icon"; i.textContent = icon;
  const h = document.createElement("h3"); h.textContent = title;
  const p = document.createElement("p"); p.textContent = description;
  a.append(i, h, p);
  return a;
}

function validCss(v, value) {
  value = String(value).replace(/[;{}<>]/g, "").trim();
  if (!value) return null;
  if (v === "--radius") return CSS.supports("border-radius", value) ? value : null;
  if (v === "--font") return CSS.supports("font-family", value) ? value : null;
  return CSS.supports("color", value) ? value : null;
}

function applyActions(actions) {
  const done = [];
  for (const a of actions || []) {
    try {
      if (a.type === "setText") {
        const el = $(`[data-edit="${CSS.escape(a.id)}"]`);
        if (el && typeof a.value === "string") { el.textContent = a.value; flash(el); done.push(`text "${a.id}"`); }
      } else if (a.type === "setTheme" && THEME_VARS.includes(a.var)) {
        const val = validCss(a.var, a.value);
        if (val) { document.documentElement.style.setProperty(a.var, val); done.push(`${a.var} → ${val}`); }
      } else if (a.type === "addProgram") {
        const card = makeCard(a); $("#programCards").appendChild(card); flash(card); done.push(`added "${a.title}"`);
      } else if (a.type === "updateProgram") {
        const card = $$("#programCards .card")[a.index];
        if (card) {
          if (a.icon) $(".icon", card).textContent = a.icon;
          if (a.title) $("h3", card).textContent = a.title;
          if (a.description) $("p", card).textContent = a.description;
          flash(card); done.push(`updated program #${a.index + 1}`);
        }
      } else if (a.type === "removeProgram") {
        const card = $$("#programCards .card")[a.index];
        if (card) { card.remove(); done.push(`removed program #${a.index + 1}`); }
      }
    } catch (e) { console.warn("Skipped action", a, e); }
  }
  return done;
}

function parseJson(text) {
  const clean = text.replace(/```(?:json)?/gi, "");
  const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
  if (s < 0 || e < s) return null;
  try { return JSON.parse(clean.slice(s, e + 1)); } catch { return null; }
}

/* -------------------------------------------------- snapshot / save / undo */

function snapshot() {
  const st = editableState();
  const inline = {};
  THEME_VARS.forEach((v) => { const x = document.documentElement.style.getPropertyValue(v); if (x) inline[v] = x; });
  return { texts: st.texts, theme: inline, programs: st.programs };
}

function restore(snap) {
  if (!snap) return;
  Object.entries(snap.texts || {}).forEach(([k, v]) => { const el = $(`[data-edit="${CSS.escape(k)}"]`); if (el) el.textContent = v; });
  THEME_VARS.forEach((v) => document.documentElement.style.removeProperty(v));
  Object.entries(snap.theme || {}).forEach(([k, v]) => THEME_VARS.includes(k) && document.documentElement.style.setProperty(k, v));
  if (Array.isArray(snap.programs)) $("#programCards").replaceChildren(...snap.programs.map(makeCard));
}

function exportHtml() {
  const clone = document.documentElement.cloneNode(true);
  $("#panel", clone)?.classList.remove("open");
  $("#messages", clone)?.replaceChildren();
  $$("[src*='js.puter.com']", clone).forEach((n) => n.remove());
  $$(".ai-flash", clone).forEach((n) => n.classList.remove("ai-flash"));
  const html = "<!doctype html>\n" + clone.outerHTML;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "index.html" });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* --------------------------------------------------------------------- UI */

function addMsg(role, text, extra) {
  const d = document.createElement("div");
  d.className = "msg " + role;
  d.textContent = text;
  if (extra) { const c = document.createElement("div"); c.className = "changes"; c.textContent = extra; d.appendChild(c); }
  $("#messages").appendChild(d);
  $("#messages").scrollTop = 1e9;
  return d;
}

function renderMode() {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
  $("#editTools").hidden = mode !== "edit";
  $("#hint").textContent = mode === "chat"
    ? "Ask anything about our programs, volunteering or how to join."
    : 'Describe a change, e.g. "make the theme green", "change the headline to Volunteer this Sunday", "add a program for elderly care".';
  $("#input").placeholder = mode === "chat" ? "Ask our AI helper…" : "Describe a change to this page…";
  $("#messages").replaceChildren();
  history[mode].forEach((m) => addMsg(m.role === "user" ? "user" : "ai", m.display ?? m.content, m.changes));
  if (!history[mode].length) addMsg("sys", providerLabel());
}

function providerLabel() {
  return settings.provider === "openrouter"
    ? `Using OpenRouter · ${settings.model || "openrouter/free"}`
    : `Using Puter.js (free) · ${settings.model || "default model"} — first use may ask you to sign in to Puter.`;
}

function openPanel() { $("#panel").classList.add("open"); $("#panel").setAttribute("aria-hidden", "false"); $("#fab").hidden = true; renderMode(); $("#input").focus(); }
function closePanel() { $("#panel").classList.remove("open"); $("#panel").setAttribute("aria-hidden", "true"); $("#fab").hidden = false; }

async function send(text) {
  const btn = $("#send");
  btn.disabled = true;
  history[mode].push({ role: "user", content: text });
  addMsg("user", text);
  const typing = addMsg("ai", "Thinking");
  typing.classList.add("typing");

  try {
    if (mode === "chat") {
      const msgs = [{ role: "system", content: chatSystemPrompt() }, ...history.chat.slice(-10).map(({ role, content }) => ({ role, content }))];
      const reply = (await callAI(msgs)).trim();
      typing.remove();
      history.chat.push({ role: "assistant", content: reply });
      addMsg("ai", reply);
    } else {
      // Edit mode: send only the latest instruction plus fresh page state (keeps prompts small & accurate)
      const msgs = [{ role: "system", content: editSystemPrompt() }, { role: "user", content: text }];
      const raw = await callAI(msgs);
      typing.remove();
      const json = parseJson(raw);
      if (!json) {
        history.edit.push({ role: "assistant", content: raw });
        addMsg("err", "The model didn't return valid JSON, so nothing was changed. Try rephrasing or switch model.\n\n" + raw.slice(0, 400));
      } else {
        undoStack.push(snapshot());
        const done = applyActions(json.actions);
        if (!done.length) undoStack.pop();
        const changes = done.length ? "Changed: " + done.join(", ") : "No changes applied.";
        history.edit.push({ role: "assistant", content: raw, display: json.reply || "Done.", changes });
        addMsg("ai", json.reply || "Done.", changes);
      }
    }
  } catch (err) {
    typing.remove();
    history[mode].pop();
    addMsg("err", "⚠ " + (err?.message || err));
  } finally {
    btn.disabled = false;
    $("#input").focus();
  }
}

/* ------------------------------------------------------------------- wire */

function syncSettingsForm() {
  $("#provider").value = settings.provider;
  $("#model").value = settings.model;
  $("#apiKey").value = settings.apiKey;
  $("#keyRow").hidden = settings.provider !== "openrouter";
  $("#model").placeholder = settings.provider === "openrouter" ? "openrouter/free (default)" : "blank = Puter default, e.g. gpt-4o-mini";
}

document.addEventListener("DOMContentLoaded", () => {
  restore(safeGet(STORE.edits)); // apply saved AI edits from a previous visit

  $("#fab").onclick = openPanel;
  $("#openChatHero").onclick = () => { mode = "chat"; openPanel(); };
  $("#closePanel").onclick = closePanel;
  $$(".tab").forEach((t) => (t.onclick = () => { mode = t.dataset.mode; renderMode(); }));

  $("#settingsBtn").onclick = () => { $("#settings").hidden = !$("#settings").hidden; syncSettingsForm(); };
  $("#provider").onchange = () => { $("#keyRow").hidden = $("#provider").value !== "openrouter"; };
  $("#saveSettings").onclick = () => {
    settings = { provider: $("#provider").value, model: $("#model").value.trim(), apiKey: $("#apiKey").value.trim() };
    safeSet(STORE.settings, settings);
    $("#settings").hidden = true;
    addMsg("sys", "Settings saved. " + providerLabel());
  };

  $("#saveEdits").onclick = () => addMsg("sys", safeSet(STORE.edits, snapshot()) ? "Edits saved in this browser. Use Export HTML to make them permanent on GitHub." : "Couldn't save (storage blocked).");
  $("#exportHtml").onclick = exportHtml;
  $("#undoEdit").onclick = () => { const s = undoStack.pop(); if (s) { restore(s); addMsg("sys", "Undid last change."); } else addMsg("sys", "Nothing to undo."); };
  $("#resetEdits").onclick = () => { safeDel(STORE.edits); location.reload(); };

  const input = $("#input");
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#composer").requestSubmit(); } });
  $("#composer").onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || $("#send").disabled) return;
    input.value = ""; input.style.height = "auto";
    send(text);
  };
});
