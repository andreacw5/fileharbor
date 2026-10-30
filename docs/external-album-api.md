# Album API (client) — incluso `externalAlbumId`

Riferimento delle route `/albums` esposte ai servizi client (auth `X-API-Key`). Scritto dal codice:
`src/modules/album/album.controller.ts`, `album.service.ts`, `dto/`. Le route admin
(`/admin/albums`, console Meridian) non sono trattate qui.

> ⚠️ Leggere prima [Problemi noti](#problemi-noti): oggi l'identità del creator negli album non è
> risolta come per immagini e video, e alcune route si comportano diversamente da quanto dichiarano
> DTO e Swagger.

---

## Autenticazione e contesto

| Header | Obbligatorio | Note |
|---|---|---|
| `X-API-Key` | sì (tranne `GET /albums/shared/:token`) | Risolve il client. Assente → `401 API key required`; non valida o client inattivo → `401 Invalid or inactive client` |
| `X-User-Id` | su tutte le scritture | Identifica il creator. Fallback: `?externalUserId=` o `externalUserId` nel body. Stringa vuota = assente. Assente su una scrittura → `400 Creator ID is required (X-User-Id header)` |

Ogni query è scoped al client della API key: un album di un altro client risponde `404`.

**Proprietà**: ogni album ha un `creatorId`. Modifica, cancellazione, gestione item e token
richiedono che il creator della richiesta coincida con quello dell'album, altrimenti `403`.

**Privacy** (`isPublic`, default `false`):

| Route | Album privato | Album pubblico |
|---|---|---|
| `GET /albums/:albumId`, `GET /albums/external/:externalAlbumId` | solo il creator (`403 Access denied to private album` per gli altri) | chiunque abbia la API key del client |
| `GET /albums` | **incluso** nella lista, nessun filtro di privacy | incluso |
| `GET /albums/:albumId/items` | **nessun controllo**: basta la API key | idem |
| `GET /albums/shared/:token` | accessibile con un token valido, senza API key | idem |

"Pubblico" significa quindi "visibile a ogni creator dello stesso client", non "accessibile senza
autenticazione": l'unico accesso anonimo è via token condiviso.

---

## Oggetti

### `Album`

Restituito da create, get, update e dalla lista.

```ts
{
  id: string;                    // UUID interno FileHarbor
  externalAlbumId: string | null; // il vostro id, unico per client
  clientId: string;
  creatorId: string;             // id interno del Creator (non l'X-User-Id)
  name: string;
  description: string | null;
  isPublic: boolean;
  coverImageId: string | null;
  createdAt: string;             // ISO 8601, UTC
  // solo su get, lista e shared:
  itemCount?: number;            // immagini + video
  imageCount?: number;
  videoCount?: number;
  coverUrl?: string;             // URL assoluto dell'immagine di copertina
}
```

Create e update **non** includono i contatori né `coverUrl`. Nessuna risposta include gli item: si
leggono con `GET /albums/:albumId/items`.

`coverUrl`: la prima immagine dell'album per `order`. Solo `GET /albums/external/:externalAlbumId`
usa `coverImageId` quando è impostato; le altre route lo ignorano e prendono sempre la prima immagine.

### `AlbumItem` (lista item)

```ts
{
  id: string;                    // id della riga AlbumItem, non della risorsa
  resourceType: 'IMAGE' | 'VIDEO';
  order: number;
  addedAt: string;
  image?: {                      // se IMAGE
    id, originalName, mimeType, width, height, size,
    tags: string[],
    fullPath: string,            // {BASE_URL}/images/{id}
    thumbnailPath: string,       // {BASE_URL}/images/{id}?thumb=true
    srcset?: string,             // assoluto, solo immagini pubbliche (vedi ImageResponse.srcset)
  };
  video?: {                      // se VIDEO
    id, originalName, mimeType, duration?, width?, height?, size,
    tags: string[],
    url: string,                 // {BASE_URL}/videos/{id}
    thumbnailUrl: string,        // {BASE_URL}/videos/{id}/thumb
  };
}
```

Gli URL seguono `API_PREFIX` (vedi `RouteHelperService`): non costruirli a mano.

### Envelope e paginazione

Ogni risposta JSON è `{ data: T }`; le liste paginate sono:

```ts
{ data: T[]; meta: { total: number; page: number; limit: number; totalPages: number } }
```

Le forme `Album`, `AlbumItem` ecc. di questa pagina sono il contenuto di `data`.

---

## Route per id interno

### `POST /albums` — crea

`X-User-Id` obbligatorio. Body:

| Campo | Tipo | Obbl. | Note |
|---|---|---|---|
| `name` | string | sì | |
| `externalAlbumId` | string | no | Unico per client (`@@unique([clientId, externalAlbumId])`) |
| `description` | string | no | |
| `isPublic` | boolean | no | default `false` |
| `coverImageId` | UUID | no | **Accettato ma ignorato** in creazione: impostarlo poi con `PATCH` |

`201` → `Album`.

### `GET /albums` — lista

Query: `creatorId` (id interno), `public` (`true`/`false`), `search` (contiene nel nome,
case-insensitive), `page` (default 1), `limit` (default 20, max 100). Ordine: `createdAt` desc.

`200` → `{ data: Album[], meta }`, con contatori e `coverUrl`.

### `GET /albums/:albumId` — dettaglio

`X-User-Id` necessario solo per album privati. `200` → `Album` con contatori.

### `PATCH /albums/:albumId` — aggiorna

`X-User-Id` obbligatorio, deve essere il creator. Body, tutto opzionale:

| Campo | Note |
|---|---|
| `externalAlbumId` | Cambia l'id esterno. Un valore già usato nel client → errore (vedi Errori) |
| `name`, `description`, `isPublic` | |
| `coverImageId` | UUID di un'immagine **già nell'album** e dello stesso creator, altrimenti `400`. `null` rimuove la copertina |

`200` → `Album` (senza contatori).

### `DELETE /albums/:albumId` — cancella

`X-User-Id` obbligatorio, deve essere il creator. Cancella album, item e token; immagini e video
restano. `200` → `{ success: true, message: "Album deleted successfully" }`. Scrive l'audit
`fh_album.deleted` in Bastion (`via: 'api_key'`, client, `X-User-Id`, `albumId`).

Non esiste la variante per `externalAlbumId`: usare l'`id` interno.

### `POST /albums/:albumId/items` — aggiungi immagini e/o video

`X-User-Id` obbligatorio, deve essere il creator. Body:

```json
{
  "items": [
    { "id": "<uuid immagine>", "resourceType": "IMAGE" },
    { "id": "<uuid video>", "resourceType": "VIDEO", "order": 5 }
  ]
}
```

- Massimo 100 item per richiesta.
- Ogni risorsa deve appartenere al client **e** allo stesso creator, altrimenti
  `404 Image <id> not found or unauthorized` (o `Video …`) e non viene aggiunto nulla.
- Duplicati nella richiesta: vince l'ultimo.
- `order` omesso → in coda, nell'ordine della richiesta. Una risorsa già nell'album non viene
  duplicata: ne cambia solo l'`order`.

`201` → `{ albumId, count, items: [{ id, resourceType, order }] }` (`id` = riga AlbumItem).

### `DELETE /albums/:albumId/items` — rimuovi

`X-User-Id` obbligatorio, deve essere il creator. Body: `{ "items": [{ "id", "resourceType" }] }`,
max 100. Le risorse non presenti nell'album sono ignorate in silenzio. Immagini e video non vengono
cancellati.

`200` → `{ albumId, removed, success: true, message: "<n> item(s) removed" }`.

### `GET /albums/:albumId/items` — lista item

Query: `resourceType` (`IMAGE` | `VIDEO`), `page` (default 1), `limit` (default 20, max 100).
Ordine: `order` asc. `200` → `{ data: AlbumItem[], meta }`.

---

## Token di condivisione

### `POST /albums/:albumId/token`

`X-User-Id` obbligatorio, deve essere il creator. Body opzionale: `{ "expiresInDays": 7 }`
(da 1 a 365, altrimenti `400`). Se omesso vale **7**: ogni token scade.
Si possono avere più token attivi per album.

`201` → `{ token, albumId, expiresAt: string, url: "/albums/shared/<token>" }`. I token creati prima
di questa regola possono ancora avere `expiresAt: null` (non scadono).

### `DELETE /albums/:albumId/token`

Revoca **tutti** i token dell'album. `200` → `{ success: true, message: "Album tokens revoked", count }`.

I token scaduti sono cancellati ogni notte alle 04:00 (`AlbumCleanupJob`).

### `GET /albums/shared/:token` — pubblica

Nessun header richiesto. `200` → `Album` con contatori e `coverUrl`. Token inesistente → `403 Invalid
token`; scaduto → `403` con `code: "TOKEN_EXPIRED"` (lo stesso status di uno share link immagine
scaduto, `SHARE_LINK_EXPIRED`).

Restituisce solo i metadati: gli item si leggono con `GET /albums/:albumId/items`, che richiede la
API key.

---

## Route per `externalAlbumId`

Stesso comportamento delle route per id, cercando l'album con `(clientId, externalAlbumId)`.
Album non trovato → `404 Album not found`.

| Route | Equivalente |
|---|---|
| `GET /albums/external/:externalAlbumId` | `GET /albums/:albumId` (ma `coverUrl` rispetta `coverImageId`) |
| `PATCH /albums/external/:externalAlbumId` | `PATCH /albums/:albumId`. `externalAlbumId` nel body omesso o vuoto → resta quello attuale |
| `POST /albums/external/:externalAlbumId/items` | `POST /albums/:albumId/items` |
| `DELETE /albums/external/:externalAlbumId/items` | `DELETE /albums/:albumId/items` |

Non esistono varianti external per `DELETE` album, lista item e token: serve l'`id` interno,
restituito da create e get.

### Flusso tipico

```ts
const headers = {
  'Content-Type': 'application/json',
  'X-API-Key': apiKey,
  'X-User-Id': creatorId,
};

// 1. crea l'album con il vostro id
await fetch(`${FILEHARBOR_URL}/albums`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ externalAlbumId: 'summer-2025', name: 'Summer 2025' }),
});

// 2. aggiungi media (già caricati con POST /images o POST /videos dallo stesso creator)
await fetch(`${FILEHARBOR_URL}/albums/external/summer-2025/items`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    items: [
      { id: imageId, resourceType: 'IMAGE' },
      { id: videoId, resourceType: 'VIDEO' },
    ],
  }),
});

// 3. leggi metadati, poi gli item con l'id interno
const album = await (await fetch(`${FILEHARBOR_URL}/albums/external/summer-2025`, { headers })).json();
const items = await (await fetch(`${FILEHARBOR_URL}/albums/${album.id}/items`, { headers })).json();
```

---

## Errori

Formato (`HttpExceptionFilter`):

```json
{ "statusCode": 403, "message": "...", "errors": null, "timestamp": "...", "path": "/albums/..." }
```

Su `400` di validazione `errors` contiene l'array dei messaggi di `class-validator`.

| Status | Quando |
|---|---|
| `400` | `X-User-Id` assente su una scrittura; body non valido (UUID, enum, > 100 item); `coverImageId` non nell'album o di un altro creator |
| `401` | API key assente, non valida o client inattivo |
| `403` | Album privato letto da un altro creator; modifica/cancellazione/item/token su un album di un altro creator; token condiviso non valido o scaduto |
| `404` | Album non trovato nel client (per id o `externalAlbumId`); item da aggiungere inesistente o non del creator |
| `429` | Rate limit globale (`THROTTLE_TTL` / `THROTTLE_LIMIT`) |
| `500` | `externalAlbumId` duplicato nel client (vedi sotto) |

**`externalAlbumId` duplicato**: non c'è un `409`. Il vincolo unico del DB solleva un errore Prisma
(`P2002`) che nessuno traduce, e la risposta è un `500` generico. Controllare prima con
`GET /albums/external/:id` (404 = libero) finché non è corretto.

---

## Notifiche

Nessuna notifica in uscita: i webhook Discord per client sono stati rimossi (piano 10). Chi deve
reagire a un cambiamento fa polling.

---

## Problemi noti

Verificati sul codice; non ancora corretti.

1. ~~`X-User-Id` non viene risolto in un Creator~~: corretto. Come per immagini e video, l'header è
   l'id **esterno** (dell'utente nel sistema chiamante): le scritture lo risolvono in un Creator
   (creato al primo uso) e salvano/confrontano il suo id interno, le letture lo cercano soltanto. Chi
   aggirava il problema passando l'id interno del Creator come `X-User-Id` deve tornare all'id esterno:
   l'id interno ora viene trattato come un utente nuovo e non possiede più i propri album.
2. **Duplicato `externalAlbumId` → `500`** invece di `409` (vedi Errori).
3. **`GET /albums` e `GET /albums/:albumId/items` ignorano la privacy**: qualunque detentore della API
   key elenca album privati e ne legge gli item.
4. **`coverImageId` in creazione è ignorato**, e solo il GET per `externalAlbumId` lo usa per `coverUrl`.
5. ~~`expiresInDays` omesso → token senza scadenza~~: corretto, default 7 e massimo 365.
6. Il DTO di risposta Swagger dichiara un campo `images` che nessuna route restituisce, e non dichiara
   `clientId`, che invece c'è.
