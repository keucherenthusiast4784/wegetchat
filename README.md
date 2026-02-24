# wegetchat

Basic messaging app clone with:

- Username/password auth (no email)
- Add people and 1:1 conversations
- Text messaging + attachment uploads
- Timestamps and read receipts
- Settings (status, profile photo, notification toggle)
- In-app notifications

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Run non-locally (public server)

Yes — you can deploy this app on any VM/container host (Render, Railway, Fly.io, VPS, etc.).

### Required env vars

- `NODE_ENV=production`
- `PORT=3000` (or value provided by your platform)
- `HOST=0.0.0.0`
- `SESSION_SECRET=<long-random-secret>`

### Optional env vars

- `DATA_DIR=/some/persistent/path/data`
- `UPLOAD_DIR=/some/persistent/path/uploads`

> Use persistent volumes for `DATA_DIR` and `UPLOAD_DIR`, or your users/messages/uploads will reset on redeploy.

### Example production start

```bash
NODE_ENV=production HOST=0.0.0.0 PORT=3000 SESSION_SECRET='replace-me' npm start
```

Then expose that port through your host's public domain.
