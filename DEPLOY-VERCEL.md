# Deploy on Vercel (step by step)

Vercel cannot keep files or SQLite databases, so this version uses:
- **Postgres** (free Neon database) for all data
- **Vercel Blob** for uploaded photos/documents
- a signed cookie for login sessions

## 1. Upload the project to GitHub
Create a new GitHub repository and upload the contents of this folder (do NOT upload `node_modules` or `.env`).

## 2. Create the database (Neon, free)
Vercel dashboard -> your project -> **Storage** -> **Create Database** -> **Neon (Postgres)**. Connect it to the project.
This adds `DATABASE_URL` automatically. (Tables are created automatically on the first request.)

## 3. Create the file storage
Same **Storage** tab -> **Create** -> **Blob** -> connect to the project.
This adds `BLOB_READ_WRITE_TOKEN` automatically.

## 4. Add the session secret
Settings -> **Environment Variables** -> add `SESSION_SECRET` = any long random text (40+ characters). Apply to Production, Preview and Development.

## 5. Deploy
Import the GitHub repo in Vercel. Framework preset: **Other**. Leave Build/Output settings empty (vercel.json handles it). Click **Deploy**.
If you added the storage/env vars AFTER the first deploy, click **Redeploy**.

## 6. Create the first admin (one time, on your computer)
In Vercel -> Storage -> your Neon database -> copy the `DATABASE_URL` connection string.
```bash
npm install
DATABASE_URL="paste-the-url-here" npm run create-admin
```
(Windows PowerShell: `$env:DATABASE_URL="paste-the-url-here"; npm run create-admin`)
Then open `https://your-site.vercel.app/login.html` and log in.

## Limits to know
- Each uploaded file must be small: admission photo/document up to 2 MB each; admin photos are resized automatically in the browser and uploaded one at a time.
- Old data from the local SQLite files (`school.db`, `content.db`) is NOT moved automatically; start fresh on Vercel.
