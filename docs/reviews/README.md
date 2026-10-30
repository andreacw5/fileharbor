# Reviews

| Data | Review | Stato | Finding aperti |
|---|---|---|---|
| 2026-10-30 | [Product review 4.1.2](2026-10-30-product-review.md) — performance consegna, sicurezza, correttezza, job, infra, API | in-progress | blocco "Subito" di §10 fatto (placeholder nell'immagine, stream da disco, views video, ETag avatar, 500 generici); restano i blocchi perf/correttezza e 9 L security |

## Finding di sicurezza aperti

Dalla review 2026-10-30 (§4):

- **L** share link da API key su immagini pubbliche e senza scadenza (`image.service.ts:885`).
- **L** `expiresInDays` album token senza max, default eterno (`album.service.ts:552`).
- **L** tmp video non rimosso su 400/403 prima del service (`video-delivery.ts:10`).
- **L** `PATCH /admin/videos/:id` senza DTO, `ValidationPipe` inerte (`videos-admin.controller.ts:251`).
- **L** URL Tinify scaricato senza origin check, SSRF + key (`image.service.ts:1617`).
- **L** `Album.creatorId` con `X-User-Id` grezzo (`album.service.ts:146`).
- **L** API key in chiaro nel DB (`client.service.ts:44`).
- **L** placeholder 403 vs 404 oracolo di esistenza (`image.controller.ts:402`).
