# Avatars

FileHarbor provides a dedicated avatar system. Each user can have **exactly one** avatar per client. Uploading a new avatar replaces the previous one automatically.

---

## Uploading an Avatar

```http
POST /v2/avatars
X-API-Key: your-api-key
Content-Type: multipart/form-data

file: <binary>
externalUserId: user-123
```

> Note: `externalUserId` is passed as a form field (not a header) for avatar uploads.

The avatar is:
- Converted to WebP
- Optimized with `ORIGINAL_QUALITY`
- A thumbnail is generated with `THUMBNAIL_QUALITY`
- The old avatar (if any) is deleted from disk and database

---

## Retrieving an Avatar

```http
GET /v2/avatars/{externalUserId}
X-API-Key: your-api-key
```

### Optional Query Parameters

| Parameter | Description |
|-----------|-------------|
| `thumb=true` | Return the thumbnail version |
| `w`, `h` | Resize on the fly |
| `q` | Quality override |

---

## Deleting an Avatar

```http
DELETE /v2/avatars/{externalUserId}
X-API-Key: your-api-key
```

This removes both the database record and the files from disk.

---

## Storage

Avatars are stored at:
```
storage/{client.domain}/avatars/{externalUserId}/original.webp
storage/{client.domain}/avatars/{externalUserId}/thumb.webp
```

The path uses `client.domain` if set, otherwise `clientId`.

