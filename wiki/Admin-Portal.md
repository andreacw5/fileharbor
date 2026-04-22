# Admin Portal

The Admin Portal provides a JWT-secured management interface for cross-client operations, statistics, and user administration.

It is **completely separate** from the client API Key system.

---

## Setup

The first `SUPER_ADMIN` account is auto-seeded on startup if no admin users exist:

```env
ADMIN_DEFAULT_EMAIL=admin@example.com
ADMIN_DEFAULT_PASSWORD=supersecretpassword
ADMIN_DEFAULT_NAME=Super Admin   # optional
JWT_ADMIN_SECRET=your-secret-key
JWT_ADMIN_EXPIRES_IN=8h
JWT_ADMIN_REFRESH_SECRET=your-refresh-secret
JWT_ADMIN_REFRESH_EXPIRES_IN=7d
```

---

## Authentication

See [Authentication – Admin JWT](Authentication#admin-jwt-authentication) for the full login/refresh/logout flow.

---

## Roles

| Role | Permissions |
|------|-------------|
| `SUPER_ADMIN` | Full access: all clients, all admin management, create other admins |
| `ADMIN` | Access to clients in `allowedClientIds` only (when `allClientsAccess = false`) |
| `VIEWER` | Default role — read-only |

### Client Access Control

When `allClientsAccess = false`, access is restricted to clients listed in the admin user's `AdminClientAccess` entries.

```http
# Grant client access to an admin
POST /v2/admin/clients/{clientId}/access
Authorization: Bearer <super-admin-token>

{
  "adminUserId": "admin-uuid"
}
```

---

## Key Admin Operations

### Statistics

```http
GET /v2/admin/stats
Authorization: Bearer <token>
```

Returns global totals (images, avatars, albums, clients) plus per-client breakdowns.

### Upload Image on Behalf of a Client

```http
POST /v2/admin/images
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <binary>
clientId: <target-client-id>
externalUserId: user-123   # optional
```

### List / Search Tags

```http
GET /v2/admin/images/tags?search=landscape&limit=20
Authorization: Bearer <token>
```

---

## Profile Management

```http
# Get own profile
GET /v2/admin/auth/me

# Update name / email
PATCH /v2/admin/auth/me
{ "name": "New Name" }

# Change password
POST /v2/admin/auth/me/change-password
{ "currentPassword": "old", "newPassword": "new", "confirmPassword": "new" }
```

---

## Security Notes

- Access tokens are short-lived (default `8h`); refresh tokens are rotated on each use.
- Refresh tokens are stored as SHA-256 hashes in the database.
- Revoking a session invalidates the refresh token immediately.
- All admin endpoints require `@UseGuards(AdminJwtGuard)`.

