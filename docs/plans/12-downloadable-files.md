---
type: plan
service: fileharbor
issue: andreacw5/fileharbor#15
estimate: 2.5d
updated: 2026-11-02
---

# 12 · File scaricabili (zip, pdf)

## Perché

Element ha un marketplace di grafiche: ogni prodotto è una cover webp più un pacchetto `.zip`
(`element/uploads/network/marketplace`: 18 zip, 215 MB, tipico 20–25 MB, massimo 76 MB). Le cover
sono già `Image`; gli zip oggi stanno fuori da FileHarbor, senza upload da GUI, conteggio download
o storage nelle statistiche del client.

Serve una cosa sola: **caricare un file, elencarlo, scaricarlo così com'è**. Nessuna anteprima,
nessuna elaborazione.

## Fuori scope

Tag, album, PATCH dei metadati, versioning, share-link/token per i privati, X-Accel-Redirect,
antivirus, estrazione o ispezione del contenuto degli zip, metodi nell'SDK `@heyatom/client`.
Ognuno si aggiunge quando arriva la richiesta.

## `isPrivate` resta

I pack Element sono gratuiti ma riservati agli streamer attivi: lo stato "attivo" lo conosce solo
Element, quindi Element deve stare nel percorso al momento del download. Un token permanente per
file non basta: diventa un link pubblico appena qualcuno lo incolla su Discord, e uno streamer non
più attivo continua a scaricare. Per revocare servirebbe ruotare il token, togliendolo a tutti.

**Deciso (2026-11-02): link firmato a scadenza breve.** Al click il backend Element verifica lo
streamer e chiama `POST /files/:id/link` con la sua key; FileHarbor risponde un URL di download
valido 10 minuti; Element fa redirect. I byte vanno da FileHarbor all'utente senza passare da
Element, un link trapelato muore da solo. Scartato il proxy da Element (ogni zip trasferito due
volte). Dettagli in §5bis.

## Stato attuale

- Il modulo `video` ha già quasi tutto il necessario:
  - `videoMulterOptions` + `removeVideoTempFile` (`video/video-delivery.ts:18-50`): multer su disco
    in `os.tmpdir()`, pulizia del temp a fine request;
  - `sendVideo` (`video/video-delivery.ts:65-120`): `res.sendFile` con Range, gestione errori a
    header già inviati; accetta già `download` e `cacheControl`;
  - `StorageService.copyFromTemp` (rename, copia solo cross-device) e `deleteDirectory`
    (`storage.service.ts:166-175`, `:401`, `:488-507`);
  - check magic bytes nel service (`video.service.ts:65-73`).
- `contentDisposition()` (`utils/content-disposition.ts`) gestisce già filename utente e injection.
- helmet globale (`nest-common/src/http.ts:65`) manda già `X-Content-Type-Options: nosniff`.
- Lo streaming video è solo con `X-API-Key` (`video.controller.ts:168-206`); le immagini pubbliche
  hanno `GET /images/:id` `@Public()` + `@SkipThrottle()` (`image.controller.ts:193-195`), con
  `ClientInterceptor` che imposta `request.clientId` solo se la key è presente e valida
  (`client.interceptor.ts:32-50`).
- Contatori: le immagini incrementano `downloads` con `$executeRaw` (`image.service.ts:870-874`), i
  video le view con SQL raw (`video.service.ts:231`): niente `updatedAt` toccato.
- Storage per client: `storageUsageByClient` (`statistics/storage-usage.ts`) somma
  images/videos/avatars; `KIND_FIELDS: Record<MediaKind, …>` lo legge `storage-snapshot.job.ts:55`.
  `fileharbor_storage_bytes` è etichettato per `client` e somma `totalBytes(u)`
  (`fileharbor-metrics.service.ts:152-166`). In `statistics.service.ts` ci sono quattro insiemi di
  kind scritti a mano che TS non segnala (vedi §7).
- Orfani su disco: `StorageCleanupJob` (`storage/storage.cleanup.job.ts:130-155`) per i video.
- Limiti: `MAX_FILE_SIZE` 10 MB (immagini), `MAX_VIDEO_SIZE` 500 MB. `videoMulterOptions` legge
  `process.env` all'import, prima della validazione Joi: il default vero è il fallback stringa in
  `video-delivery.ts:29`, non quello Joi.
- nginx di prod mette in `proxy_cache` la location immagini (`docs/image-delivery.md:39-41`).

## Cosa

### 1. Modello

```prisma
model StoredFile {
  id           String   @id @default(uuid())
  clientId     String
  creatorId    String
  originalName String
  storagePath  String          // {domain}/files/{id}
  mimeType     String          // canonico: application/zip | application/pdf
  size         BigInt
  isPrivate    Boolean  @default(false)
  downloads    Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  client  Client  @relation(fields: [clientId], references: [id], onDelete: Cascade)
  creator Creator @relation(fields: [creatorId], references: [id], onDelete: Cascade)

  @@index([clientId, createdAt])
  @@index([creatorId])
  @@map("files")
}
```

- Back-relation `storedFiles StoredFile[]` su `Client` e su `Creator`.
- `MediaKind` + `FILE`.
- Una migration: `pnpm exec prisma migrate dev --name stored-files`, poi `pnpm exec prisma generate`.

Nome `StoredFile`, non `File`: un model `File` genera il tipo `File` di `@prisma/client`, che fa
ombra al `File` globale e confonde con `Express.Multer.File`. Tabella e route restano `files`.

### 2. Storage

```
storage/{client.domain || clientId}/files/{fileId}/original.{zip|pdf}
```

`StorageService`: `getFilePath(domain, fileId)` / `getFileDir(domain, fileId)` /
`getClientFileIds(domain)`, sullo stampo dei metodi video (`sanitizePathComponent`). L'estensione
viene dal tipo rilevato, mai da `originalname`.

### 3. Validazione upload

Una tabella sola in `file/file-types.ts`:

| Tipo | Estensioni | Magic bytes | MIME servito |
|---|---|---|---|
| zip | `.zip` | `50 4B 03 04` | `application/zip` |
| pdf | `.pdf` | `25 50 44 46 2D` (`%PDF-`) | `application/pdf` |

- Il `mimetype` del browser **non** decide: per gli zip varia (`application/zip`,
  `application/x-zip-compressed`, `application/octet-stream`). Il `fileFilter` di multer scarta
  solo per estensione (fallisce presto, prima di scrivere 200 MB su disco); il service poi legge i
  primi 8 byte e richiede che il tipo dei magic bytes coincida con quello dell'estensione → altrimenti
  `400 { code: 'UNSUPPORTED_FILE_TYPE' }`.
- Zip vuoto (`PK\x05\x06`) e zip spanned rifiutati: non servono.
- `PK\x03\x04` vale anche per docx/xlsx/jar/apk/epub: rinominati `.zip` passano e vengono serviti
  come `application/zip` in `attachment`. Va bene così: **il contenuto non si apre mai lato server**
  (niente parser zip/PDF, niente zip bomb). Non aggiungere un parser per "distinguerli".
- `MAX_DOWNLOAD_FILE_SIZE`: `fileMulterOptions` legge
  `parseInt(process.env.MAX_DOWNLOAD_FILE_SIZE || '209715200')` (200 MB) come `videoMulterOptions`;
  il fallback stringa è il default vero, l'entry Joi in `config.validation.ts` è solo validazione.
  Oltre il limite multer dà `LIMIT_FILE_SIZE` → Nest `413`.

### 4. Consegna

Riusare `sendVideo` aggiungendo `contentType?: string` alle opzioni (default `'video/mp4'`). Il ramo
X-Accel resta spento per i file (`xAccelRedirect: false`). Niente spostamenti né rinomine.

Per i file, sempre:

- `Content-Type` dalla tabella (mai dal DB grezzo né dal browser);
- `download: true` → `Content-Disposition: attachment`, anche per i PDF: un PDF inline sul dominio
  del CDN esegue nel viewer del browser con l'origine di FileHarbor;
- `nosniff` arriva da helmet; il test lo verifica comunque;
- `Cache-Control`: pubblico `public, max-age=31536000, immutable` (un id non cambia mai contenuto,
  un nuovo upload è un nuovo id); privato `private, no-store`.

Node serve il file con `res.sendFile` (Range incluso, così i download ripresi funzionano). 76 MB
passano bene da Node; X-Accel per i file si aggiunge solo se il carico lo chiede.

Contatore: `$executeRaw` `UPDATE files SET downloads = downloads + 1 WHERE id = … AND "clientId" = …`
(non `update`: non deve toccare `updatedAt`), solo sulla prima request (nessun `Range` o
`bytes=0-`, come i video) e dopo che la callback di `sendFile` riporta successo, come le immagini.
Un resume da `bytes=0-` conta due volte, come per i video: accettato.

### 5. API client (`X-API-Key` + `X-User-Id`)

Modulo `src/modules/file/` (controller → service → `dto/`), `ClientInterceptor` a livello classe.

| Metodo | Path | Note |
|---|---|---|
| `POST` | `/files` | multipart `file`, `isPrivate?`. `201` → `FileResponseDto` |
| `GET` | `/files` | `PageParams` + `creatorId?`, `paginate()`, ordinati `createdAt desc` |
| `GET` | `/files/:id/download` | `@Public()` se il file è pubblico; se privato serve la `X-API-Key` dello stesso client, altrimenti `404` (non `403`: non conferma l'esistenza) |
| `DELETE` | `/files/:id` | `auditClientWrite('fh_file.deleted', { fileId })` nel controller |

`FileResponseDto`: `id`, `originalName`, `mimeType`, `size` (number), `isPrivate`, `downloads`,
`createdAt`, `creator { externalId }`, `downloadUrl` assoluto (`RouteHelperService.fullUrl`).

Route di download: `@Public()`, `@SkipThrottle()`, `@NoTransform()`, `@Res()`, come
`GET /images/:id` + `streamVideo`. Il client viene da `request.clientId` solo se la key c'è.
Niente throttler: ogni chunk Range è una request e il limite IP di default (10/60 s) spezza un
download manager o un NAT d'ufficio a metà di un file da 76 MB; gli id sono uuid, il costo è I/O.

Delete: riga in DB poi `deleteDirectory`; se il disco fallisce, ci pensa lo sweep orfani (come i
video).

### 5bis. Link firmato per i privati

`POST /files/:id/link` (client, `X-API-Key`, file dello stesso client altrimenti `404`), nessun
body → `201 { url, expiresAt }`.

- Token: `<exp>.<sig>`, `exp` = epoch secondi (`now + FILE_LINK_TTL_SECONDS`, costante `600` nel
  modulo, niente env), `sig` = HMAC-SHA256 base64url di `` `${fileId}.${exp}` `` con
  `FILE_LINK_SECRET`. Legato all'id: non apre altri file. Stateless: niente tabella, niente cleanup.
- URL: `downloadUrl?token=<exp>.<sig>`. Parametro `token`, non `sig`: `sanitizeLoggedUrl`
  (`common/share-tokens.ts:12`) lo redige già nei log.
- Download di un privato: passa con key dello stesso client **oppure** token valido. Verifica:
  formato, `exp > now`, `timingSafeEqual` sulle firme (lunghezze uguali prima). Token assente,
  malformato, scaduto o falso → `404` come gli altri casi privati.
- `exp` si controlla all'inizio di ogni request: un download già partito finisce anche oltre i 10
  minuti; un resume Range dopo la scadenza fallisce e l'utente riclicca su Element. Accettato.
- `Cache-Control: private, no-store` su tutte le risposte dei privati, con o senza token.
- `FILE_LINK_SECRET`: Joi `string().min(32).required()`. Boot fallisce senza: va aggiunto all'env
  di prod prima del deploy. Ruotarlo invalida solo i link in volo (≤10 min).
- Nessun audit sulla creazione del link (è una lettura); log debug senza token.

### 6. API admin (Bastion user JWT)

`admin/controllers/files-admin.controller.ts`, `@RequirePermission('fileharbor-library.manage')`,
`@SkipThrottle()`, scope via `resolveAllowedClients` / `assertClientAccess` / `buildClientWhere`:

| Metodo | Path | Audit |
|---|---|---|
| `POST` | `/admin/files` (`clientId` nel body) | `fh_file.uploaded` |
| `GET` | `/admin/files?clientId&page&limit` | — |
| `GET` | `/admin/files/:id/download` (solo per i privati; se `isPrivate` cade, cade anche questa) | — |
| `DELETE` | `/admin/files/:id` | `fh_file.deleted` |

Metadata audit: `fileId`, `clientId`, `mimeType`, `size`. Mai il nome file.

### 7. Statistiche e pulizia

- `storage-usage.ts`: `files` in `ClientUsage`, `KIND_FIELDS.FILE`, `emptyUsage`, `totalBytes`,
  quarto `groupBy`. `storage-snapshot.job.ts` lo prende da `KIND_FIELDS`; `fileharbor_storage_bytes`
  lo prende da `totalBytes`.
- `statistics.service.ts`, i punti che TS non segnala:
  - `totalStorage` / `storageByKind` (`:140-149`) + `StorageByKindDto`
    (`admin/dto/admin-response.dto.ts:125`);
  - serie del report, `taken` e punto (`:265-275`) + `StorageSeriesPointDto`
    (`dto/storage-report.dto.ts:53-58`);
  - `ClientStorageDto` (`:60-66`);
  - storage per creator: SQL raw `UNION ALL` + `byKind` + `CreatorStorageDto` (`:305-326`).
- `StorageCleanupJob`: quarto blocco per `files/` sullo stampo dei video, più il contatore `files`
  nel log di riepilogo (`:164`).
- `monitoring/alerts.yml`: nessun kind enumerato oggi; ricontrollare solo se cambia.

### 8. Test

- `file-types`: zip/pdf validi; estensione `.zip` con magic PDF → rifiuto; `.exe` rinominato
  `.zip` → rifiuto; zip vuoto → rifiuto.
- Controller client: upload ok, download pubblico senza key, privato senza key → 404, privato con
  key di un altro client → 404, header `attachment` + `nosniff` + content-type canonico, Range →
  206 senza incremento del contatore, `updatedAt` invariato dopo un download.
- Link firmato: token valido → 200; scaduto, firma alterata, token di un altro file, formato rotto,
  lunghezza diversa → 404 (senza eccezioni da `timingSafeEqual`); `POST /files/:id/link` su file di
  un altro client → 404; `sanitizeLoggedUrl` redige il token.
- Admin: scope client (403/404), audit.
- `storage-usage` e `statistics.service`: il kind `files` entra nei totali, nella serie e per
  creator.

### 9. Meridian

- Pagina nuova:
  - tipi `FileHarborStoredFile`, BFF `server/api/[tenant]/fileharbor/files/` (index get/post, `[id]`
    delete, `[id]/download` in stream solo se resta `isPrivate`);
  - `API_POLICY` / `PAGE_POLICY` `/fileharbor/files/**` → `fileharbor-library.manage`;
  - `/fileharbor/files`: tabella (nome, tipo, dimensione, download, privato, data), filtro client in
    URL, upload, scarica (`downloadUrl` per i pubblici), elimina dietro `ShellConfirmDialog`. Voce
    nav sotto Video;
  - i18n `fileharbor.files.*` it/en.
- Report storage, quarto kind:
  - `app/types/fileharbor.ts`: `storageByKind` (`:149-151`), `FileHarborStorageReport.series` /
    `byClient` (`:660-675`), `FileHarborCreatorStorage` (`:680-690`);
  - `app/pages/[tenant]/fileharbor/storage.vue`: somma dei kind (`:75`), `KINDS` (`:139`),
    `ICONS` (`:141`).

### 10. Doc e infra

- `../docs/integrations/fileharbor.md` (sezione File), `CLAUDE.md` (tabella moduli + path storage),
  `docs/operations.md` se elenca le env, `.env.example` (`MAX_DOWNLOAD_FILE_SIZE`,
  `FILE_LINK_SECRET`). L'integration guide spiega il flusso Element: verifica streamer → `POST
  /files/:id/link` → redirect.
- nginx di prod (`server-backup/nginx`), location per `/files/`:
  - **senza** `proxy_cache` (corpi da 76 MB in cache, e dopo un `DELETE` la copia resterebbe fino a
    `proxy_cache_valid`);
  - `client_max_body_size` ≥ `MAX_DOWNLOAD_FILE_SIZE`;
  - `proxy_request_buffering off` per l'upload.

## Contratto API

```http
POST /files
X-API-Key: …
Content-Type: multipart/form-data   (file, isPrivate?)

201 { "data": { "id": "…", "originalName": "red.zip", "mimeType": "application/zip",
                "size": 22000000, "isPrivate": false, "downloads": 0,
                "createdAt": "…", "creator": { "externalId": "system" },
                "downloadUrl": "https://fileharbor.heyatom.dev/v2/files/…/download" } }

GET /files/:id/download
200 Content-Type: application/zip
    Content-Disposition: attachment; filename="red.zip"
    X-Content-Type-Options: nosniff
    Cache-Control: public, max-age=31536000, immutable

POST /files/:id/link
X-API-Key: …

201 { "data": { "url": "https://fileharbor.heyatom.dev/v2/files/…/download?token=1793620800.k3J…",
                "expiresAt": "2026-11-02T10:10:00.000Z" } }

GET /files/:id/download?token=1793620800.k3J…        (file privato)
200 Content-Type: application/zip
    Content-Disposition: attachment; filename="red.zip"
    Cache-Control: private, no-store
```

Errori: `400 UNSUPPORTED_FILE_TYPE`, `413` oltre `MAX_DOWNLOAD_FILE_SIZE`, `404` file assente,
privato fuori client, token assente/scaduto/falso.

## Stima

FileHarbor 2d (modello, modulo, link firmato, admin, statistiche, test), Meridian 0.5d (pagina +
report).
