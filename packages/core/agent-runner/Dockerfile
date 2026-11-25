# Node for `pi`, which is a Node CLI (>= 22.19). The agy/claude binaries are
# self-contained; pi's package is mounted from the host at /opt/pi (compose).
FROM node:22-slim AS node

FROM python:3.12-slim

COPY --from=node /usr/local/bin/node /usr/local/bin/node
# The host's install is mounted read-only; this runs it like the host's `pi`.
RUN printf '#!/bin/sh\nexec node /opt/pi/dist/bundle/cli.js "$@"\n' > /usr/local/bin/pi \
    && chmod +x /usr/local/bin/pi

WORKDIR /app
COPY packages/core/agent-runner/runner.py /app/runner.py

EXPOSE 4850
CMD ["python", "/app/runner.py"]
