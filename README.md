# genesis-controls

Vercel serverless functions to control your Genesis via Genesis Connected Services (Canada).

**Runtime**: Node.js 22 + Vercel Hobby (Fluid Compute)
**Auth**: `Authorization: Bearer <API_SECRET>` on all endpoints except `/api/health`

---

## Project structure

```
genesis-controls/
├── api/
│   ├── health.ts     GET  — liveness (no auth)
│   ├── lock.ts       POST — lock doors
│   ├── start.ts      POST — remote start
│   ├── status.ts     GET  — vehicle status
│   ├── stop.ts       POST — stop engine
│   └── unlock.ts     POST — unlock doors
├── lib/
│   ├── auth.ts       Bearer token validation (timing-safe)
│   ├── car.ts        CarClient interface + StubCarClient singleton
│   ├── handler.ts    withAuth() wrapper + methodGuard()
│   └── response.ts   json() / error() helpers
├── .env.example
├── vercel.json
└── tsconfig.json
```

---

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env file and set your secret
cp .env.example .env
# Edit .env — set API_SECRET to a long random string, e.g.:
#   openssl rand -base64 32

# 3. Run locally
pnpm dev          # starts vercel dev on http://localhost:3000

# 4. Type-check
pnpm typecheck
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `API_SECRET` | ✅ | Shared secret for Bearer auth. Set in Vercel project settings. |
| `GENESIS_USERNAME` | future | Genesis Connected Services email |
| `GENESIS_PASSWORD` | future | Genesis Connected Services password |
| `GENESIS_PIN` | future | Remote control PIN |
| `GENESIS_VIN` | future | Vehicle VIN |
| `GENESIS_REGION` | future | `CA` |
| `GENESIS_BRAND` | future | `hyundai` (Genesis Canada uses the HMG/Hyundai backend) |

---

## Endpoints

All endpoints except `/api/health` require:

```
Authorization: Bearer <API_SECRET>
```

### `GET /api/health`

Liveness check — no auth required.

```bash
curl https://your-app.vercel.app/api/health
# {"ok":true,"ts":"2026-07-13T12:00:00.000Z"}
```

### `POST /api/start`

```bash
curl -X POST https://your-app.vercel.app/api/start \
  -H "Authorization: Bearer $API_SECRET"
# {"ok":true,"action":"start","mock":true}
```

### `POST /api/stop`

```bash
curl -X POST https://your-app.vercel.app/api/stop \
  -H "Authorization: Bearer $API_SECRET"
```

### `GET /api/status`

```bash
curl https://your-app.vercel.app/api/status \
  -H "Authorization: Bearer $API_SECRET"
# {"locked":true,"running":false}
```

### `POST /api/lock` / `POST /api/unlock`

```bash
curl -X POST https://your-app.vercel.app/api/lock \
  -H "Authorization: Bearer $API_SECRET"
```

---

## Deploy to Vercel

```bash
# First deploy (follow prompts to link/create project)
pnpm dlx vercel

# Production deploy
pnpm deploy

# Set env var in Vercel (once)
pnpm dlx vercel env add API_SECRET production
```

---

## iPhone Shortcuts

1. Open **Shortcuts** → New shortcut
2. Add action: **Get Contents of URL**
3. URL: `https://your-app.vercel.app/api/start`
4. Method: **POST**
5. Headers → Add header:
   - Key: `Authorization`
   - Value: `Bearer your-secret-here`
6. Save as "Start Genesis"
7. Add to Home Screen or invoke via Siri: *"Hey Siri, Start Genesis"*

Repeat for stop / lock / unlock.

---

## Google Nest Mini (via IFTTT)

Google Assistant on Nest Mini **cannot send custom HTTP headers** natively, so a relay is needed.

**Recommended path — IFTTT Pro:**

1. Create an IFTTT applet
2. **If**: Google Assistant — "Say a specific phrase" → *"start my car"*
3. **Then**: Webhooks — "Make a web request"
   - URL: `https://your-app.vercel.app/api/start`
   - Method: `POST`
   - Content Type: `application/json`
   - Additional headers: `Authorization: Bearer your-secret`
4. Repeat for each command

**Free alternative (URL-slug auth):**
Use a secret embedded in a unique URL path instead of a header, e.g.:
`/api/start?key=your-secret`. This requires modifying `lib/auth.ts` to also accept
the `key` query parameter. Less clean but works with Google Home routines → "Call a webhook".

---

## Integrating Genesis Connected Services (bluelinky)

When you're ready to make real API calls:

```bash
pnpm add bluelinky
```

Create `lib/genesis-client.ts`:

```typescript
import { BlueLinky } from "bluelinky";
import type { CarClient, CarStatus, StartOptions } from "./car";

export class BluelinkyCarClient implements CarClient {
  private vehicle: Awaited<ReturnType<InstanceType<typeof BlueLinky>["getVehicle"]>> | null = null;

  async init(): Promise<void> {
    const client = new BlueLinky({
      username: process.env.GENESIS_USERNAME!,
      password: process.env.GENESIS_PASSWORD!,
      pin:      process.env.GENESIS_PIN!,
      brand:    "hyundai",   // Genesis Canada uses the Hyundai HMG backend
      region:   "CA",
    });

    await new Promise<void>((resolve, reject) => {
      client.on("ready", async () => {
        this.vehicle = client.getVehicle(process.env.GENESIS_VIN!);
        resolve();
      });
      client.on("error", reject);
    });
  }

  async start(options?: StartOptions) {
    const res = await this.vehicle!.start({ duration: options?.durationMinutes ?? 10 });
    return { ok: true, action: "start", details: res };
  }

  async stop() {
    const res = await this.vehicle!.stop();
    return { ok: true, action: "stop", details: res };
  }

  async lock() {
    const res = await this.vehicle!.lock();
    return { ok: true, action: "lock", details: res };
  }

  async unlock() {
    const res = await this.vehicle!.unlock();
    return { ok: true, action: "unlock", details: res };
  }

  async status(): Promise<CarStatus> {
    const s = await this.vehicle!.status({ parsed: true });
    return {
      locked: s.doorLock ?? false,
      running: s.engine ?? false,
      odometer: s.odometer?.value,
      fuelLevelPercent: s.fuelLevel,
    };
  }
}
```

Then in `lib/car.ts`, replace:

```typescript
_client = new StubCarClient();
```

with:

```typescript
const real = new BluelinkyCarClient();
await real.init();
_client = real;
```

> **Note**: `bluelinky` v10 uses undici for HTTP in Canada automatically — no extra config needed.
> Genesis CA owners have had success with `brand: 'hyundai'`, but your mileage may vary.
> If `hyundai` doesn't work, try `brand: 'kia'` — the HMG backend is shared across brands in CA.
