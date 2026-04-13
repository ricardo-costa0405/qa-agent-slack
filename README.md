# QA Agent - AI-Powered QA Assistant

Self-hosted AI QA Agent using Ollama + n8n (or Node.js) + Slack.

## Quick Start

```bash
# Install dependencies
npm install

# Configure (copy .env.example to .env and fill in values)
cp .env.example .env

# Start the server
npm start
```

## Configuration (.env)

```bash
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b
PORT=3000

# Slack (optional)
SLACK_WEBHOOK_URL=  # Get from Slack app configuration
```

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/health` | GET | Health status |
| `/webhook` | POST | Generic webhook (send `{"message": "your question"}`) |
| `/slack` | POST | Slack events endpoint |

## Testing

```bash
# Test with curl
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"message":"What open bugs do we have?"}'
```

## Slack Setup (Free)

1. Go to https://api.slack.com/apps
2. Create new app → "From scratch"
3. Select your workspace
4. Go to **Incoming Webhooks** → Activate
5. "Add New Webhook to Workspace" → Select channel
6. Copy webhook URL → Add to `.env`

## Data

Mock data in `data/` folder:
- `mock_jira.json` - Simulated Jira issues
- `mock_confluence.json` - Simulated Confluence pages

## Architecture

```
Slack → Webhook → QA Agent (Node.js) → Ollama (qwen3:8b)
                                    ↓
                              Mock Data (Jira/Confluence)
```

## Next Steps

1. Replace mock data with real Jira/Confluence APIs
2. Add n8n as orchestrator (see docker-compose.yml)
3. Deploy to server