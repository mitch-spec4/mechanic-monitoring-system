"""gunicorn settings for the Docker image (scripts/start.sh). Each can be changed with an environment
variable of the same idea: PORT, WEB_CONCURRENCY, GUNICORN_THREADS, GUNICORN_TIMEOUT."""
import os

bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"
# Two processes with four threads each suit a small instance (512 MB); raise WEB_CONCURRENCY with memory.
workers = int(os.getenv("WEB_CONCURRENCY", "2"))
worker_class = "gthread"
threads = int(os.getenv("GUNICORN_THREADS", "4"))
# Long enough for a video upload over a slow phone connection (when files go through the app) and
# for the daily run, which /api/cron/daily does in one request.
timeout = int(os.getenv("GUNICORN_TIMEOUT", "180"))
graceful_timeout = 30
# Access lines and errors to stdout and stderr, where the host keeps them. Who the client is comes
# from the host's proxy (X-Forwarded-*): the app reads that itself, with TRUSTED_PROXY_COUNT.
accesslog = "-"
errorlog = "-"
