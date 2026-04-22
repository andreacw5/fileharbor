# Authentication

FileHarbor uses **two separate authentication systems**: API Key auth for regular clients, and JWT-based auth for the admin portal.

---

## Client API Key Authentication

All non-admin endpoints require an `X-API-Key` header containing the client's API key.

```http
X-API-Key: your-api-key-here
X-User-Id: user-123
```

| Header | Required | Description |
|--------|----------|-------------|
| `X-API-Key` | **Yes** | Client API key. Resolves the tenant. |
| `X-User-Id` | Depends on endpoint | External user ID from the client's own system. Required for user-scoped operations (albums, avatars). Optional for image upload (defaults to `system` user). |

> **Note**: The `X-Client-Id` header is **no longer supported**. Only `X-API-Key` is accepted.

### User Identity

FileHarbor auto-creates an internal `User` record on first use when a new `externalUserId` is seen for a client. You never need to pre-register users.

If `X-User-Id` is omitted, the image is attributed to a reserved `system` user that is automatically created alongside every new client.

### Public Endpoints

Endpoints marked `@Public()` do not require authentication. However, if a valid `X-API-Key` is supplied, it will still be used for access control (e.g. serving private images).

---

## Admin JWT Authentication

The admin module uses a **separate JWT Bearer token flow** — it does NOT use `X-API-Key`.

### Login Flow

```http
POST /v2/admin/auth/login
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "your-password"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbG...",
  "admin": { "id": "...", "email": "...", "name": "...", "role": "SUPER_ADMIN" }
}
```

A `HttpOnly` cookie named `admin_rt` is also set containing the refresh token.

### Using the Token

```http
Authorization: Bearer eyJhbG...
```

### Token Refresh

```http
POST /v2/admin/auth/refresh
```

Reads the `admin_rt` cookie, issues a new access token, and rotates the refresh cookie.

### Logout

```http
POST /v2/admin/auth/logout
```

Revokes the current session and clears the refresh cookie.

---

## Admin Roles & Access Control

| Role          | Description                                                                       |
|---------------|-----------------------------------------------------------------------------------|
| `SUPER_ADMIN` | Full access to all clients and admin management                                   |
| `ADMIN`       | Access limited to clients in `allowedClientIds` (when `allClientsAccess = false`) |
| `VIEWER`      | Default role — read-only access                                                   |

When `allClientsAccess = true`, the admin can operate on any client. Otherwise, access is restricted to the clients listed in `AdminClientAccess`.

---

## Rate Limiting

All routes are protected by a global rate limiter:

| Variable         | Default        | Description             |
|------------------|----------------|-------------------------|
| `THROTTLE_TTL`   | `60` (seconds) | Time window             |
| `THROTTLE_LIMIT` | `10`           | Max requests per window |

Configurable via environment variables.

