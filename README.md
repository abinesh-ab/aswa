# Seva Circle — NGO site with a free, built-in AI (POC)

A static website (plain HTML/CSS/JS, no build step) for a fictional volunteering NGO, with an AI assistant that can:

1. **Chat** – answer visitors' questions about the NGO, using the page's own content as context.
2. **Edit page** – you type a change in plain English ("make the theme green", "add a program for elderly care", "change the headline to …"), the AI returns a small JSON list of actions, and the page updates live. You can **Undo**, **Save** (in your browser), or **Export HTML** to commit the new version to GitHub.

## Free AI options (choose in the ⚙ settings of the chat panel)

| Provider | Cost | API key? | Notes |
|---|---|---|---|
| **Puter.js** (default) | Free for you | No | "User pays" model: each visitor signs in to a free Puter account on first use, so the site owner pays nothing. Many models available (leave Model blank for default, or type e.g. `gpt-4o-mini`). |
| **OpenRouter** | Free models | Yes (your own) | Uses the `openrouter/free` router or any model ending in `:free`. Paste your key in settings — it's stored only in your browser's localStorage. **Never commit an API key to the repo.** Free models have daily rate limits. |

## Host it on GitHub Pages

1. Create a new public repo on GitHub, e.g. `seva-circle`.
2. Upload `index.html`, `style.css`, `app.js` (and this README) to the repo root.
3. Repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main` / `(root)` → Save.
4. In a minute your site is live at `https://<your-username>.github.io/seva-circle/`.

Or from a terminal:

```bash
git init && git add . && git commit -m "Seva Circle AI POC"
git branch -M main
git remote add origin https://github.com/<your-username>/seva-circle.git
git push -u origin main
```

## Making AI edits permanent

Edits made in the "Edit page" tab only live in your browser. To publish them:
**Edit page → ⬇ Export HTML** → replace `index.html` in the repo with the downloaded file → commit.

## How it works (files)

- `index.html` – page markup. Any element with `data-edit="some-id"` is editable by the AI; program cards live in `#programCards`.
- `style.css` – all colors/fonts are CSS variables on `:root` (`--primary`, `--accent`, `--bg`, `--font`, …) so the AI can re-theme the page.
- `app.js` – the widget: `callAI()` (Puter / OpenRouter), the chat & edit prompts, and `applyActions()` which safely applies the AI's JSON (text is set with `textContent`, CSS values are validated — the AI never injects raw HTML).

To make more of the page AI-editable, just add `data-edit="new-id"` to any text element. To support new kinds of edits, add an action type in the edit prompt and a matching branch in `applyActions()`.

## Limits of this POC

- Free models can be slow, rate-limited, or occasionally return malformed JSON (the app shows a message and changes nothing).
- Puter shows a sign-in popup on first use; allow popups for your site.
- For a production site, call the AI through a small backend (e.g. a Cloudflare Worker) so keys stay server-side and only the owner can use "Edit page".
