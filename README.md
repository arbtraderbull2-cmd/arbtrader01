# ArbTrader

A gold & silver disparity trading dashboard built on Flask + MetaTrader 5.
Monitor live COMEX prices, calculate MCX bank rates, manage orders, and track P&L — all from a single web interface.

---

## Architecture

```
Browser
  │
  ▼
Linux VPS  ──  app.py  (Flask UI + API proxy)
  │
  │  HTTP (secured with shared secret)
  │
  ▼
Windows PC  ──  mt5_agent.py  (MT5 bridge)
  │
  ▼
MetaTrader 5 Terminal
```

**Why split?**
The MetaTrader 5 Python library only runs on Windows. `mt5_agent.py` runs alongside your MT5 terminal on your PC and exposes a lightweight HTTP API. `app.py` runs on a cheap Linux VPS, serves the web UI, and forwards all trading calls to the agent.

---

## Features

| Tab | What it does |
|---|---|
| **Disparity** | Live COMEX bid/ask, USD/INR rate, bank rate calculation, disparity vs MCX |
| **Execute** | Multi-account login, symbol selector, market/limit/stop orders, live bid/ask |
| **Live P&L** | Open positions + pending orders, select & square off, auto-refresh |
| **Summary** | Day/Week/Month/All P&L, closed trades by symbol, net exposure |
| **History** | Full deal history synced to disk, date range filter, pagination |

---

## Project structure

```
arbtrader/
├── app.py                      # Flask server (runs on Linux VPS)
├── mt5_agent.py                # MT5 bridge (runs on Windows PC)
├── mt5_test.py                 # Diagnostic test script
├── requirements.txt            # Server dependencies
├── requirements_agent.txt      # Agent dependencies (includes MetaTrader5)
├── Procfile                    # gunicorn entry point
├── .env.example                # Environment variable template
├── .gitignore
├── saved_accounts.json         # Created at runtime — gitignored
├── trade_history.json          # Created at runtime — gitignored
├── static/
│   ├── css/arbtrader.css
│   └── js/arbtrader.js
└── templates/
    ├── index.html
    └── partials/
        ├── disparity.html      # Tab 1
        ├── execute.html        # Tab 2
        ├── pnl.html            # Tab 3
        ├── limits.html         # Tab 4 — Summary
        └── accounts.html       # Tab 5 — History
```

---

## Setup

### Prerequisites

| Where | What |
|---|---|
| Windows PC | Python 3.10+, MetaTrader 5 terminal installed and logged in |
| Linux VPS | Python 3.10+, nginx (optional but recommended) |

---

### Part 1 — Windows PC (mt5_agent)

**Install dependencies:**
```powershell
pip install flask flask-cors MetaTrader5
```

**Set environment variables and run:**
```powershell
$env:MT5_AGENT_SECRET = "pick-a-long-random-secret"
$env:MT5_AGENT_PORT   = "5001"
python mt5_agent.py
```

You should see:
```
MT5 Agent running on port 5001
Secret: pick-a-long-random-secret
Keep this running while trading.
```

**Expose port 5001 to the internet** — pick one option:

**Option A — Cloudflare Tunnel (recommended, free, no router config needed)**
```powershell
# Install once
winget install Cloudflare.cloudflared

# Run tunnel
cloudflared tunnel --url http://localhost:5001
```
Copy the `https://xxxx.trycloudflare.com` URL — you'll use it as `MT5_AGENT_URL`.

**Option B — Router port forwarding**
- Log into your router admin panel
- Add a port forwarding rule: external port `5001` → your PC's local IP on port `5001`
- Find your public IP at [whatismyip.com](https://whatismyip.com)
- Your `MT5_AGENT_URL` will be `http://YOUR_PUBLIC_IP:5001`

---

### Part 2 — Linux VPS (app.py)

Recommended providers: **Hetzner CX11**, **DigitalOcean Droplet**, **Vultr** (~$5–6/month). Pick Ubuntu 22.04.

**Install system packages:**
```bash
sudo apt update && sudo apt install python3-pip python3-venv nginx -y
```

**Upload your code:**
```bash
# From your local machine
scp -r ./arbtrader ubuntu@YOUR_VPS_IP:/home/ubuntu/
```

**Set up Python environment:**
```bash
cd /home/ubuntu/arbtrader
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**Set environment variables:**
```bash
export MT5_AGENT_URL="https://xxxx.trycloudflare.com"   # from step above
export MT5_AGENT_SECRET="pick-a-long-random-secret"     # same as agent
export PORT=5000
```

**Test it works:**
```bash
gunicorn app:app --bind 0.0.0.0:5000 --timeout 30
# Open http://YOUR_VPS_IP:5000 in browser
```

**Verify agent connection:**
```bash
curl http://localhost:5000/agent/health
# Should return: {"status": "ok", "time": ...}
```

---

### Part 3 — Production setup

**nginx reverse proxy** — serves the app on port 80/443:

```nginx
# /etc/nginx/sites-available/arbtrader
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_VPS_IP;

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_read_timeout 30s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/arbtrader /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**systemd service** — keeps the app running after reboots:

```ini
# /etc/systemd/system/arbtrader.service
[Unit]
Description=ArbTrader Web App
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/arbtrader
Environment="MT5_AGENT_URL=https://xxxx.trycloudflare.com"
Environment="MT5_AGENT_SECRET=your-secret-here"
ExecStart=/home/ubuntu/arbtrader/venv/bin/gunicorn app:app --workers 2 --bind 0.0.0.0:5000 --timeout 30
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable arbtrader
sudo systemctl start arbtrader
sudo systemctl status arbtrader
```

**Free SSL with Let's Encrypt** (requires a domain name):
```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d yourdomain.com
```

---

## Environment variables

| Variable | Where | Description |
|---|---|---|
| `MT5_AGENT_SECRET` | Both | Shared secret authenticating VPS → PC calls |
| `MT5_AGENT_URL` | VPS only | Full URL of the agent e.g. `https://xxxx.trycloudflare.com` |
| `MT5_AGENT_PORT` | PC only | Port for the agent to listen on (default `5001`) |
| `PORT` | VPS only | Port for the Flask app (default `5000`) |

---

## Diagnostics

**Run the MT5 test script on your PC** to check symbols, ticks, and order capabilities:
```powershell
# Edit ACCOUNT / PASSWORD / SERVER at the top first
python mt5_test.py
```

**Check agent reachability from the VPS:**
```bash
curl https://xxxx.trycloudflare.com/health
```

**Check the app can reach the agent:**
```bash
curl http://localhost:5000/agent/health
```

---

## Security

- `saved_accounts.json` stores MT5 credentials — keep it out of version control (already in `.gitignore`)
- `trade_history.json` stores deal history — also gitignored
- All VPS → PC calls are authenticated with `X-Agent-Secret` header
- Use Cloudflare Tunnel instead of open port forwarding where possible — it avoids exposing your home IP
- Enable the VPS firewall: `sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw allow 22 && sudo ufw enable`
- Rotate `MT5_AGENT_SECRET` periodically and update both sides

---

## Symbol mapping

The Disparity tab needs to know which MT5 symbol corresponds to each leg. On first login the broker's symbol list is fetched automatically and filtered:

- **Gold** — symbols matching `GC`, `GOLD`, `XAU` (e.g. `GCM26`, `GCQ26`)
- **Silver** — symbols matching `SI`, `SILVER`, `XAG` (e.g. `SIN26`)

Select the active contract from the dropdown in each metal tab. Your selection is saved in `localStorage`.

**Note:** `GCM26` (June contract) shows as `close only` when near expiry — switch to the next contract e.g. `GCQ26`.

---

## USD/INR rate

This broker (Navion FX) does not carry a USDINR symbol. The agent automatically falls back to [frankfurter.app](https://frankfurter.app) for a live rate. The sidebar shows `USD/INR~` (tilde) when the rate comes from the API rather than the broker.

---

## Running locally (no VPS)

If you just want to run everything on your Windows PC during development:

```powershell
# Terminal 1 — agent
$env:MT5_AGENT_SECRET = "dev-secret"
python mt5_agent.py

# Terminal 2 — app
$env:MT5_AGENT_URL    = "http://localhost:5001"
$env:MT5_AGENT_SECRET = "dev-secret"
python app.py
```

Open `http://localhost:5000`.

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3, Flask, Gunicorn |
| MT5 bridge | Python MetaTrader5 library |
| Frontend | Vanilla JS, HTML/CSS (no framework) |
| Persistence | JSON files (accounts + history) |
| Proxy | nginx |
| Process manager | systemd |
| Tunnel | Cloudflare Tunnel |