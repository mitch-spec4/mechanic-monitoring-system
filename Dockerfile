# MechanicPro in one image: the API (Flask, served by gunicorn) and the built web app, on one site.
# Works on Render (render.yaml), Railway, Fly.io or any server with Docker. See SETUP.md, Deploying.

# 1. The web app.
FROM node:20-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# 2. The API, with the web app's files next to it.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FRONTEND_DIST=/app/web \
    APP_ENV=production
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist ./web
# Uploads, when STORAGE_BACKEND=local, go to a disk mounted here (render.yaml mounts one).
RUN useradd --create-home --uid 10001 mechanicpro \
    && mkdir -p /var/data/uploads \
    && chown -R mechanicpro /var/data /app
USER mechanicpro
EXPOSE 8000
CMD ["sh", "scripts/start.sh"]
