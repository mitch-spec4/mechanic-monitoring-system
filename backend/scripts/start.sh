#!/bin/sh
# Starts the app in the Docker image: database migrations first (unless the host runs them before
# each deploy, as Render's preDeployCommand does; then MIGRATE_ON_START=0), then gunicorn.
set -e
if [ "${MIGRATE_ON_START:-1}" = "1" ]; then
    flask --app run.py db upgrade
fi
exec gunicorn --config gunicorn.conf.py run:app
