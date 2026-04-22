# Albums

Albums are collections of images that can be **public** or **private**. They are always scoped to a user within a client tenant.

---

## Creating Albums

```http
POST /v2/albums
X-API-Key: your-api-key
X-User-Id: user-123
Content-Type: application/json

{
  "name": "My Holiday Photos",
  "description": "Summer 2025",
  "isPublic": false,
  "albumId": "my-external-album-id"
}
```

The optional `albumId` field lets you reference albums by an ID from your own system. It must be unique per client.

---

## Public Albums

Public albums (`isPublic: true`) are accessible to anyone who knows the album ID — no authentication required. This is useful for sharing photo galleries.

---

## Private Albums

Private albums require either:
- The owner's `X-User-Id` header, **or**
- A valid **album access token** via the `token` query parameter

### Creating an Access Token

```http
POST /v2/albums/{albumId}/tokens
X-API-Key: your-api-key
X-User-Id: album-owner-id
Content-Type: application/json

{
  "expiresIn": 86400
}
```

The `expiresIn` is in seconds. Omit it for a non-expiring token.

### Using a Token

```http
GET /v2/albums/{albumId}?token=abc123...
```

Pass the token as a query parameter on any album request.

---

## Managing Album Images

### Add Images

```http
POST /v2/albums/{albumId}/images
X-API-Key: your-api-key
X-User-Id: user-123
Content-Type: application/json

{
  "imageIds": ["uuid-1", "uuid-2"]
}
```

### Remove Images

```http
DELETE /v2/albums/{albumId}/images
Content-Type: application/json

{
  "imageIds": ["uuid-1"]
}
```

### List Album Images

```http
GET /v2/albums/{albumId}/images
```

---

## External Album ID

The `albumId` field in the create payload maps to `externalAlbumId` in the database. This lets client applications reference albums using their own IDs without needing to track FileHarbor's internal UUIDs.

Uniqueness is enforced per client:
```
UNIQUE(clientId, externalAlbumId)
```

