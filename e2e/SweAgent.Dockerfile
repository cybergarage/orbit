FROM orbit-e2e:local
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3-mpmath python3-pytest && rm -rf /var/lib/apt/lists/*
USER node
