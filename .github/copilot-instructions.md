# GitHub Copilot Instructions — genesis-controls

## ⚠️ Always start here

Before doing **any** analysis, code generation, or review:

1. **Checkout the `main` branch** and **pull the latest changes**:
   ```bash
   git checkout main
   git pull origin main
   ```
2. Only then begin exploring, editing, or proposing changes.

---

## Project overview

`genesis-controls` is a set of **Vercel serverless functions** (Node.js 22, TypeScript ESM) that expose a simple REST API to control a Genesis vehicle via Genesis Connected Services (Canada).

- **Runtime**: Node.js 22 + Vercel Hobby (Fluid Compute)
- **Package manager**: `pnpm`
- **Auth**: `Authorization: Bearer token on all endpoints except `/api/health`
- **Current car backend**: `StubCarClient` (mock) — real calls go through `bluelinky` once configured

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
│   ├── auth.ts       Bearer token validation (timing-safe HMAC comparison)
│   ├── car.ts        CarClient interface + StubCarClient singleton
│   ├── handler.ts    withAuth() wrapper + methodGuard()
│   └── response.ts   json() / error() helpers
├── .env.example
├── vercel.json
└── tsconfig.json
```

---

## Development commands

```bash
pnpm install       # install dependencies
pnpm dev           # vercel dev on http://localhost:3000  (alias: pnpm start)
pnpm typecheck     # tsc --noEmit — run this before committing
pnpm deploy        # vercel --prod
```

---

## Coding conventions

- **Language**: TypeScript strict mode (`tsconfig.json` has `"strict": true`)
- **Module system**: ESM — always use `.js` extensions in import paths (e.g. `import … from "../lib/response.js"`)
- **Formatting**: no formatter is configured; match the style of the file being edited
- **Auth**: every new endpoint must be wrapped with `withAuth()` from `lib/handler.ts`, except endpoints explicitly intended to be public
- **Method guard**: use `methodGuard(req, "GET"|"POST")` as the first thing inside a `withAuth` handler
- **Error handling**: never forward raw error messages to HTTP responses — log them server-side and return a generic message
- **Secrets**: never hard-code secrets; always read from `process.env.*`

---

## Environment variables

| Variable            | Required | Description                                              |
|---------------------|----------|----------------------------------------------------------|
| `API_SECRET`        | ✅        | Shared secret for Bearer auth (set in Vercel env vars)   |
| `GENESIS_USERNAME`  | future   | Genesis Connected Services email                         |
| `GENESIS_PASSWORD`  | future   | Genesis Connected Services password                      |
| `GENESIS_PIN`       | future   | Remote control PIN                                       |
| `GENESIS_VIN`       | future   | Vehicle VIN                                              |
| `GENESIS_REGION`    | future   | `CA`                                                     |
| `GENESIS_BRAND`     | future   | `hyundai` (Genesis Canada uses the HMG/Hyundai backend)  |

---

## Adding a new endpoint

1. Create `api/<action>.ts` exporting a default `async function handler(req: Request): Promise<Response>`
2. Wrap with `withAuth` and `methodGuard`
3. Call `getCarClient()` from `lib/car.ts` to get the singleton client
4. Return `json(200, { ok: true, action: "<action>" })` on success
5. Run `pnpm typecheck` to verify no type errors

---

## Swapping in the real Genesis client (bluelinky)

See `lib/car.ts` for full instructions and `README.md` for the complete `BluelinkyCarClient` implementation. The short version:

```bash
pnpm add bluelinky
```

Then implement `BluelinkyCarClient` and replace `new StubCarClient()` in `lib/car.ts`.

---

## Security notes

- Bearer token comparison uses `timingSafeEqual` via HMAC-SHA256 digests (see `lib/auth.ts`) to prevent timing attacks
- `API_SECRET` must never appear in source code or logs
- All 5xx error details are logged server-side only — clients receive only `"Internal server error"`
