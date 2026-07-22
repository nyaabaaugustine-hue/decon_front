# decon-fleet-api

Backend API for the Degoony Evergreen Fleet Dashboard.

## Stack
- Express 5 + TypeScript
- Neon Postgres (serverless driver)
- MinIO / Cloudinary for file storage
- Deployed on Render

## Local Development
```bash
npm install
cp .env.example .env  # fill in your env vars
npm run server:dev     # hot-reload
```

## Environment Variables
See `.env.example` for the full list. Required:
- `DATABASE_URL` — Neon Postgres connection string
- `JWT_SECRET` — Random string for session tokens
- `CLOUDINARY_*` — Cloudinary API credentials
- `MINIO_*` — MinIO/S3 credentials

## Deployment
Configured via `render.yaml`. Push to `main` to deploy.
