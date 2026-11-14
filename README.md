<h1 align="center">Device Activity Tracker</h1>
<p align="center">WhatsApp & Signal Activity Tracker via RTT Analysis</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20+-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js"/>
  <img src="https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/React-18+-61DAFB?style=flat&logo=react&logoColor=black" alt="React"/>
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License MIT"/>
</p>

> ⚠️ **DISCLAIMER**: Proof-of-concept for educational and security research purposes only. Demonstrates privacy vulnerabilities in WhatsApp and Signal.

## Overview

This project implements the research from the paper **"Careless Whisper: Exploiting Silent Delivery Receipts to Monitor Users on Mobile Instant Messengers"** by Gabriel K. Gegenhuber, Maximilian Günther, Markus Maier, Aljosha Judmayer, Florian Holzbauer, Philipp É. Frenzel, and Johanna Ullrich (University of Vienna & SBA Research).

**What it does:** By measuring Round-Trip Time (RTT) of WhatsApp message delivery receipts, this tool can detect:
- When a user is actively using their device (low RTT)
- When the device is in standby/idle mode (higher RTT)
- Potential location changes (mobile data vs. WiFi)
- Activity patterns over time

**Security implications:** This demonstrates a significant privacy vulnerability in messaging apps that can be exploited for surveillance.

## Example

![WhatsApp Activity Tracker Interface](example.png)

The web interface shows real-time RTT measurements, device state detection, and activity patterns.

## Installation

```bash
# Clone repository
git clone https://github.com/gommzystudio/device-activity-tracker.git
cd device-activity-tracker

# Install dependencies
npm install
cd client && npm install && cd ..
```

**Requirements:** 
- Node.js 20+
- npm or pnpm
- Docker (optional, recommended)
- Redis 7+ (required when using Redis contact store/BullMQ; automatically provided via `docker compose`)
- WhatsApp & Signal accounts for linking

## Usage

### Docker (Recommended)

The easiest way to run the application is using Docker:

```bash
# Copy environment template
cp .env.example .env

# (Optional) Customize ports in .env file
# BACKEND_PORT=3001
# CLIENT_PORT=3000
# CONTACT_STORE=redis
# SIGNAL_API_URL=http://signal-api:8080
# REDIS_URL=redis://redis:6379

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
# Terminal 1: Start backend (bootstraps infra + domain + interface layers)
CONTACT_STORE=file npm run start:server

# Terminal 2: Start frontend
npm run start:client
```

Open `http://localhost:3000`, scan the QR code with WhatsApp, then enter the phone number to track (e.g., `491701234567`).

> ℹ️ **Persistência de contatos:** Por padrão, o servidor usa Redis (`CONTACT_STORE=redis`) para armazenar contatos e estados de Signal, além de alimentar as filas BullMQ que reativam trackers após reconexões. Caso o Redis não esteja disponível, defina `CONTACT_STORE=file` para usar `data/contacts.json` (gitignored) como fallback.

### Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `CONTACT_STORE` | `redis` | Choose `redis` (recommended) or `file` for local JSON persistence. |
| `REDIS_URL` / `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD` | `redis://127.0.0.1:6379` | Connection info for Redis (BullMQ queues + contact store + Signal state cache). |
| `SIGNAL_API_URL` | `http://localhost:8080` | URL of the `signal-cli-rest-api` service. |
| `PORT` | `3001` | Backend HTTP port. |
| `CLIENT_PORT` | `3000` | Frontend dev server port. |
| `NODE_ENV` | `development` | Standard Node.js env. |
| `REDIS_DISABLE_RESUBSCRIBE` | *unset* | Set to `true` if using managed Redis that disallows resubscribe. |

With Docker, these variables are already configured for the bundled services (backend, client, Signal API, Redis). For local setups, ensure a Redis instance is running and accessible via the provided `REDIS_*` configuration.

### BullMQ Workers & Redis Persistence

The backend now uses BullMQ queues to reidratar trackers após quedas de conexão:

1. **Queues**: `tracker:whatsapp` e `tracker:signal`. Cada contato recebe jobs `rehydrate`.
2. **Workers**: são instanciados dentro do próprio processo do backend (`TrackerQueueManager`). Não é necessário subir processos separados, mas é possível no futuro reutilizando o mesmo código.
3. **Redis Contact Store**: Os contatos são gravados em `tracker:contacts` (hash). O SignalStateStore usa Redis para armazenar QR codes em andamento e o último número vinculado.
4. **Fallback**: Se `CONTACT_STORE=file`, apenas o repositório local é usado e BullMQ é ignorado, mas recursos avançados (reativação automática, cache de Signal) exigem Redis.

### Validating Docker Compose + BullMQ/Redis

1. **Build & Start**
   ```bash
   docker compose up --build
   ```
   Isso levanta backend, frontend, Signal API e Redis.

2. **Checar serviços**
   ```bash
   docker compose ps
   docker compose logs backend -f
   ```
   Procure mensagens como `[BULLMQ] WhatsApp worker error` (não deve aparecer) e `[BOOTSTRAP] Using RedisContactRepository`.

3. **Verificar Redis**
   ```bash
   docker exec -it device-activity-tracker-redis-1 redis-cli
   > HGETALL tracker:contacts
   > GET signal:link:qr
   ```
   (ajuste o nome do container conforme o prefixo do seu projeto).

4. **Fluxo WhatsApp**
   - Abra o frontend (`http://localhost:3000`), escaneie o QR e adicione um contato.
   - Simule uma queda (pare o backend e suba novamente). Ao reconectar, observe que os jobs BullMQ reanexam os trackers e emitem `tracked-contacts` automaticamente.

5. **Fluxo Signal**
   - Garanta que `SIGNAL_API_URL` aponta para o serviço do docker compose (`http://signal-api:8080` internamente).
   - Inicie o linking no painel. Se o backend reiniciar durante o processo, o QR cacheado é reenviado (via Redis) e o polling continua até que `getSignalAccounts` retorne um número válido.

### Signal Linking & Resilience

- **Cache de QR**: a URL do QR (`signal:link:qr`) é guardada por alguns minutos no Redis. Qualquer cliente recém-conectado recebe imediatamente o QR atual.
- **Último número vinculado**: `signal:link:account` registra o número ativo. Isso permite reidratar trackers mesmo que o backend reinicie sem precisar reler o Signal API imediatamente.
- **BullMQ Rehydrate**: Quando o Signal fica `open`, o backend agenda jobs de reidratação para todos os contatos de plataforma `signal`. Caso algum contato já esteja ativo, o job é ignorado.
- **Fallbacks**: Se o Signal API cair, o orchestrator desconecta todos os trackers, limpa o estado e reinicia o processo de linking automaticamente quando o serviço voltar.

### CLI Interface (only WhatsApp)

```bash
npm start
```

Follow prompts to authenticate and enter target number.

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

- **🟢 Online**: Device is actively being used (RTT below threshold)
- **🟡 Standby**: Device is idle/locked (RTT above threshold)
- **🔴 Offline**: Device is offline or unreachable (no CLIENT ACK received)

## How It Works

The tracker sends probe messages and measures the Round-Trip Time (RTT) to detect device activity. Two probe methods are available:

### Probe Methods

| Method | Description                                                                                                     |
|--------|-----------------------------------------------------------------------------------------------------------------|
| **Delete** (Default) | Sends a "delete" request for a non-existent message ID.                                                         |
| **Reaction** | Sends a reaction emoji to a non-existent message ID. |

### Detection Logic

The time between sending the probe message and receiving the CLIENT ACK (Status 3) is measured as RTT. Device state is detected using a dynamic threshold calculated as 90% of the median RTT: values below the threshold indicate active usage, values above indicate standby mode. Measurements are stored in a history and the median is continuously updated to adapt to different network conditions.

### Switching Probe Methods

In the web interface, you can switch between probe methods using the dropdown in the control panel. In CLI mode, the delete method is used by default.

## Common Issues

- **Not Connecting to WhatsApp**: Delete the `auth_info_baileys/` folder and re-scan the QR code.

## Project Structure

```
device-activity-tracker/
├── src/
│   ├── domain/                 # Modelos e contratos (TrackedContact, ContactRepository)
│   ├── infra/                  # Persistência (FileContactRepository)
│   ├── application/            # TrackerRegistry + TrackerService (orquestra trackers)
│   ├── server.ts               # Camada de interface (Express + Socket.IO)
│   └── main.ts                 # Bootstrap que liga todas as camadas
├── data/                       # Persistência dos contatos rastreados (contacts.json)
├── client/                     # React web interface
└── package.json
```

## How to Protect Yourself

The most effective mitigation is to enable “Block unknown account messages” in WhatsApp under
Settings → Privacy → Advanced.

This setting may reduce an attacker’s ability to spam probe reactions from unknown numbers, because WhatsApp blocks high-volume messages from unknown accounts.
However, WhatsApp does not disclose what “high volume” means, so this does not fully prevent an attacker from sending a significant number of probe reactions before rate-limiting kicks in.

Disabling read receipts helps with regular messages but does not protect against this specific attack. As of December 2025, this vulnerability remains exploitable in WhatsApp and Signal.

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
