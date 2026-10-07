# Hosted preview: Render (API) + Vercel (owner app) + Neon (database)

A hosted copy of Morbeez so the client can use the Android app from
anywhere. **Not production**: production is AWS (`first-deploy.md`).

```
 Client's phone (.apk)
   ├─ Driver mode ─────────────────────────► morbeez-api (Render) ──► Neon Postgres
   │                                                         └──────► morbeez-redis (Render)
   └─ Owner mode (opens the web app) ──► owner app (Vercel) ──► morbeez-api (Render)
```

The .apk alone is not enough: Driver mode talks to the **API**, and Owner
mode opens the **owner web app**. Both must be online.

Order matters, because each piece needs the address of the one before it:
**Neon → Render → Vercel → back to Render (one setting) → .apk**.

## Before you start

- Accounts: GitHub (the repo), Neon, Render, Vercel.
- On your PC: Node 20 + pnpm (as for development), and the Android SDK +
  JDK 17 for the .apk.
- **Vercel plan:** the free *Hobby* plan is for personal, non-commercial use
  only. Morbeez is a commercial product, so Vercel's terms call for *Pro*.
- **Render plan:** free services sleep after 15 minutes idle; the first
  request afterwards takes ~1 minute, and the owner app or the driver app may
  show an error until the API is awake (try again). For a
  client demo, Render *Starter* (USD 7/month) on `morbeez-api` avoids it.

## 1. Database (Neon)

Use a **new, empty database**. Don't reuse the development database:
`pnpm db:seed` gives dev users a password that is published in this repo.

1. Neon console → your project → **Databases → New database**:
   `morbeez_preview`, owner `neondb_owner`.
2. **Connect** → database `morbeez_preview`, role `neondb_owner`,
   **connection pooling off** → copy the URL. This is the *owner URL*, used
   only from your PC to migrate.
3. Make a strong password for the app's own role and keep it
   (`APP_DB_PASSWORD`):
   ```
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```

## 2. Create the tables (from your PC)

From the repository root, in PowerShell:

```powershell
$env:DATABASE_URL    = "postgresql://neondb_owner:<pw>@ep-xxxx.us-east-2.aws.neon.tech/morbeez_preview?sslmode=require"
$env:APP_DB_PASSWORD = "<the password from 1.3>"
$env:NODE_ENV        = "production"   # refuses to migrate without APP_DB_PASSWORD
pnpm install
pnpm db:migrate
```

Shell variables win over `apps/backend/.env`. Don't run `pnpm db:seed` here.

The migrations create the role `morbeez_app`, which the API connects as.
Its URL uses the **pooled** host (note `-pooler`):

```
postgresql://morbeez_app:<APP_DB_PASSWORD>@ep-xxxx-pooler.us-east-2.aws.neon.tech/morbeez_preview?sslmode=require
```

That is `APP_DATABASE_URL` in step 4. Roles are per Neon project: if your
dev database in the same project also uses `morbeez_app`, its password is
now `APP_DB_PASSWORD` too. Update `APP_DATABASE_URL` in `apps/backend/.env`.

## 3. Push the code

Render and Vercel both build from GitHub:

```
git add -A
git commit -m "Hosted preview: Render + Vercel"
git push origin main
```

## 4. The API on Render

1. <https://dashboard.render.com> → **New → Blueprint** → connect GitHub →
   `gaiusroy95/morbeez-ERP`, branch `main`. Render reads `render.yaml` and
   lists `morbeez-api` and `morbeez-redis`.
2. Fill in what it asks for:

   | Key | Value |
   |---|---|
   | `APP_DATABASE_URL` | the `morbeez_app` URL from step 2 |
   | `FIELD_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Never change it later**: farmers' bank details are encrypted with it. |
   | `CORS_ORIGIN` | `https://example.com` for now: the Vercel address isn't known yet (step 6). |

3. **Apply**. The first build takes ~10 minutes.
4. Note the API's address on its page, e.g. `https://morbeez-api.onrender.com`.
   Check `https://morbeez-api.onrender.com/health` → `{"status":"ok"}`.
   If not, the **Logs** tab says which setting is wrong.

## 5. The owner app on Vercel

1. <https://vercel.com/new> → import `gaiusroy95/morbeez-ERP`.
2. **Root Directory** → `apps/owner-app`. Framework: Next.js (detected).
   Leave build and install commands as detected. Vercel finds the pnpm
   workspace at the repository root and brings the shared packages along.
3. **Environment Variables**: `API_BASE_URL` = the API address from 4.4
   (no trailing slash).
4. **Deploy**. Then **Settings → Functions → Region**: Washington, D.C.
   (`iad1`), next to Render Ohio and Neon. Redeploy if you changed it.
5. Note the address, e.g. `https://morbeez-owner.vercel.app`, and open
   `/login` there: the sign-in page.

## 6. Tell the API where the owner app is

Render → `morbeez-api` → **Environment** → `CORS_ORIGIN` = the Vercel
address from 5.5 → **Save** (it redeploys).

## 7. The client's business

Open `https://<vercel address>/signup` and create the business with the
client's mobile number (30-day free trial). Signed in as that owner:
**Workforce** → add the drivers with their mobile numbers; **Delegation** →
what each may do.

Then close public sign-up: Render → `morbeez-api` → Environment →
`SIGNUP_ENABLED` = `false`.

## 8. The .apk

From `apps/driver-app`:

```powershell
.\gradlew.bat assemblePreview "-Pmorbeez.apiUrl=https://morbeez-api.onrender.com" "-Pmorbeez.ownerUrl=https://morbeez-owner.vercel.app"
```

(Use your real addresses; the build refuses to run without both.) The file:

```
apps/driver-app/app/build/outputs/apk/preview/app-preview.apk
```

Send it by Google Drive, WhatsApp (as a document) or email. On the phone:
open it → allow **Install unknown apps** when asked → Install.

It is signed with **this PC's** debug key (`%USERPROFILE%\.android\debug.keystore`).
A newer .apk from the same PC installs over the old one and keeps the phone's
data; one from another PC needs the old app uninstalled first. A real release
key replaces this before the Play Store.

## Updating

| Changed | Do |
|---|---|
| Backend or owner app | `git push`. Render and Vercel redeploy by themselves. |
| A new migration | Step 2 again, **before** pushing. Migrations only add, so the running version keeps working meanwhile. |
| Driver app | Step 8, send the new .apk. |
| The API's or owner app's address | Rebuild and resend the .apk: the addresses are built into it. |

## Photos

### Why Render loses them

A Render service is not a computer with a hard disk you own. Every deploy
builds a fresh container from the GitHub code and throws the old one away,
together with any file written while it ran. A free service that goes to
sleep is also thrown away and started fresh when it wakes. Photos written to
the "project folder" on Render live inside that disposable container, so
they go with it. The folder on GitHub is a different place: the server never
writes there.

The database keeps the photo **records** (which stop, which kind, when, the
file's key in `fulfilment.trip_stop_photo`); only the image files are lost.
No screen shows the images yet, so in this preview nothing visible breaks.

### Option A: the server's own disk (Render persistent disk)

Render keeps a disk across deploys if you attach one: `morbeez-api` on a
paid plan + a disk, `UPLOADS_DIR` on it. Code unchanged.

Risks:
- **One server only.** A disk belongs to one instance; the API can't scale
  to two, and each deploy has a short outage (old and new can't overlap).
- **Backups are yours to think about.** Render snapshots disks daily, but a
  deleted service or a bad restore loses photos.
- **Tied to Render.** Moving host means copying every file by hand.
- **Disk fills up**, and showing photos later takes the API's own bandwidth.

### Option B: cloud storage (Google Cloud Storage, Cloudflare R2, AWS S3)

The API puts each photo into a private bucket; Neon keeps its **key** (not a
public link). Production is designed this way (S3). Survives every deploy
and any host change.

Risks, and what to do about each:
- **Leaking photos.** They show customers, signatures, receipts: personal
  data. A bucket made public by mistake exposes all of it. Keep the bucket
  private and, when photos are shown later, hand out short-lived signed
  links, not permanent public URLs.
- **Leaked access key.** Anyone with it can read or delete photos. Keep it
  only in Render's environment, never in the repo, and give it access to
  this one bucket only.
- **Cost growth.** Storage is cheap (cents per GB per month), but downloads
  are billed on GCS and S3 (R2 doesn't charge for them). Set a budget alert.
- **Database and storage drifting apart.** A photo uploaded but its record
  not saved (or the reverse) leaves an orphan file or a broken record. The
  API uploads first and records second, so the worst case is an unused file.
- **Where the data lives.** Indian personal data: for production, choose an
  India region (GCS `asia-south1`, S3 `ap-south-1`).
- **Provider outage.** Rare; uploads fail meanwhile and the driver app retries.

GCS needs a small code change first (the API asks for AWS-only encryption on
upload, which GCS refuses).
