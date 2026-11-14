<h1 align="center">Device Activity Tracker</h1>
<p align="center">WhatsApp & Signal Activity Tracker via RTT Analysis</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20+-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js"/>
  <img src="https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=black" alt="React"/>
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License MIT"/>
</p>

> ⚠️ **DISCLAIMER**: Proof-of-concept for educational and security research purposes only. Demonstrates privacy vulnerabilities in WhatsApp and Signal.

## Overview

This project implements the research from the paper **"Careless Whisper: Exploiting Silent Delivery Receipts to Monitor Users on Mobile Instant Messengers"** by Gabriel K. Gegenhuber, Maximilian Günther, Markus Maier, Aljosha Judmayer, Florian Holzbauer, Philipp É. Frenzel, and Johanna Ullrich (University of Vienna & SBA Research).

**What it does:** Measures Round-Trip Time (RTT) of WhatsApp and Signal delivery confirmations and plots relative latency changes over time. The research explores whether such changes can reveal activity or network conditions; this implementation does not validate those inferences without ground-truth calibration.

**Security implications:** This demonstrates a significant privacy vulnerability in messaging apps that can be exploited for surveillance.

## Example

![WhatsApp Activity Tracker Interface](example.png)

The web interface shows real-time RTT measurements and tentative activity labels. A single uncalibrated RTT series cannot establish whether a phone screen is active.

## Installation

```bash
# Clone repository
git clone https://github.com/gommzystudio/device-activity-tracker.git
cd device-activity-tracker

# Install dependencies
npm install
# npm's postinstall also installs client dependencies
```

**Requirements:**
- Node.js 20.19+
- npm or pnpm
- Docker (optional, recommended)
- Redis 7+ when `CONTACT_STORE=redis` (provided by Docker Compose)
- WhatsApp & Signal accounts for linking

## Usage

### Docker (Recommended)

The easiest way to run the application is using Docker:

```bash
# Copy environment template
cp .env.example .env

# Set ADMIN_TOKEN to a unique value (openssl rand -hex 32)
# Set CONSENTED_NUMBERS to a comma-separated list of consenting targets
# Tell each recipient that probes may generate phone notifications
# Adjust ALLOWED_ORIGINS if the frontend is not at http://localhost:3000

# Build and start containers
docker compose up --build
```

The application will be available at:
- Frontend: [http://localhost:3000](http://localhost:3000) (or your configured `CLIENT_PORT`)
- Backend: [http://localhost:3001](http://localhost:3001) (or your configured `BACKEND_PORT`)

To stop the containers:
```bash
docker compose down
```

### Manual Setup

#### Web Interface

```bash
# Terminal 1: Set ADMIN_TOKEN and CONSENTED_NUMBERS, then start backend
ADMIN_TOKEN=your-unique-token-at-least-24-characters CONSENTED_NUMBERS=491701234567 CONTACT_STORE=file npm run start:server

# Terminal 2: Start frontend
npm run start:client
```

For Signal in a local setup, start its API separately with `npm run start:signal-api` or set `SIGNAL_API_URL` to an existing instance. The browser asks for the same `ADMIN_TOKEN` when opened. Use HTTPS when accessing the app outside localhost.

Open `http://localhost:3000`, scan the QR code with WhatsApp, then enter the phone number to track (e.g., `491701234567`).

Tracked contacts are saved in Redis by default or in `data/contacts.json` with `CONTACT_STORE=file`. When a platform reconnects, the backend resumes saved contacts that recorded notification acknowledgement and remain listed in `CONSENTED_NUMBERS`. Older saved contacts are not resumed; add them again after obtaining informed consent. Signal account data lives in its own Docker volume; the current QR image is kept only in backend memory during linking.

**Notifications:** A real WhatsApp test showed that delete probes can trigger phone notifications even when no message appears in the conversation. Reaction and Signal probes may also notify recipients. Both the recipient's consent and an explicit notification acknowledgement are required before starting tracking. Probes continue if the dashboard is closed and may resume after a backend restart; remove the contact to stop them.

**Measurement limits:** Activity labels are estimates from RTT and can be affected by network latency, dropped receipts, or platform changes. Signal reactions return no probe identifier, so a delivery receipt from the same contact during an outstanding probe may be unrelated. Treat these measurements as exploratory data, not proof of a person's activity.

### Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `CONTACT_STORE` | `redis` | Choose `redis` (recommended) or `file` for local JSON persistence. |
| `REDIS_URL` / `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD` | `redis://127.0.0.1:6379` | Connection info for the Redis contact store. |
| `SIGNAL_API_URL` | `http://localhost:8080` | URL of the `signal-cli-rest-api` service. |
| `ADMIN_TOKEN` | required | At least 24 characters; grants access to the Socket.IO dashboard. |
| `CONSENTED_NUMBERS` | empty | Comma-separated international numbers approved for this research session. |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Browser origins allowed to connect. |
| `PORT` | `3001` | Backend HTTP port. |
| `CLIENT_PORT` | `3000` | Frontend dev server port. |
| `BACKEND_URL` / `VITE_API_URL` | `http://localhost:3001` | Browser-facing backend URL; Docker passes `BACKEND_URL` to the Vite build. |
| `NODE_ENV` | `development` | Standard Node.js env. |

Docker Compose connects to Redis and Signal API by their service names. It does not publish either service's port to the host. Configure `ADMIN_TOKEN` and `CONSENTED_NUMBERS` before starting it.

### Verify the local stack

After `docker compose up --build`, use `docker compose ps` to check the four services and `docker compose logs backend -f` to inspect connection errors. The Redis contact hash can be inspected with `docker compose exec redis redis-cli HGETALL tracker:contacts`. Restart the backend to check that consented contacts resume after the messaging platform reconnects.

### CLI Interface (only WhatsApp)

```bash
CONSENTED_NUMBERS=491701234567 npm start -- --acknowledge-notifications
```

Follow prompts to authenticate and enter a consenting target number. The flag confirms that you have informed the recipient about possible notifications.

**Example Output:**

```
╔════════════════════════════════════════════════════════════════╗
║ 🟡 Device Status Update - 09:41:51                             ║
╠════════════════════════════════════════════════════════════════╣
║ JID:        ***********@lid                                    ║
║ Status:     Standby                                            ║
║ RTT:        1104ms                                             ║
║ Avg (3):    1161ms                                             ║
║ Median:     1195ms                                             ║
║ Threshold:  1075ms                                             ║
╚════════════════════════════════════════════════════════════════╝
```

- **🟢 Online**: Low relative RTT suggests activity; this is an estimate, not proof that the app is open.
- **🟡 Standby**: Higher relative RTT suggests inactivity; the app may still be open.
- **⚪ No ACK**: No delivery confirmation arrived within 10 seconds; this does not prove that the device is offline.

## How It Works

The tracker sends probe messages and measures the Round-Trip Time (RTT) of delivery confirmations. Two probe methods are available:

### Probe Methods

| Method | Description                                                                                                     |
|--------|-----------------------------------------------------------------------------------------------------------------|
| **Delete** | Sends a "delete" request for a non-existent message ID; triggered a notification in our WhatsApp test. |
| **Reaction** (Default) | Sends a reaction emoji referencing a non-existent message from the linked account; may trigger notifications. |

### Detection Logic

The time between sending the probe and receiving a CLIENT ACK (status 3) is measured as RTT. The app estimates **Online** or **Standby** using a threshold of 90% of the running median. These are tentative labels based on latency: our live test classified an open WhatsApp session as “Standby.” Reliable screen-state inference requires calibration with known open and closed periods. A missing ACK is shown as **No ACK**, not as proof that the device is offline.

### Switching Probe Methods

In the web interface, you can switch between probe methods using the control panel. The CLI also defaults to reactions. For a time-limited Socket.IO session, include `durationMinutes` (1–60) in the `add-contact` payload; the backend stops and removes the contact at expiry, including after a reconnect.

## Common Issues

- **Not Connecting to WhatsApp**: Delete the `auth_info_baileys/` folder and re-scan the QR code.

## Project Structure

```
device-activity-tracker/
├── src/
│   ├── infra/contact-repository.ts # Redis and file contact stores
│   ├── security.ts             # Token and number validation
│   ├── tracker.ts              # WhatsApp probe logic
│   ├── signal-tracker.ts       # Signal probe logic
│   ├── server.ts               # Express and Socket.IO
│   └── main.ts                 # Server entry point
├── data/                       # Local contact store when CONTACT_STORE=file
├── client/                     # React web interface
└── package.json
```

## How to Protect Yourself

The most effective mitigation is to enable “Block unknown account messages” in WhatsApp under
Settings → Privacy → Advanced.

This setting may reduce an attacker’s ability to spam probe reactions from unknown numbers, because WhatsApp blocks high-volume messages from unknown accounts.
However, WhatsApp does not disclose what “high volume” means, so this does not fully prevent an attacker from sending a significant number of probe reactions before rate-limiting kicks in.

Disabling read receipts helps with regular messages but may not prevent timing-based activity inference. Platform behavior can change, so validate any research result against the current app versions.

## Ethical & Legal Considerations

⚠️ For research and educational purposes only. Never track people without explicit consent - this may violate privacy laws. Authentication data (`auth_info_baileys/`) is stored locally and must never be committed to version control.

## Citation

Based on research by Gegenhuber et al., University of Vienna & SBA Research:

```bibtex
@inproceedings{gegenhuber2024careless,
  title={Careless Whisper: Exploiting Silent Delivery Receipts to Monitor Users on Mobile Instant Messengers},
  author={Gegenhuber, Gabriel K. and G{\"u}nther, Maximilian and Maier, Markus and Judmayer, Aljosha and Holzbauer, Florian and Frenzel, Philipp {\'E}. and Ullrich, Johanna},
  year={2024},
  organization={University of Vienna, SBA Research}
}
```

## License

MIT License - See LICENSE file.

Built with [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)

---

**Use responsibly. This tool demonstrates real security vulnerabilities that affect millions of users.**


## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=gommzystudio/device-activity-tracker&type=date&legend=top-left)](https://www.star-history.com/#gommzystudio/device-activity-tracker&type=date&legend=top-left)
