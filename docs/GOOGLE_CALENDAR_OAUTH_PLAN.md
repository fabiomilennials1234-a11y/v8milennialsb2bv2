# Google Calendar OAuth 2.0 Microservice Integration Plan

## Executive Summary

This document outlines the architecture and implementation plan for integrating Google Calendar OAuth 2.0 into the V8 Millennials B2B SaaS platform. The integration will allow users to connect their Google Calendar accounts, enabling AI agents to create, update, and manage calendar events on their behalf.

---

## Architecture Decision

### Option A: Standalone Python Microservice (FastAPI) ✅ RECOMMENDED

**Pros:**
- User specifically requested Python implementation
- Rich Google API client libraries (`google-api-python-client`, `google-auth`)
- Better control over OAuth flow complexity
- Independent scaling and deployment
- Easier testing and debugging
- Can run as Docker container on Cloud Run, Railway, or similar

**Cons:**
- Additional infrastructure to maintain
- Requires separate deployment pipeline
- Need to establish communication with Supabase

### Option B: Supabase Edge Functions (Deno/TypeScript)

**Pros:**
- Consistent with existing architecture
- Managed infrastructure
- Secrets already configured

**Cons:**
- Limited execution time (50s max)
- Deno ecosystem less mature for Google APIs
- OAuth state management more complex in serverless

### Decision: Option A - Python Microservice with FastAPI

Given the user's explicit requirement for Python and the complexity of OAuth flows, a standalone FastAPI microservice is the recommended approach. It will communicate with Supabase PostgreSQL for data persistence.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React)                                │
│  ┌─────────────────┐                                                        │
│  │ Connect Google  │ ──────────────────────────────────────┐                │
│  │     Button      │                                       │                │
│  └─────────────────┘                                       ▼                │
└────────────────────────────────────────────────────────────┼────────────────┘
                                                             │
                    ┌────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    GOOGLE CALENDAR MICROSERVICE (Python/FastAPI)            │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │   OAuth Module   │  │  Calendar Module │  │   Token Module   │          │
│  │                  │  │                  │  │                  │          │
│  │ • /auth/google   │  │ • /events (CRUD) │  │ • Token refresh  │          │
│  │ • /auth/callback │  │ • /calendars     │  │ • Token encrypt  │          │
│  │ • /auth/revoke   │  │ • /availability  │  │ • Token validate │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────┐          │
│  │                    Internal API Layer                         │          │
│  │  (For AI Agents - No user interaction required)               │          │
│  │  • POST /internal/events/create                               │          │
│  │  • PUT  /internal/events/{id}                                 │          │
│  │  • DELETE /internal/events/{id}                               │          │
│  │  • GET  /internal/availability/{user_id}                      │          │
│  └──────────────────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                              │
                    │                              │
                    ▼                              ▼
┌─────────────────────────────┐    ┌─────────────────────────────┐
│      Google Calendar API    │    │   Supabase PostgreSQL       │
│                             │    │                             │
│  • OAuth 2.0 endpoints      │    │  • google_calendar_tokens   │
│  • Calendar API v3          │    │  • calendar_sync_logs       │
│  • Token refresh            │    │  • Encryption keys          │
└─────────────────────────────┘    └─────────────────────────────┘
```

---

## OAuth 2.0 Flow (Step-by-Step)

### Phase 1: User Initiates Connection

```
1. User clicks "Connect with Google" button in React frontend
2. Frontend calls: GET /api/calendar/auth/google?user_id={supabase_user_id}
3. Microservice generates:
   - Random state parameter (CSRF protection)
   - Stores state + user_id in Redis/DB with 10-minute TTL
4. Microservice returns Google OAuth URL
5. Frontend redirects user to Google consent screen
```

### Phase 2: Google Authorization

```
6. User grants calendar permissions on Google
7. Google redirects to: /api/calendar/auth/callback?code={auth_code}&state={state}
8. Microservice validates state parameter
9. Microservice exchanges auth_code for tokens:
   - access_token (short-lived, ~1 hour)
   - refresh_token (long-lived, stored securely)
   - expires_in (seconds until expiration)
```

### Phase 3: Token Storage

```
10. Microservice encrypts refresh_token using AES-256-GCM
11. Stores in google_calendar_tokens table:
    - user_id (FK to auth.users)
    - encrypted_refresh_token
    - access_token_expires_at
    - google_email (for display)
    - scopes_granted
    - connected_at
12. Redirects user back to frontend with success status
```

### Phase 4: Token Refresh (Automatic)

```
13. Before any Calendar API call:
    - Check if access_token expired
    - If expired, use refresh_token to get new access_token
    - Update access_token_expires_at in database
14. If refresh fails (revoked), mark connection as invalid
```

---

## Database Schema

### New Tables

```sql
-- Migration: 20260126000001_create_google_calendar_tables.sql

-- Store encrypted OAuth tokens per user
CREATE TABLE google_calendar_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id),

    -- Google account info (display only, not sensitive)
    google_email TEXT NOT NULL,
    google_account_id TEXT NOT NULL,

    -- Encrypted tokens (AES-256-GCM)
    encrypted_refresh_token TEXT NOT NULL,
    encryption_key_id TEXT NOT NULL, -- Reference to key version

    -- Token metadata
    access_token_expires_at TIMESTAMPTZ,
    scopes_granted TEXT[] NOT NULL,

    -- Connection status
    is_active BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMPTZ,
    last_error TEXT,

    -- Audit
    connected_at TIMESTAMPTZ DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    -- Constraints
    UNIQUE(user_id), -- One Google Calendar per user
    UNIQUE(google_account_id) -- Prevent duplicate connections
);

-- Index for quick lookups
CREATE INDEX idx_google_calendar_tokens_user ON google_calendar_tokens(user_id);
CREATE INDEX idx_google_calendar_tokens_org ON google_calendar_tokens(organization_id);

-- Enable RLS
ALTER TABLE google_calendar_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own tokens"
    ON google_calendar_tokens FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all tokens"
    ON google_calendar_tokens FOR ALL
    USING (auth.role() = 'service_role');

-- Sync/audit log for calendar operations
CREATE TABLE google_calendar_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    operation TEXT NOT NULL, -- 'create_event', 'update_event', 'delete_event', 'sync'
    google_event_id TEXT,
    local_reference_id UUID, -- Reference to pipe_confirmacao, follow_ups, etc.
    local_reference_type TEXT, -- 'pipe_confirmacao', 'follow_up', etc.

    status TEXT NOT NULL, -- 'success', 'failed', 'pending'
    error_message TEXT,
    request_payload JSONB,
    response_payload JSONB,

    initiated_by TEXT NOT NULL, -- 'user', 'ai_agent', 'system'
    agent_id UUID REFERENCES copilot_agents(id),

    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_calendar_sync_logs_user ON google_calendar_sync_logs(user_id);
CREATE INDEX idx_calendar_sync_logs_operation ON google_calendar_sync_logs(operation);
CREATE INDEX idx_calendar_sync_logs_created ON google_calendar_sync_logs(created_at DESC);

-- Enable RLS
ALTER TABLE google_calendar_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own logs"
    ON google_calendar_sync_logs FOR SELECT
    USING (auth.uid() = user_id);

-- Updated at trigger
CREATE TRIGGER update_google_calendar_tokens_updated_at
    BEFORE UPDATE ON google_calendar_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

---

## API Contract

### Authentication Endpoints (User-Facing)

#### 1. Initiate OAuth Connection
```
GET /api/calendar/auth/google

Headers:
  Authorization: Bearer {supabase_jwt}

Response:
{
  "authorization_url": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "state": "abc123..."
}
```

#### 2. OAuth Callback
```
GET /api/calendar/auth/callback?code={code}&state={state}

Response: Redirect to frontend with status
  Success: {frontend_url}/settings/integrations?google=connected
  Error: {frontend_url}/settings/integrations?google=error&reason={reason}
```

#### 3. Check Connection Status
```
GET /api/calendar/auth/status

Headers:
  Authorization: Bearer {supabase_jwt}

Response:
{
  "connected": true,
  "google_email": "user@gmail.com",
  "connected_at": "2026-01-26T10:00:00Z",
  "scopes": ["calendar.events", "calendar.readonly"],
  "last_sync": "2026-01-26T12:00:00Z"
}
```

#### 4. Revoke Connection
```
POST /api/calendar/auth/revoke

Headers:
  Authorization: Bearer {supabase_jwt}

Response:
{
  "success": true,
  "message": "Google Calendar disconnected"
}
```

### Calendar Endpoints (User-Facing)

#### 5. List Calendars
```
GET /api/calendar/calendars

Headers:
  Authorization: Bearer {supabase_jwt}

Response:
{
  "calendars": [
    {
      "id": "primary",
      "summary": "user@gmail.com",
      "primary": true,
      "access_role": "owner"
    }
  ]
}
```

#### 6. List Events
```
GET /api/calendar/events?start={iso_date}&end={iso_date}&calendar_id={id}

Headers:
  Authorization: Bearer {supabase_jwt}

Response:
{
  "events": [
    {
      "id": "event123",
      "summary": "Meeting with Client",
      "start": "2026-01-27T10:00:00-03:00",
      "end": "2026-01-27T11:00:00-03:00",
      "attendees": ["client@company.com"],
      "status": "confirmed"
    }
  ]
}
```

### Internal API Endpoints (AI Agent Consumption)

These endpoints require service-to-service authentication (API key), not user JWT.

#### 7. Create Event (AI Agent)
```
POST /api/internal/calendar/events

Headers:
  X-API-Key: {internal_api_key}

Body:
{
  "user_id": "uuid-of-user",
  "calendar_id": "primary",
  "event": {
    "summary": "Reunião de Fechamento - Empresa XYZ",
    "description": "Discussão de proposta comercial",
    "start": "2026-01-28T14:00:00",
    "end": "2026-01-28T15:00:00",
    "timezone": "America/Sao_Paulo",
    "attendees": ["cliente@empresa.com"],
    "reminders": {
      "use_default": false,
      "overrides": [
        {"method": "email", "minutes": 60},
        {"method": "popup", "minutes": 15}
      ]
    }
  },
  "metadata": {
    "source": "ai_agent",
    "agent_id": "uuid-of-agent",
    "reference_type": "pipe_confirmacao",
    "reference_id": "uuid-of-lead"
  }
}

Response:
{
  "success": true,
  "event_id": "google_event_id",
  "html_link": "https://calendar.google.com/event?eid=..."
}
```

#### 8. Update Event (AI Agent)
```
PUT /api/internal/calendar/events/{google_event_id}

Headers:
  X-API-Key: {internal_api_key}

Body:
{
  "user_id": "uuid-of-user",
  "updates": {
    "summary": "Updated: Reunião de Fechamento",
    "start": "2026-01-28T15:00:00",
    "end": "2026-01-28T16:00:00"
  }
}

Response:
{
  "success": true,
  "event_id": "google_event_id"
}
```

#### 9. Delete Event (AI Agent)
```
DELETE /api/internal/calendar/events/{google_event_id}

Headers:
  X-API-Key: {internal_api_key}

Body:
{
  "user_id": "uuid-of-user",
  "send_updates": "all" // or "none"
}

Response:
{
  "success": true
}
```

#### 10. Check Availability (AI Agent)
```
GET /api/internal/calendar/availability/{user_id}?date={date}

Headers:
  X-API-Key: {internal_api_key}

Response:
{
  "user_id": "uuid",
  "date": "2026-01-28",
  "timezone": "America/Sao_Paulo",
  "busy_slots": [
    {"start": "09:00", "end": "10:00"},
    {"start": "14:00", "end": "15:30"}
  ],
  "free_slots": [
    {"start": "10:00", "end": "12:00"},
    {"start": "13:00", "end": "14:00"},
    {"start": "15:30", "end": "18:00"}
  ]
}
```

---

## Security: Token Storage Strategy

### Encryption at Rest

```python
# Token encryption using AES-256-GCM
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import os
import base64

class TokenEncryptor:
    def __init__(self, master_key: bytes):
        # Master key from environment variable (32 bytes for AES-256)
        self.aesgcm = AESGCM(master_key)

    def encrypt(self, plaintext: str) -> tuple[str, str]:
        """Encrypt token, return (ciphertext, nonce) as base64"""
        nonce = os.urandom(12)  # 96-bit nonce for GCM
        ciphertext = self.aesgcm.encrypt(
            nonce,
            plaintext.encode('utf-8'),
            None  # No additional authenticated data
        )
        return (
            base64.b64encode(ciphertext).decode('utf-8'),
            base64.b64encode(nonce).decode('utf-8')
        )

    def decrypt(self, ciphertext_b64: str, nonce_b64: str) -> str:
        """Decrypt token from base64 encoded values"""
        ciphertext = base64.b64decode(ciphertext_b64)
        nonce = base64.b64decode(nonce_b64)
        plaintext = self.aesgcm.decrypt(nonce, ciphertext, None)
        return plaintext.decode('utf-8')
```

### Key Management

- Master encryption key stored as environment variable: `GOOGLE_TOKEN_ENCRYPTION_KEY`
- Key rotation supported via `encryption_key_id` field
- Never log or expose tokens in error messages

### Security Checklist

- [x] Refresh tokens encrypted with AES-256-GCM
- [x] Access tokens never stored (generated on-demand)
- [x] State parameter for CSRF protection
- [x] Tokens never exposed to frontend
- [x] RLS policies restrict access to own tokens
- [x] Internal APIs protected by API key
- [x] All operations logged for audit

---

## Google Cloud Console Configuration

### Step 1: Create Project
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create new project: "V8 Millennials Calendar Integration"
3. Note the Project ID

### Step 2: Enable APIs
1. Go to APIs & Services > Library
2. Enable:
   - Google Calendar API
   - Google People API (for email/profile info)

### Step 3: Configure OAuth Consent Screen
1. Go to APIs & Services > OAuth consent screen
2. Select "External" user type
3. Fill in:
   - App name: "V8 Millennials"
   - User support email: your-email@domain.com
   - Developer contact: your-email@domain.com
4. Add scopes:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
5. Add test users (during development)

### Step 4: Create OAuth Credentials
1. Go to APIs & Services > Credentials
2. Create Credentials > OAuth client ID
3. Application type: Web application
4. Name: "V8 Calendar Microservice"
5. Authorized JavaScript origins:
   - `https://your-frontend-domain.com`
   - `http://localhost:5173` (development)
6. Authorized redirect URIs:
   - `https://your-api-domain.com/api/calendar/auth/callback`
   - `http://localhost:8000/api/calendar/auth/callback` (development)
7. Download JSON credentials

### Step 5: Production Verification
1. Submit app for Google verification (required for >100 users)
2. Prepare privacy policy and terms of service
3. Create demo video showing OAuth flow

---

## Microservice Structure

```
google-calendar-service/
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI application
│   ├── config.py               # Settings from environment
│   │
│   ├── api/
│   │   ├── __init__.py
│   │   ├── deps.py             # Dependencies (auth, db)
│   │   ├── auth/
│   │   │   ├── __init__.py
│   │   │   ├── router.py       # OAuth endpoints
│   │   │   └── service.py      # OAuth logic
│   │   ├── calendar/
│   │   │   ├── __init__.py
│   │   │   ├── router.py       # Calendar endpoints
│   │   │   └── service.py      # Calendar operations
│   │   └── internal/
│   │       ├── __init__.py
│   │       ├── router.py       # AI agent endpoints
│   │       └── service.py      # Internal operations
│   │
│   ├── core/
│   │   ├── __init__.py
│   │   ├── security.py         # Token encryption
│   │   ├── google_client.py    # Google API wrapper
│   │   └── exceptions.py       # Custom exceptions
│   │
│   ├── db/
│   │   ├── __init__.py
│   │   ├── database.py         # Supabase connection
│   │   ├── models.py           # Pydantic models
│   │   └── repositories.py     # Data access layer
│   │
│   └── schemas/
│       ├── __init__.py
│       ├── auth.py             # Auth request/response
│       ├── calendar.py         # Calendar request/response
│       └── events.py           # Event schemas
│
├── tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── test_auth.py
│   ├── test_calendar.py
│   └── test_internal.py
│
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── .env.example
└── README.md
```

---

## Environment Variables

```bash
# .env.example

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://your-api-domain.com/api/calendar/auth/callback

# Supabase
SUPABASE_URL=https://twoghutcvlfgemadaeez.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Security
GOOGLE_TOKEN_ENCRYPTION_KEY=32-byte-base64-encoded-key
INTERNAL_API_KEY=secure-random-api-key-for-agents

# Frontend
FRONTEND_URL=https://your-frontend-domain.com

# Application
APP_ENV=production
LOG_LEVEL=INFO
```

---

## AI Agent Integration Notes

### How AI Agents Will Consume This Service

1. **Authentication**: AI agents use the `INTERNAL_API_KEY` to authenticate
2. **User Context**: Agents pass `user_id` to identify whose calendar to access
3. **No User Interaction**: All internal endpoints work without user presence
4. **Audit Trail**: All operations logged with `agent_id` for traceability

### Integration Example (n8n Workflow)

```javascript
// In n8n HTTP Request node
{
  "method": "POST",
  "url": "https://calendar-service.your-domain.com/api/internal/calendar/events",
  "headers": {
    "X-API-Key": "{{ $env.CALENDAR_SERVICE_API_KEY }}",
    "Content-Type": "application/json"
  },
  "body": {
    "user_id": "{{ $json.user_id }}",
    "calendar_id": "primary",
    "event": {
      "summary": "Reunião: {{ $json.lead_name }}",
      "start": "{{ $json.meeting_date }}",
      "end": "{{ $json.meeting_date | plusHours(1) }}",
      "timezone": "America/Sao_Paulo"
    },
    "metadata": {
      "source": "ai_agent",
      "agent_id": "{{ $json.agent_id }}",
      "reference_type": "pipe_confirmacao",
      "reference_id": "{{ $json.lead_id }}"
    }
  }
}
```

### Future Enhancements for AI

1. **Conflict Detection**: Before creating events, check availability
2. **Smart Scheduling**: AI suggests optimal meeting times
3. **Recurring Events**: Support for weekly/monthly patterns
4. **Meeting Room Booking**: Integration with Google Workspace rooms
5. **Two-Way Sync**: Sync external calendar changes back to app

---

## Implementation Phases

### Phase 1: Core OAuth (Week 1)
- [ ] Set up FastAPI project structure
- [ ] Implement Google OAuth flow
- [ ] Create database migrations
- [ ] Token encryption/storage
- [ ] Basic error handling

### Phase 2: Calendar Operations (Week 2)
- [ ] List calendars endpoint
- [ ] CRUD events endpoints
- [ ] Token refresh middleware
- [ ] Connection status endpoint
- [ ] Revoke connection endpoint

### Phase 3: Internal API (Week 3)
- [ ] Internal authentication (API key)
- [ ] AI agent endpoints
- [ ] Availability checking
- [ ] Audit logging
- [ ] Rate limiting

### Phase 4: Frontend Integration (Week 4)
- [ ] React component for "Connect with Google"
- [ ] Connection status display
- [ ] Settings page integration
- [ ] Error handling UI

### Phase 5: Testing & Deployment (Week 5)
- [ ] Unit tests
- [ ] Integration tests
- [ ] Docker containerization
- [ ] CI/CD pipeline
- [ ] Production deployment

---

## Validation Checklist

- [x] Refresh tokens enable long-term access without user interaction
- [x] One Google Calendar connection maps to one internal user
- [x] Token revocation flow documented
- [x] Re-authorization flow supported (delete and reconnect)
- [x] Calendar APIs callable without frontend involvement
- [x] Internal API designed for AI agent consumption
- [x] Encryption at rest for sensitive tokens
- [x] Audit logging for all operations
- [x] Clean separation: auth logic vs calendar logic
- [x] Multi-tenant support via organization_id

---

## Questions for Implementation

Before proceeding, please confirm:

1. **Deployment Target**: Where should the Python microservice run?
   - Railway
   - Google Cloud Run
   - AWS Lambda/ECS
   - Self-hosted Docker

2. **Primary Calendar**: Should we only support primary calendar, or allow selecting specific calendars?

3. **Event Linking**: Should we create a separate table to link Google events to local entities (pipe_confirmacao, follow_ups)?

4. **Webhook Updates**: Do you want real-time updates from Google Calendar (push notifications)?
