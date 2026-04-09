FROM python:3.11-slim

WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir flask

# Copy project files
COPY server.py .
COPY index.html .
COPY style.css .
COPY admin/ ./admin/

# data/ and uploads/ are mounted as volumes — not copied into the image
# This ensures content persists across container restarts and rebuilds

EXPOSE 8080

CMD ["python3", "server.py"]
