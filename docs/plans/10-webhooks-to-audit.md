---
type: plan
service: fileharbor
status: open
estimate: 0.5d
updated: 2026-10-24
verified: bd2eba5
---

# 10 · Via i webhook Discord, audit sulle cancellazioni della superficie client

Sostituisce il backlog 2b.6 ("Webhook mancanti").

## Problema

I webhook per client (`WebhookModule`, `client.webhookEnabled` + `client.webhookUrl`) postano solo
embed Discord: l'host è vincolato da `DISCORD_WEBHOOK_URL` (`webhook/webhook.service.ts:13`). Sono
un feed per persone, non un'integrazione: nessun servizio ci si iscrive
(`../docs/integrations/fileharbor.md:400`). Nessuno li guarda da tempo, e sono incompleti: niente
`image.updated`/`video.updated`, niente eventi per i video negli album (2b.6). Completarli vuol dire
mantenere un canale che non usa nessuno.

Il segnale utile che contengono è un altro: **chi ha cancellato cosa, e chi ha reso pubblico o
privato un contenuto**. Le scritture della console sono già tutte in audit (`@Audit` su ogni route
admin). La superficie `X-API-Key` (le app client) invece non lascia traccia, e dopo un delete la
riga non esiste più.

## Decisioni

- **Webhook eliminati, non convertiti.** Un audit per upload brucerebbe il budget di `/events` sul
  rumore, e l'upload è già nel DB (riga, `createdAt`, creator). Stessa logica dei bookmark, non
  auditati (`CLAUDE.md` → Audit).
- **Audit solo dove l'informazione si perde o cambia la visibilità**, sulla superficie client:
  - `DELETE /images/:imageId` → `fh_image.deleted`
  - `DELETE /videos/:id` → `fh_video.deleted`
  - `DELETE /avatars/:externalUserId` → `fh_avatar.deleted`
  - `DELETE /albums/:albumId` → `fh_album.deleted`
  - `PATCH /images/:imageId` e `PATCH /videos/:id` **solo se il body contiene `isPrivate`** →
    `fh_image.updated` / `fh_video.updated`.

  Fuori: upload, update di album e metadati, item aggiunti o rimossi dagli album, share link e token
  degli album (la riga resta, o è stato temporaneo per costruzione).
- **Stessi nomi evento della console**, distinti dall'attore. Gli eventi admin hanno
  `actorId`/`actorRole`/`actorAppSlug`; quelli client hanno `via: 'api_key'`, `clientId`,
  `externalUserId`. Una query su `fh_image.deleted` li trova tutti e due.
- **Nei controller client, non nei servizi.** `ImageService.deleteImage` & co. sono condivisi con le
  route admin, che hanno già `@Audit`: scrivere nel servizio raddoppierebbe gli eventi della console.
- **`BastionAuditService.write()` diretto, non `@Audit()`.** `AuditInterceptor` usa
  `request.adminUser` come attore. Sulle route client non c'è, e `writeAsAdmin` scriverebbe
  `actorId: 'unknown'`. Fire-and-forget come il resto: `void this.audit.write(...)` dopo che il
  servizio ha risposto, mai `await` (`write` già non lancia).
- **Metadata: id e nomi di campo, mai valori**: `{ via, clientId, externalUserId, imageId }`. Per i
  PATCH `fields: ['isPrivate']` più `isPrivate: <bool>`. Il booleano è il dato stesso che si vuole
  tracciare e non è un segreto: unica eccezione alla regola "solo nomi", da scrivere in `CLAUDE.md`.
- **`userId` mai valorizzato**: `externalUserId` è un id dell'app client, non un utente Bastion.
- **Colonne cancellate** (`webhookEnabled`, `webhookUrl`), non lasciate a morire: non serve
  conservare un URL Discord con token.

## Prima di iniziare

In prod, verificare che nessun client li usi:

```sql
SELECT id, name, "webhookUrl" IS NOT NULL AS has_url FROM clients WHERE "webhookEnabled" = true;
```

Se qualcuno li usa davvero, fermarsi e decidere prima di cancellare.

## Step

### 1. Meridian prima di tutto (repo separato)

`forbidNonWhitelisted` (nest-common): se FileHarbor toglie `webhookEnabled`/`webhookUrl` dal DTO
mentre Meridian li manda ancora, **ogni** `PATCH` di un client risponde 400. Quindi Meridian smette
di mandarli e va in deploy prima di FileHarbor.

- `app/pages/[tenant]/fileharbor/clients/[id].vue`: via la sezione webhook (form e visualizzazione).
- `server/api/[tenant]/fileharbor/clients/[id].patch.ts`: via i due campi dal body inoltrato.
- `app/types/fileharbor.ts`: via `webhookEnabled`/`webhookUrl` dal tipo client.
- i18n en/it: via le chiavi orfane (`test/i18n-parity.test.ts` verde).
- Non toccare i webhook di Gatherly (`gatherly/*`, `useGatherlySettings`): sono un'altra cosa.

### 2. FileHarbor: via il modulo

- Cancellare `src/modules/webhook/` (service, module, `webhook.service.spec.ts`, `webhook-url.spec.ts`).
- `image.module.ts`, `video.module.ts`, `avatar.module.ts`, `album.module.ts`: via `WebhookModule`.
  `image.module.ts` tiene `HttpModule.register({ timeout: 60_000 })`, che serve a Tinify.
- `image.service.ts`, `video.service.ts`, `avatar.service.ts`, `album.service.ts`: via l'iniezione
  di `WebhookService` e tutte le chiamate `sendWebhook(...)`, 18 in totale. Nel ciclo di
  `addItemsToAlbum`/`removeItemsFromAlbum` sparisce anche il `for` che esisteva solo per il webhook.
- Spec dei quattro servizi: via i mock di `WebhookService` e le asserzioni sui webhook.

### 3. Admin DTO e schema

- `admin-update-client.dto.ts`: via `webhookEnabled`, `webhookUrl` e l'import di `DISCORD_WEBHOOK_URL`.
- `admin-response.dto.ts`: via i due campi e il mascheramento del token.
- `clients-admin.controller.ts`: via le due assegnazioni. Il summary diventa "name, status and
  Tinify settings", e il commento sull'audit (metadata con soli nomi di campo per via della URL
  webhook) va aggiornato: il motivo resta la API key Tinify.
- `schema.prisma`: via `webhookEnabled` e `webhookUrl`. `pnpm run prisma:migrate --name
  drop_client_webhooks`.
- Single instance: la migrazione gira al boot prima del nuovo codice, nessun deploy in due tempi.
  Con più repliche in rolling, le vecchie fallirebbero sui select: in quel caso, prima rilascio senza
  uso delle colonne, poi migrazione.

### 4. Audit sulla superficie client

`BastionAuditService` è globale (`BastionModule.forRootAsync` in `bastion.module.ts`): basta
iniettarlo nei controller.

Helper locale in `src/common/client-audit.ts`, per non ripetere la forma dei metadata in sei punti:

```ts
/** Audit of a client-surface (X-API-Key) write. Never awaited: an audit must not fail the request. */
export function auditClientWrite(
  audit: BastionAuditService,
  event: string,
  clientId: string,
  externalUserId: string | undefined,
  metadata: Record<string, unknown>,
): void {
  void audit.write(event, {
    metadata: { via: 'api_key', clientId, externalUserId: externalUserId ?? null, ...metadata },
  });
}
```

Chiamarlo **dopo** la risposta positiva del servizio, nei controller:

| Controller | Route | Evento | Metadata extra |
|---|---|---|---|
| `image.controller.ts` | `DELETE :imageId` | `fh_image.deleted` | `imageId` |
| `image.controller.ts` | `PATCH :imageId`, solo con `'isPrivate' in dto` | `fh_image.updated` | `imageId`, `fields: ['isPrivate']`, `isPrivate` |
| `video.controller.ts` | `DELETE :id` | `fh_video.deleted` | `videoId` |
| `video.controller.ts` | `PATCH :id`, solo con `'isPrivate' in dto` | `fh_video.updated` | `videoId`, `fields: ['isPrivate']`, `isPrivate` |
| `avatar.controller.ts` | `DELETE :externalUserId` | `fh_avatar.deleted` | `externalUserId` del path |
| `album.controller.ts` | `DELETE :albumId` | `fh_album.deleted` | `albumId` |

`externalUserId` (l'attore) viene da `@CreatorExternalId()`. PATCH immagine/video e delete album lo
leggono già per l'ownership; `DELETE /images/:imageId` e `DELETE /videos/:id` no (basta la API key):
aggiungere il parametro solo per l'audit, opzionale, senza cambiare il controllo di accesso. In
`DELETE /avatars/:externalUserId` il path dice di chi è l'avatar, non chi cancella: leggere anche lì
`@CreatorExternalId()` per l'attore.

`/me/avatar` (`DELETE`, utente Bastion vero) resta fuori: è il proprietario che cancella il proprio
avatar.

### 5. Doc

- `CLAUDE.md`:
  - via la sezione **Webhook System**, la riga `webhook` dalla tabella dei moduli, i punti 6–7 di
    "Adding a New Feature Module";
  - nella sezione Audit, un paragrafo "Superficie client": quali route, `via: 'api_key'`, perché nei
    controller e non nei servizi, l'eccezione del booleano `isPrivate`.
- `README.md:213`: via la riga "Webhook System".
- `.env.example:21`: "(fullPath, webhook links)" → "(fullPath)".
- `docs/external-album-api.md`: via le righe "Webhook `album.*`" e la sezione `## Webhook` (`:290`).
- `../docs/integrations/fileharbor.md:400`: via il paragrafo sui webhook Discord. Dire che non c'è
  nessuna notifica in uscita e che i consumer devono fare polling.
- `docs/BACKLOG.md`: 2b.6 sostituito da questo piano. Riga barrata o ✅ con rimando a 10, come le altre.
- `openapi.json`: `pnpm openapi:dump`. Poi `@heyatom/client`: rigenerare
  `src/fileharbor/types.gen.ts` (via i campi dal client admin). `src/webhooks/` dell'SDK è la
  verifica Standard Webhooks di Gatherly e Articuno: non toccare.

## Test

- I quattro spec dei servizi verdi senza webhook (già lo sono con i mock rimossi).
- Spec dei controller: `image.controller.spec.ts` esiste già; per `video`, `album` e `avatar` uno
  spec nuovo minimo, solo per questi casi:
  - un delete riuscito chiama `audit.write` con evento e metadata attesi;
  - un delete che lancia (404/403) **non** scrive audit;
  - `PATCH` con `isPrivate` scrive, `PATCH` con solo `description` no.
- `clients-admin.controller.spec.ts`: un `PATCH` con `webhookUrl` risponde 400 (`forbidNonWhitelisted`).
  È il test che documenta l'ordine di deploy.
- `pnpm run test`, `pnpm run lint`, `pnpm run build`. Meridian typecheck e i18n parity.

## Ordine di deploy

1. Query di verifica in prod (sopra).
2. Meridian (step 1).
3. FileHarbor con la migrazione.

## Fuori scope

- Una notifica in uscita machine-readable per FileHarbor (Standard Webhooks come Gatherly): se un
  giorno un consumer ne avrà bisogno, si progetta allora, con firma e retry.
- Audit di upload, update di metadati e operazioni sugli album.
- Audit di `/me/avatar`.
