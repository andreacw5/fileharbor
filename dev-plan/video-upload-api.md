# FileHarbor — Video Upload API Reference

## Endpoint

```
POST /{API_PREFIX}/videos/upload
Content-Type: multipart/form-data
```

Default prefix: `v2` → `POST /v2/videos/upload`

## Auth headers

| Header | Tipo | Note |
|--------|------|------|
| `X-API-Key` | string | **Obbligatorio** — API key del client tenant |
| `X-User-Id` | string | Opzionale — se omesso, video attribuito a `system` |

## Form fields

| Campo | Tipo | Obbligatorio | Note |
|-------|------|-------------|------|
| `file` | binary | ✅ | Solo MP4. Max size da env `MAX_VIDEO_SIZE` (default 500 MB) |
| `tags` | string | No | Stringa CSV: `"tag1,tag2,tag3"` — oppure più campi `tags[]` |
| `description` | string | No | Testo libero |
| `isPrivate` | string | No | `"true"` / `"false"` (default `"false"`) |
| `userId` | string | No | Override di `X-User-Id` per attribuire a utente specifico |

> Il campo `tags` in multipart/form-data va inviato come stringa CSV (`"design,marketing"`) oppure come campi ripetuti (`tags=design&tags=marketing`). Il backend parse entrambi.

## Esempio — curl

```bash
curl -X POST "https://api.example.com/v2/videos/upload" \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "X-User-Id: user_external_123" \
  -F "file=@/path/to/video.mp4" \
  -F "tags=design,marketing" \
  -F "description=Tutorial onboarding Q3" \
  -F "isPrivate=false"
```

## Esempio — Node.js (FormData)

```javascript
const form = new FormData();
form.append('file', fs.createReadStream('./video.mp4'), { contentType: 'video/mp4' });
form.append('tags', tags.join(','));           // CSV string
form.append('description', description ?? '');
form.append('isPrivate', isPrivate ? 'true' : 'false');

const res = await fetch(`${API_BASE}/v2/videos/upload`, {
  method: 'POST',
  headers: {
    'X-API-Key': API_KEY,
    'X-User-Id': userId,   // ometti se non disponibile
    ...form.getHeaders(),
  },
  body: form,
});

const video = await res.json();
```

## Response `201`

```json
{
  "id": "uuid",
  "clientId": "uuid",
  "originalName": "video.mp4",
  "mimeType": "video/mp4",
  "size": 12345678,
  "duration": 42.5,
  "width": 1920,
  "height": 1080,
  "isPrivate": false,
  "tags": ["design", "marketing"],
  "description": "Tutorial onboarding Q3",
  "views": 0,
  "downloads": 0,
  "url": "/v2/videos/{id}",
  "thumbnailUrl": "/v2/videos/{id}/thumb",
  "createdAt": "2026-06-25T12:00:00.000Z",
  "user": { "externalUserId": "user_external_123" },
  "client": { "id": "uuid", "name": "Client Name" }
}
```

## Errori comuni

| Status | Motivo |
|--------|--------|
| `400` | Nessun file, file non MP4, `clientId` mancante |
| `401` | `X-API-Key` mancante o non valida |
| `413` | File supera `MAX_VIDEO_SIZE` |

## Differenze vs upload immagini

| | Immagini | Video |
|---|----------|-------|
| Endpoint | `POST /images/upload` | `POST /videos/upload` |
| Formato accettato | JPEG, PNG, WebP, GIF | Solo MP4 |
| Field file | `file` | `file` |
| Tags | `tags` (CSV o array) | `tags` (CSV o array) |
| Extra fields | — | `description`, `isPrivate` |
| Response extra | `url`, `thumbnailUrl` | `url`, `thumbnailUrl`, `duration`, `width`, `height` |
