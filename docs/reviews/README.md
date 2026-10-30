# Reviews

| Data | Review | Stato | Finding aperti |
|---|---|---|---|
| 2026-10-30 | [Product review 4.1.2](2026-10-30-product-review.md) — performance consegna, sicurezza, correttezza, job, infra, API | in-progress | blocchi "Subito", "Prossimo" e "Poi" di §10 fatti; resta "Quando serve" e 1 L security (API key in chiaro) |

## Finding di sicurezza aperti

Dalla review 2026-10-30 (§4):

- **L** API key in chiaro nel DB (`client.service.ts:44`).
