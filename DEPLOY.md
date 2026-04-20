# Deploy to a live URL on palma.llc

This app has no databases. It deploys to Vercel in three steps. Pick ONE
of the two flows below.

**Optional** — set `ANTHROPIC_API_KEY` in Vercel project settings to enable
the AI-powered visual review (Claude vision actually compares the satellite
imagery against the permit record). Without the key, the app falls back to
a static visual checklist.

---

## Flow A — Browser-only (recommended, no terminal needed)

### Step 1 — push the code to GitHub

If you already use GitHub in the browser:

1. Go to <https://github.com/new>
2. **Repository name:** `permit-check-mvp`
3. **Owner:** your account (e.g. `palma9099`)
4. **Visibility:** Private is fine. Public also works.
5. Leave "Add a README" / gitignore / license **unchecked**.
6. Click **Create repository**.

GitHub now shows a "quick setup" page. Scroll to **"…or push an existing
repository from the command line"**. You'll see 3 lines like:

```
git remote add origin git@github.com:palma9099/permit-check-mvp.git
git branch -M main
git push -u origin main
```

Copy those lines, open a terminal in the `permit-check-mvp/` folder on
your computer, and paste them. If you don't have git set up locally, use
Flow B below instead.

### Step 2 — deploy to Vercel

1. Go to <https://vercel.com/new>
2. Sign in with your GitHub account (first time only).
3. **"Import Git Repository"** → select `palma9099/permit-check-mvp`.
4. Vercel auto-detects Next.js. **Do not change any settings.**
5. Optional — under "Environment Variables", add:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** your key from <https://console.anthropic.com/>
   This turns on the AI visual comparison. Skip for now if you don't have a key.
6. Click **Deploy**.

Wait ~60 seconds. You'll get a working URL like
`permit-check-mvp-<randomsuffix>.vercel.app` and a green checkmark.

**Verify:** paste `4202 SW 84 CT, Miami, FL 33155` into the form and
click "Run check". You should see a "Zero permits on file…" strong flag
and a 1-closed-code-case table. If you do, you're live.

### Step 3 — point `permits.palma.llc` at the Vercel app

In Vercel, on the project page:

1. **Settings → Domains → Add**
2. Type: `permits.palma.llc`  (pick any subdomain name you like — this is
   the sample.)
3. Vercel gives you ONE of two record types to add at your DNS host.
   For an Apex domain (`palma.llc` itself) it's an A record. For a
   **subdomain** like `permits.palma.llc`, it is always a **CNAME** to
   `cname.vercel-dns.com`.

Go to wherever `palma.llc` DNS lives (Namecheap, Cloudflare, GoDaddy,
Route 53, etc.) and add:

| Type  | Host / Name      | Target               | TTL     |
| ----- | ---------------- | -------------------- | ------- |
| CNAME | `permits`        | `cname.vercel-dns.com` | auto  |

Save. DNS usually propagates in 1-10 minutes; occasionally an hour.
Vercel's Domains page shows a green "Valid Configuration" light once it
sees the record. Your live URL is then `https://permits.palma.llc`.

Vercel auto-provisions an SSL certificate — no extra step.

---

## Flow B — From the terminal (if you have `gh` installed)

```bash
# from inside the permit-check-mvp/ folder
gh repo create permit-check-mvp --public --source=. --remote=origin --push

# or if you don't have gh:
git remote add origin https://github.com/<your-username>/permit-check-mvp.git
git branch -M main
git push -u origin main
```

Then proceed from **Step 2** above in the browser.

---

## One-click deploy button (alternative)

Once the repo is on GitHub, anyone can use the clone-and-deploy button:

```
https://vercel.com/new/clone?repository-url=https://github.com/<your-user>/permit-check-mvp&project-name=permit-check-mvp
```

Replace `<your-user>` with your GitHub username. Paste in a browser, sign
in, click Deploy — that's it.

---

## Troubleshooting

**"Failed to resolve address to a Miami-Dade folio"** — the address
parser strips the first comma. Make sure you're passing just the street
line (with or without city/state/zip — both work). This error also
appears for Miami Beach / Coral Gables / Hialeah addresses because v1
doesn't yet include those city portals.

**500 on `/api/check`** — check the Vercel function logs. The most
common cause is the upstream Miami-Dade proxy being temporarily down.
Retry in a minute.

**Custom domain stays "invalid"** — your DNS host cached an old record.
Lower the TTL, wait, and try again. Cloudflare users: make sure the
orange cloud is OFF for this CNAME (set to "DNS only"), otherwise
Cloudflare won't pass through Vercel's SSL correctly.

**Build fails on Vercel** — shouldn't happen, but if it does, the most
likely cause is Node version. Vercel defaults to 20; this app tests on 22
but is compatible with 20.
