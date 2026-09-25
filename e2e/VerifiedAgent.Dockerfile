FROM orbit-e2e:swe
USER root
COPY e2e/orbit-test.py /usr/local/bin/orbit-test
RUN chmod 755 /usr/local/bin/orbit-test
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/evaluation-python && /opt/evaluation-python/bin/pip install --no-cache-dir \
    pip==24.0 setuptools==69.5.1 wheel==0.43.0 \
    pytest==7.2.0 py==1.11.0 hypothesis==6.75.3 asgiref==3.7.2 sqlparse==0.4.4 \
    sphinx==5.0.2 docutils==0.18.1 Jinja2==3.1.2 \
    sphinxcontrib-applehelp==1.0.4 sphinxcontrib-devhelp==1.0.2 \
    sphinxcontrib-htmlhelp==2.0.1 sphinxcontrib-qthelp==1.0.3 sphinxcontrib-serializinghtml==1.1.5 \
    alabaster==0.7.12 snowballstemmer==2.2.0 Pygments==2.14.0 pluggy==1.0.0 attrs==22.2.0 packaging==23.1 && chown -R node:node /opt/evaluation-python
ENV PATH="/opt/evaluation-python/bin:$PATH"
ENV PYTHONPATH="/workspace:/workspace/src:/workspace/tests"
ENV PYTEST_DISABLE_PLUGIN_AUTOLOAD=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV SHELLOPTS=pipefail
USER node
