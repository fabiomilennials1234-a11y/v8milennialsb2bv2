# Google Calendar OAuth 2.0 Microservice

A Python FastAPI microservice for Google Calendar OAuth 2.0 integration, designed for the V8 Millennials B2B SaaS platform.

## Features

- **OAuth 2.0 Flow**: Secure Google Calendar connection with CSRF protection
- **Token Management**: Encrypted storage with automatic refresh
- **Calendar Operations**: Full CRUD for events
- **Internal API**: Dedicated endpoints for AI agents
- **Audit Logging**: All operations tracked for debugging

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────┐
│    Frontend     │────▶│  Calendar Service    │────▶│   Google    │
│    (React)      │     │     (FastAPI)        │     │  Calendar   │
└─────────────────┘     └──────────────────────┘     └─────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │    Supabase      │
                        │   PostgreSQL     │
                        └──────────────────┘
```

## Quick Start

### Prerequisites

- Python 3.12+
- Docker (optional)
- Google Cloud Console project with Calendar API enabled
- Supabase project

### 1. Clone and Setup

```bash
cd services/google-calendar-service
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

**Required Environment Variables:**

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | 32-byte base64 key for AES-256 |
| `INTERNAL_API_KEY` | API key for internal endpoints |
| `FRONTEND_URL` | Frontend app URL for redirects |

**Generate Keys:**

```python
from app.core.security import generate_encryption_key, generate_api_key
print("Encryption Key:", generate_encryption_key())
print("API Key:", generate_api_key())
```

### 3. Run Database Migration

```bash
# From project root
supabase db push
# Or apply migration manually in Supabase SQL editor
```

### 4. Start the Service

```bash
# Development
uvicorn app.main:app --reload --port 8000

# Production
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Docker
docker-compose up -d
```

## API Endpoints

### Authentication (User-Facing)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/google` | Initiate OAuth flow |
| GET | `/api/auth/callback` | Handle OAuth callback |
| GET | `/api/auth/status` | Check connection status |
| POST | `/api/auth/revoke` | Disconnect calendar |

### Calendar (User-Facing)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/calendar/calendars` | List user's calendars |
| GET | `/api/calendar/events` | List events |
| GET | `/api/calendar/events/{id}` | Get single event |
| POST | `/api/calendar/events` | Create event |
| PUT | `/api/calendar/events/{id}` | Update event |
| DELETE | `/api/calendar/events/{id}` | Delete event |

### Internal API (AI Agents)

All internal endpoints require `X-API-Key` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/internal/calendar/events` | Create event for user |
| PUT | `/api/internal/calendar/events/{id}` | Update event for user |
| DELETE | `/api/internal/calendar/events/{id}` | Delete event for user |
| GET | `/api/internal/calendar/availability/{user_id}` | Check availability |
| GET | `/api/internal/calendar/connection/{user_id}` | Check connection status |

## Usage Examples

### Frontend: Connect Calendar

```typescript
const connectCalendar = async () => {
  const response = await fetch('/api/auth/google', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const { authorization_url } = await response.json();
  window.location.href = authorization_url;
};
```

### AI Agent: Create Event

```python
import httpx

response = httpx.post(
    "http://calendar-service:8000/api/internal/calendar/events",
    headers={"X-API-Key": "your-api-key"},
    json={
        "user_id": "user-uuid",
        "calendar_id": "primary",
        "event": {
            "summary": "Meeting with Client",
            "start": "2026-01-28T14:00:00",
            "end": "2026-01-28T15:00:00",
            "timezone": "America/Sao_Paulo",
            "attendees": ["client@example.com"]
        },
        "metadata": {
            "source": "ai_agent",
            "agent_id": "copilot-uuid",
            "reference_type": "pipe_confirmacao",
            "reference_id": "lead-uuid"
        }
    }
)
```

### n8n Workflow Integration

```javascript
// HTTP Request node
{
  "method": "POST",
  "url": "{{ $env.CALENDAR_SERVICE_URL }}/api/internal/calendar/events",
  "headers": {
    "X-API-Key": "{{ $env.CALENDAR_API_KEY }}"
  },
  "body": {
    "user_id": "{{ $json.sdr_user_id }}",
    "event": {
      "summary": "Reunião: {{ $json.lead_name }}",
      "start": "{{ $json.meeting_date }}",
      "end": "{{ $json.meeting_date_end }}"
    }
  }
}
```

## Security

- **Token Encryption**: Refresh tokens encrypted with AES-256-GCM
- **CSRF Protection**: Signed state parameter for OAuth flow
- **API Key Auth**: Internal endpoints protected by API key
- **JWT Validation**: User endpoints validate Supabase JWT
- **RLS**: Database row-level security enabled

## Testing

```bash
# Run tests
pytest

# With coverage
pytest --cov=app --cov-report=html

# Run specific test file
pytest tests/test_security.py -v
```

## Deployment

### Docker

```bash
docker build -t google-calendar-service .
docker run -p 8000:8000 --env-file .env google-calendar-service
```

### Google Cloud Run

```bash
gcloud run deploy google-calendar-service \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_CLIENT_ID=...,..."
```

### Railway

```bash
railway up
```

## Google Cloud Console Setup

1. Create project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable **Google Calendar API** and **People API**
3. Configure OAuth consent screen (External)
4. Create OAuth 2.0 credentials (Web application)
5. Add authorized redirect URIs:
   - Development: `http://localhost:8000/api/auth/callback`
   - Production: `https://your-domain.com/api/auth/callback`

## Troubleshooting

### "Token refresh failed"
- Check if user revoked access in Google Account settings
- Verify `GOOGLE_CLIENT_SECRET` is correct

### "Invalid state parameter"
- State expired (>10 minutes old)
- User opened multiple OAuth tabs

### "Calendar not connected"
- User hasn't completed OAuth flow
- Token was revoked

## License

Proprietary - V8 Millennials B2B SaaS Platform
