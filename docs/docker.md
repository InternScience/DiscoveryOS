# Docker Deployment

Deploy DiscoveryOS with Docker in under 2 minutes.

## Prerequisites

- Docker Engine 24+ and Docker Compose v2
- At least one AI API key (OpenAI, Anthropic, etc.)

## Quick Start

```bash
git clone https://github.com/InternScience/DiscoveryOS.git
cd DiscoveryOS
cp .env.production.example .env.production.local
# Edit .env.production.local — set at least one API key
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000).

## Configuration

### Environment Variables

Edit `.env.production.local` before starting. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `WORKSPACE_ROOTS` | Yes | Comma-separated paths **inside the container** (e.g., `/research`) |
| `OPENAI_API_KEY` | At least one AI key | OpenAI API key |
| `ANTHROPIC_API_KEY` | | Anthropic API key |
| `DATABASE_URL` | No | SQLite path (default: `./data/discoveryos.db`) |
| `LLM_PROVIDER` | No | Default provider (`openai`, `anthropic`, etc.) |

See [.env.production.example](../.env.production.example) for the full list.

### Volumes

| Container Path | Purpose | Compose Default |
|----------------|---------|-----------------|
| `/app/data` | SQLite database, HF datasets, embeddings | Named volume `discoveryos-data` |
| `/research` | Your workspace files | `HOST_WORKSPACE_PATH` env var or `./workspace` |

To expose multiple workspace directories, add more volume mounts in `docker-compose.yml` and update `WORKSPACE_ROOTS` accordingly:

```yaml
volumes:
  - discoveryos-data:/app/data
  - /home/user/papers:/papers
  - /home/user/code:/code
```
```ini
WORKSPACE_ROOTS=/papers,/code
```

### Port

Default: `3000`. Change in `docker-compose.yml`:

```yaml
ports:
  - "8080:3000"
```

## Reverse Proxy

DiscoveryOS works behind any reverse proxy. Examples:

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name discoveryos.example.com;

    ssl_certificate     /etc/ssl/certs/discoveryos.pem;
    ssl_certificate_key /etc/ssl/private/discoveryos.key;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Caddy

```
discoveryos.example.com {
    reverse_proxy localhost:3000
}
```

Caddy handles TLS automatically.

## Persistent Data & Backups

All persistent state lives in the `discoveryos-data` volume:

- `discoveryos.db` — SQLite database (notebooks, chat history, settings)
- `hf-datasets/` — cached HuggingFace datasets

**Backup the database:**

```bash
docker compose exec discoveryos cp /app/data/discoveryos.db /app/data/discoveryos.db.bak
# Or copy to host:
docker cp $(docker compose ps -q discoveryos):/app/data/discoveryos.db ./backup.db
```

## Upgrading

```bash
git pull
docker compose build
docker compose up -d
```

Database migrations run automatically on container startup — no manual steps needed.

## Build from Scratch

```bash
docker build -t discoveryos .
docker run -d \
  --name discoveryos \
  -p 3000:3000 \
  --env-file .env.production.local \
  -v discoveryos-data:/app/data \
  -v /path/to/your/research:/research \
  discoveryos
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `/app/data is not writable` | Ensure the Docker volume is mounted and the container user has write access |
| `workspace root missing` | Mount your host directory in `docker-compose.yml` and match `WORKSPACE_ROOTS` |
| `no AI API key detected` | Edit `.env.production.local` and set at least one valid API key |
| `drizzle-kit migrate failed` | Usually harmless on first run; check that `/app/data` is writable |
| Container exits immediately | Run `docker compose logs discoveryos` to see the startup error |
