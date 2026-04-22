# Webhooks

FileHarbor can send real-time notifications to a **Discord webhook** when key events occur. Webhooks are opt-in per client.

---

## Enabling Webhooks

On the client record, set:

```json
{
  "webhookEnabled": true,
  "webhookUrl": "https://discord.com/api/webhooks/..."
}
```

This is managed via the Admin Portal (`PATCH /v2/admin/clients/:id`).

---

## Webhook Events

| Event | Trigger |
|-------|---------|
| `IMAGE_UPLOADED` | A new image is successfully uploaded |
| `IMAGE_DELETED` | An image is deleted |
| `AVATAR_UPLOADED` | A new avatar is uploaded or replaced |
| `AVATAR_DELETED` | An avatar is deleted |
| `ALBUM_CREATED` | A new album is created |

---

## Discord Embed Format

Notifications are sent as rich Discord embeds including:
- Event type and timestamp
- Client name / domain
- Image/avatar/album details (ID, size, dimensions)
- File size formatted as human-readable (e.g. `1.2 MB`)

---

## Failure Handling

Webhooks are **fire-and-forget**:
- Failures are logged as warnings but **never propagate** to the API response.
- The client's API request always succeeds regardless of webhook delivery.

```typescript
// Internal pattern
this.webhook.sendWebhook(clientId, WebhookEvent.IMAGE_UPLOADED, payload)
  .catch(error => this.logger.warn('Webhook failed', error));
```

---

## Notes

- Only Discord webhooks are currently supported.
- Webhooks use the `WebhookModule` which is globally exported and can be injected into any module.

