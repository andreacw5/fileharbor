---
type: review
service: fileharbor
status: in-progress
updated: 2026-10-30
verified: 283a918
---

# FileHarbor — Product review (4.1.2)

Revisione del servizio come **CDN che serve contenuto**: priorità alle performance del percorso di
consegna, poi sicurezza, correttezza, job, infra, contratto API. Tre agenti in parallelo (security,
hot path, robustezza/jobs/API), ogni finding riverificato sul codice a `283a918`. Nessun file toccato.

Legenda: **H** alto · **M** medio · **L** basso · **I** info. Effort XS/S/M.
Le righe già tracciate in [`BACKLOG.md`](../BACKLOG.md) sono marcate `(BACKLOG n.n)`.

---

## 0. Sintesi

Stato: solido. Nessun accesso cross-tenant trovato, nessuna Critical/High di sicurezza. Il modello di
consegna è giusto (ETag da `updatedAt`, viste bufferizzate, varianti snappate, semaforo render, scritture
atomiche). I problemi reali sono tre:

1. **Node serve ancora i byte**: `IMAGE_X_ACCEL_REDIRECT` e `VIDEO_X_ACCEL_REDIRECT` sono `false` in
   prod; ogni file passa per `fs.readFile` → `Readable.from(buffer)` (immagini) o `res.sendFile` (video).
   Verificato su `server-backup/nginx`: per i **video** la location `/internal-videos/` e il mount esistono
   già, basta l'env. Per le **immagini** c'è un `proxy_cache` (HIT = zero Node, zero DB) che X-Accel
   escluderebbe: nginx non cacha una risposta con `X-Accel-Redirect`. Lì conviene tenere la cache e
   alzarne la dimensione, non passare a X-Accel. Dettaglio in §1.6.
2. **Video views**: un `UPDATE` per richiesta, e ogni chunk `Range` è una richiesta. Write amplification
   e contatore gonfiato.
3. **Placeholder non nel container**: `defaults.fileharbor/` vive nel volume storage, non nell'immagine.
   Volume nuovo → ogni 404 pubblica diventa un 500.

Top 10 per rapporto resa/effort:

| # | Cosa | Dove | Sez. | Effort |
|---|---|---|---|---|
| 1 | `VIDEO_X_ACCEL_REDIRECT=true` in prod (location già pronta); immagini: `proxy_cache` più grande, non X-Accel | env, nginx | §1.6 | XS (ops) |
| 2 | Views video bufferizzate, contare solo `Range` iniziale | `video.service.ts:213` | §1.3 | S |
| 3 | Copiare `defaults.fileharbor` nell'immagine Docker | `Dockerfile:51` | §6.1 | XS |
| 4 | Dedupe in-flight render varianti/blur (thundering herd) | `image.service.ts:429,502` | §2.2 | S |
| 5 | Messaggi `InternalServerErrorException` con path assoluto nel body | `storage.service.ts:372` | §4.1 | XS |
| 6 | Cache `clientId → domain` (−1 query su ogni GET pubblica, −1 su ogni write) | `client.service.ts` | §1.1 | S |
| 7 | `UV_THREADPOOL_SIZE` + `sharp.concurrency()` | `Dockerfile`, `storage.service.ts` | §2.1 | XS |
| 8 | ETag avatar senza `updatedAt` → 304 eterno dopo re-upload | `avatar.controller.ts:211` | §1.2 | XS |
| 9 | `albumId` validato dopo aver scritto file e riga | `image.service.ts:300`, `video.service.ts:148` | §5.1 | S |
| 10 | Avatar: vecchia dir cancellata prima di scrivere la nuova | `avatar.service.ts:113` | §5.2 | XS |

---

## 1. Hot path — consegna pubblica

### 1.1 `GET /images/:id` (view / thumb / variante / blur)

Traccia: `ClientThrottlerGuard` (0 query senza key; con key `validateClient` cache 30 s) →
`ClientInterceptor` → `getImageById(id, undefined, withTags=false)` (`image.service.ts:329`) →
`validateImageAccess` → ETag → file.

Query per richiesta: pubblica **2** (`findFirst` + relazione `client` per leggere `domain`), privata
owner **3** (+`creator.findUnique`), share token **4** (share-link con `image+client+imageTags` che la
consegna non usa; se fallisce, `checkImageAccess` ripete la stessa `findUnique` a `:1060`).

- **H** `image.controller.ts:362-394`, `image.service.ts:377-381` — con `IMAGE_X_ACCEL_REDIRECT=false`
  (default, `.env.example:66`) ogni file su disco è letto intero in RAM e servito via `Readable.from`.
  Memoria = dimensione file × richieste concorrenti, byte copiati due volte, loop Node occupato.
  In prod il colpo è attutito dal `proxy_cache` nginx (§1.6): Node vede solo i MISS. Fix nel codice,
  valido ovunque: `createReadStream(filePath)` + `stat.size` da `fromDisk` invece del buffer. X-Accel per
  le immagini solo se l'hit ratio della cache risulta basso.
- **M** `image.service.ts:329-343` — `include: { client }` = 2 round-trip per una stringa. Fix: cache
  `clientId → domain` in `ClientService` (stesso pattern `Map` + TTL 30 s di `validateClient`) e togliere
  l'include. Lo stesso lookup appare 14× (upload, delete, stream video, job): una sola helper.
- **M** `image.service.ts:1046-1056` — check owner privato fa `creator.findUnique` sebbene
  `image.creatorId` sia già caricato. Fix: `include: { creator: { select: { externalId } } }` e confronto stringhe.
- **L** `image.controller.ts:387`, `avatar.controller.ts:225` — `logger.log` per asset servito, oltre
  alla riga di pino-http: 2 righe per immagine a volume CDN, stdout è il collo con `json-file`. Fix: `debug`.
- **L** `storage.service.ts:216-229` — placeholder 404/403 riletto da disco a ogni miss (traffico scanner =
  query + read). Fix: memoizzare i due buffer in `StorageService`.
- **I** `image.controller.ts:345-353` — sotto X-Accel nginx scarta l'ETag upstream e usa il suo
  (mtime-size): il confronto `If-None-Match` di Node non matcha mai, il 304 lo fa nginx. Corretto, ma
  il ramo in Node diventa morto in quella modalità. Nessuna azione.
- **I** nessun `Last-Modified`/`Accept-Ranges` sulle immagini. Innocuo; nginx li aggiunge sotto X-Accel.

### 1.2 `GET /avatars/:clientRef/:externalUserId`

- **M** `avatar.service.ts:458-501` — **4 query** per avatar pubblico (`client.findMany` OR domain/id,
  `creator.findUnique`, `avatar.findFirst`, relazione `client`), nessuna cache. Fix: cache `ref → clientId`
  (30 s) e una sola `avatar.findFirst({ where: { creator: { clientId, externalId } } })`.
- **M** `avatar.controller.ts:211` — ETag `"avatar-<externalUserId><variant>"` senza `updatedAt`: dopo un
  re-upload il browser rivalida e riceve 304 per sempre (express risponde a `req.fresh`). Fix:
  appendere `avatar.updatedAt.getTime()`.
- **M** `avatar.service.ts:224-236` — `format=jpeg|png` passa da sharp (e dal semaforo) **a ogni
  richiesta**, mai cachato: una pagina con 50 avatar OG = 50 decode. Fix: salvare
  `{avatarDir}/original.<format>` con `saveFile`, stesso pattern delle varianti (~10 righe).
- **L** `avatar.service.ts:224`, `avatar.controller.ts:230` — `readFile` + `res.send(buffer)`, niente
  X-Accel. Fix: stesso ramo `skipDiskRead` delle immagini (`toStorageRelative` esiste già).

### 1.3 `GET /videos/:id/stream` (X-API-Key)

- **H** `video.service.ts:213-217` — un `UPDATE videos SET views+1` **per richiesta, e ogni chunk
  `Range` (206) è una richiesta**: una riproduzione = decine di UPDATE e `views` gonfiato dello stesso
  fattore. Fix: riusare `pendingViews` + `@Interval` flush di `image.service.ts:821-839`, contare solo
  se `!range || /^bytes=0-/.test(range)`.
- **M** `video.service.ts:208-211` — secondo `client.findUnique` (senza `select`, tira anche
  `apiKey`/`tinifyApiKey`) sebbene `getVideoById` abbia già `client.domain` (`:190`). Fix: cancellare.
- **L** `video.service.ts:185-192` — lo stream carica `videoTags→tag`, `creator`, `client` (~5 statement)
  per servire byte. Fix: `select` minimale per la route stream.
- **L** `video.controller.ts:119-147` — thumb: `readFile` + `res.end(buffer)`, niente ETag/304. Fix:
  `res.sendFile(thumbPath, { cacheControl: false })` (ETag/304 gratis).
- **OK** `video-delivery.ts:71-85` — `res.sendFile` gestisce Range/206/416, `Content-Length`,
  `Accept-Ranges`, ETag debole da stat, `Last-Modified`, 304. Con `VIDEO_X_ACCEL_REDIRECT` fa tutto nginx.

### 1.4 `GET /albums/shared/:token`

- **L** `album.service.ts:583-611` — 5 query: `albumToken.findUnique` (`:584`), **la stessa** in
  `validateAlbumToken` (`:573`), `album.findUnique` + cover, `albumItem.count`. Fix: togliere la
  chiamata a `validateAlbumToken` (inline dei due check), `_count` con `where`. Basso volume, IP-throttled.

### 1.5 Cache-Control e cacheabilità da proxy

- **OK** pubbliche `public, max-age=31536000, immutable` + ETag forte, niente `Set-Cookie`; private/token
  `private, no-store`; 403 placeholder `private, no-store`; 404 placeholder `public, max-age=3600`.
- **M** `CORS_ORIGIN` come lista → il pacchetto `cors` emette `Vary: Origin` su ogni risposta
  (`nest-common/src/http.ts:68-80`): un `proxy_cache` nginx tiene **una entry per Origin richiedente**.
  Con `*` niente `Vary`. Per l'host media, se non servono credenziali, usare `*`.
- **I** `image.controller.ts:334-336` — `immutable` per un anno sulle originali: un successivo
  `isPrivate=true` o delete non può purgare le cache intermedie (documentato nel DTO PATCH). Valutare
  `max-age` breve + `stale-while-revalidate` per gli URL senza `?t=`.
- **I** `video.controller.ts:144` — thumb video key-gated ma `public, max-age=86400` se non privato: un
  proxy cache davanti lo serve anche senza key. Verificato: privato → `no-store`, corretto.

### 1.6 nginx di produzione (`server-backup/nginx`, verificato 2026-10-30)

Letti `nginx.conf`, `conf.d/heyatom.dev/fileharbor.conf`, i due compose e l'env template.

**Va bene così**
- `location /internal-videos/ { internal; alias /var/fileharbor-storage/; }` + mount
  `../services/fileharbor/storage:/var/fileharbor-storage:ro`: combacia con
  `/internal-videos/<domain>/videos/<id>/original.mp4` di `sendVideo`. **Ma `VIDEO_X_ACCEL_REDIRECT`
  è `"false"` nel compose**: la location è morta. Oggi lo stream passa da Node → `proxy_buffering`
  (256k buffer, poi temp file nginx fino a 1 GB) → client. Accendere l'env è a costo zero.
- `proxy_cache fileharbor_cache` sulle immagini: key con `$args` (`?t=`, `?format` ok), `200 206 7d`,
  `use_stale`, `proxy_cache_lock on` (risolve il thundering herd **a livello nginx** per URL già
  visti), bypass su `X-API-Key`/`X-User-Id`/cookie, `Cache-Control` upstream rispettato (private →
  non cachato). 503 del semaforo passano. Corretto.
- Avatar: `proxy_ignore_headers Cache-Control` + 5 m: giusto, l'ETag senza `updatedAt` (§1.2) ha
  effetto solo entro i 5 minuti.
- `/health/ready` chiuso, `/health/live` aperto, `server_tokens off`, catch-all 444, real IP Cloudflare
  coerente con `TRUST_PROXY_HOPS=1`.

**Da sistemare**
- **H** `VIDEO_X_ACCEL_REDIRECT: "true"` nel compose di fileharbor. Tutto il resto c'è già.
- **M** immagini: **non** `IMAGE_X_ACCEL_REDIRECT`. nginx non cacha una risposta con `X-Accel-Redirect`,
  quindi ogni GET tornerebbe a Node (2 query DB) anche per i file caldi, che oggi sono HIT puri.
  Invece: `proxy_cache_path ... max_size=2g inactive=7d` è piccolo per una CDN; portare a 10–20 g
  (dopo `df` sul volume `nginx_cache`) e `inactive=30d`, `proxy_cache_valid 200 206 30d`: gli URL
  sono immutabili. Se poi i MISS restano alti (dashboard Loki, `X-Cache-Status`), X-Accel.
- **M** `location /` (`limit_req zone=api rate=200r/m burst=50`) copre `GET /videos/:id/stream`:
  un player fa decine di richieste `Range` per riproduzione, due utenti dietro lo stesso NAT
  arrivano a 429. Location dedicata `~ ^(/v2)?/videos/[^/]+/(stream|thumb)$` senza `limit_req`,
  `proxy_buffering off` finché X-Accel è spento.
- **L** location immagini: `client_max_body_size` eredita il 10M globale, `MAX_FILE_SIZE` è 10 MiB
  esatti + overhead multipart → nginx 413 prima dell'app su un file al limite. `client_max_body_size 12m`.
- **L** nessun blocco `upstream` con `keepalive`: ogni richiesta proxy apre una TCP nuova verso Node
  (HTTP/1.0). Con nginx 1.31 si può `upstream fh { server fileharbor:3000 resolve; keepalive 32; }`
  + `proxy_http_version 1.1; proxy_set_header Connection "";`. Allora serve il
  `keepAliveTimeout` di §6.1 (Node 5 s < nginx 60 s → reset sporadici).
- **L** `add_header X-Cache-Status` con X-Accel video risulterà sempre `MISS`/vuoto: non è un bug,
  ma non filtrarlo come errore in dashboard.
- **L** compose: image `4.1.1`, repo a `4.1.2`.
- **I** `CORS_ORIGIN: "*"`: coerente col §1.5 (niente `Vary: Origin`, cache per URL). Se si passa a
  una lista, la cache nginx si frammenta per Origin.

---

## 2. Image processing

### 2.1 sharp / threadpool

- **M** nessun `sharp.cache()` / `sharp.concurrency()` / `UV_THREADPOOL_SIZE` (grep su src, Dockerfile,
  `.env.example`: 0 hit). Default: libvips usa `cpus` thread per pipeline, pool libuv = 4 condiviso tra
  sharp **e ogni `fs.readFile`**. Con `RENDER_CONCURRENCY=2` su VPS piccolo due render saturano i core
  e le letture disco si accodano dietro. Fix: `ENV UV_THREADPOOL_SIZE=8` nel Dockerfile e
  `sharp.concurrency(Math.max(1, Math.floor(os.cpus().length / RENDER_CONCURRENCY)))` una volta nel
  costruttore di `StorageService`. Documentare `RENDER_CONCURRENCY = cpus - 1`.

### 2.2 Varianti

- **H** `image.service.ts:429-443`, `:502-522` — **thundering herd**: nessun dedupe in-flight. N richieste
  concorrenti sulla stessa `?width=640` non cachata (esattamente ciò che produce un deploy `srcset` o un
  purge CDN) fanno N `readFile` + decode + encode; il semaforo le serializza soltanto. Idem `buildBlurred`
  (il commento a `:514` lo ammette). Fix: `private inflight = new Map<string, Promise<Buffer>>()` su
  `variantPath`/`blurredPath`, `finally` delete (~8 righe).
- **M** `image.service.ts:429-434` — ogni miss ridecodifica `original.webp` intero; per
  `snapSize(width) <= THUMBNAIL_SIZE` basterebbe `thumb.webp`. Costo ~10× in meno sulle taglie `srcset`
  comuni (320/640). Una riga nella scelta del sorgente.
- **L** `image.service.ts:436` — `countEntries` (readdir) dopo il render a ogni miss, e `saveFile` non
  awaited: miss concorrenti possono sforare `MAX_CACHED_VARIANTS` di qualche unità. Cosmetico.
- **OK** `storage.service.ts:343-367` — scritture `tmp + rename`, mai file parziale servito.

---

## 3. Upload

- **M** `image.service.ts:192-258` — strettamente sequenziale: `metadata()` → `encodeWebpWithThumbnail`
  → `saveFile(original)` → `saveFile(thumb)` → `blurImage` (passa dalla coda render pubblica) →
  `computeDHash(webpBuffer)` = **terzo decode completo** dell'immagine. Fix (latenza):
  `Promise.all([saveFile(original), saveFile(thumb), computeDHash(webpBuffer)])`. Hashare la thumb
  taglierebbe il decode ma cambia gli hash rispetto al backfill: solo con un `--rehash`.
- **L** `image.service.ts:146,631`, `video.service.ts:67,208,271`, `avatar.service.ts:81,286` —
  `client.findUnique` per `domain` sebbene `ClientInterceptor` abbia già `request.client` con `domain`
  (`AUTH_CLIENT_SELECT`). Una query evitabile per write. Vedi §1.1 helper.
- **OK** `image.controller.ts:114-116` — `FileInterceptor` in memoria con `MAX_FILE_SIZE` 10 MB: input +
  webp + thumb + blur + raw dHash per upload, accettabile a questo limite. Video correttamente su
  `diskStorage`. Nessuna chiamata fs sincrona sui path di richiesta (grep = 0).

---

## 4. Sicurezza

Nessun accesso cross-tenant trovato su `X-API-Key`, pubblico, `/me`, `/admin`. Critical 0, High 0.

### 4.1 Medium

- **M** `storage.service.ts:372-385` (+ `saveFile:343`, `deleteDirectory:390`, `ensureDirectory:171`,
  `render:871-905`, `convertToWebP`, `createThumbnail`) — ogni errore disco/sharp è rilanciato come
  `InternalServerErrorException(\`Failed to read file: ${error.message}\`)`; `AllExceptionsFilter`
  restituisce il messaggio di una `HttpException` verbatim. Il body porta il **path assoluto dello
  storage** (`ENOENT: ... '/srv/storage/cdn.example.com/images/<id>/original.webp'`) e interni libvips.
  Scenario: `GET /images/:id` anonima su una riga con file mancante/corrotto (`image.controller.ts:395-440`
  mappa solo 404/403 al placeholder), `GET /avatars/...?format=png` su originale rotto. Fix: messaggio
  generico (`'Storage error'`), dettaglio solo nel `logger.error` già presente.

### 4.2 Low

- **L** `image.service.ts:885-920`, `create-share-link.dto.ts` — share link da API key creabili su
  immagini **pubbliche** (l'admin lo rifiuta, `image-share-links-admin.controller.ts:158-163`) e senza
  scadenza. Owner condivide una pubblica, poi `isPrivate=true`: il `?token=` vecchio apre per sempre
  (`getImageByShareToken` non ricontrolla). Fix: regola `IMAGE_NOT_PRIVATE` anche qui, cap `expiresAt`
  come `ADMIN_SHARE_LINK_MAX_DAYS`, o cancellare gli share link quando l'immagine diventa privata.
- **L** `album.service.ts:552-555`, `create-album-token.dto.ts:15` — `expiresInDays` ha `@Min(1)` ma
  nessun max; omesso ⇒ token eterno (il DTO dice "default 7"). `1e15` → `Invalid Date` → 500. Fix:
  `@Max(365)` e default 7 (known issue 5 in `external-album-api.md`).
- **L** `video-delivery.ts:10-22`, `video.service.ts:56-65,159-161` — multer scrive fino a 500 MB in
  `os.tmpdir()` **prima** dell'handler; l'unlink è solo nel `finally` di `uploadVideo`. Un 400 del
  `ValidationPipe` (`forbidNonWhitelisted`, un campo in più) o un 403 admin (`videos-admin.controller.ts:111-113`)
  lascia il file. Caller autenticato riempie `/tmp`. Fix: unlink in un `finally` a livello controller o
  interceptor.
- **L** `videos-admin.controller.ts:251-262` — `PATCH /admin/videos/:id` ha un body inline `{…}`: il
  `ValidationPipe` non fa nulla. `originalName` illimitato, `tags` stringa → iterata per carattere,
  non-array → TypeError 500. Fix: `AdminUpdateVideoDto` identico a `AdminUpdateImageDto`.
- **L** `image.service.ts:1617-1646` — l'URL di download Tinify è preso dal JSON upstream e scaricato con
  la Basic-auth del client senza controllare l'host. MITM/compromissione → SSRF dal container +
  esfiltrazione della key. Fix: `if (new URL(url).origin !== 'https://api.tinify.com') throw`.
- **L** `album.service.ts:146-156,180,251,283` — `Album.creatorId` scritto con la stringa `X-User-Id`
  pur essendo FK a `Creator.id`; ownership confronta id interno vs esterno (known issue 1). Fail-closed
  oggi (500 su FK, 403 sulle write), ma chi conosce un `Creator.id` interno (esposto da `GET /creators`,
  `creator.id` in `GET /images`) agisce come quel creator sugli album. Fix: `CreatorService.resolveCreator`
  come immagini/video.
- **L** `client.service.ts:44-63,118-126` — API key in chiaro (`Client.apiKey @unique`). Dump DB ⇒ tutte le
  key usabili. Fix: `sha256(apiKey)` e lookup per hash (il plaintext torna solo da `POST /admin/clients`).
- **L** `image.controller.ts:402-423` — placeholder distinguono `not_found` da `permission_denied`
  (`X-FileHarbor-Fallback`, cache policy) per chiamanti anonimi: oracolo di esistenza per id privati.
  UUIDv4, enumerazione impraticabile; conta solo se gli id trapelano altrove. Fix: `not_found` per
  entrambi senza contesto client.

### 4.3 Info

- `bastion-user.guard.ts:70-73` — `adminIdentity` cercata per `bastionUserId` solo, la tabella ha
  `tenantSlug`. Query `{ bastionUserId, tenantSlug }`.
- `bastion-user.guard.ts:64,116` — `payload.permissions` assunto array; una stringa farebbe di `.includes`
  un test di sottostringa. `Array.isArray`.
- `mask-api-key.helper.ts` — Tinify key in chiaro, 12 di ~32 char mostrati a ogni `media.manage`. Ultimi 4.
- `image.service.ts:1595-1600` — Tinify riceve originali **private**. Opt-in per client, ma da dichiarare
  nella doc integratori.
- `me.controller.ts:48` — `/me/*` non `@SkipThrottle`: un BFF su un IP condivide 10/min tra tutti gli utenti.
- `avatar.service.ts:481-492` — route deprecata senza key risolve cross-client quando l'id è unico;
  togliere quando i consumer migrano.
- `image.controller.ts:134`, `video.controller.ts:94`, `avatar.controller.ts:79` — `creatorId` nel body
  sovrascrive l'header: ogni key holder agisce come qualsiasi creator. By design, da documentare.
- `pnpm audit`: 3 high (`minimatch` ReDoS) + 1 low (`deepmerge`) solo dev, fuori dall'immagine; 1 moderate
  `js-yaml` via `@nestjs/swagger` (export YAML, nessun input non fidato). Runtime aggiornato: sharp 0.35.5,
  multer 2.5.0, express 5.3.0, axios 1.20.0, helmet 8.3.0, prisma 7.10.1.

### 4.4 Verificato corretto

Isolamento tenant su ogni read/write client (`clientId` ovunque, `deleteShareLink` via `image.clientId`,
tag `connectOrCreate` su `(clientId, name)`). Admin: 10 controller con `BastionUserGuard` +
`@RequirePermission` a classe, `assertClientAccess`/`buildClientWhere` su ogni handler, guard fail-closed,
scope mai per ruolo, `AdminPrincipal` senza API. JWT: RS256 pinned, RSA ≥ 2048, `exp`/`nbf`, service-client
rifiutati, JWKS per `kid`. Delivery: access check prima del 304, private/token `no-store`, token
`randomUUID()` (122 bit), scadenza controllata in entrambi i rami, `?info` su privata → 403, `?blur=1` mai
fall-through, `?token=` redatto nei log. Path: `validatePath` con `path.relative`, `sanitizePathComponent`,
`domain` solo in creazione e validato come hostname, `defaults.fileharbor` riservato, avatar su `Creator.id`
interno. Upload: formato dai byte (SVG rifiutato), `limitInputPixels` 100 MP, `failOn: 'error'`, EXIF
rimosso, `ftyp` magic sugli MP4, ffmpeg via spawn senza shell e path UUID. Headers: helmet + CORP
cross-origin, `CORS_ORIGIN` obbligatorio in prod, `trust proxy`, `ValidationPipe` whitelist+forbid, JSON
5 MB, `Content-Disposition` sanificata + RFC 5987. Throttler: key non valide non cachate e IP-throttled.
Segreti mai nei log. SQL raw tutto con template taggati.

---

## 5. Correttezza / robustezza

### 5.1 Scritture multi-step

- **H** `image.service.ts:300-304`, `video.service.ts:148-154` — `albumId` validato **dopo** aver scritto
  file e riga (`addImageToAlbum` → 404 "Album not found"): il client riceve 404 ma l'asset esiste ed è
  conteggiato; un retry duplica. Fix: lookup album (stesso `clientId`) prima dell'encode, o
  `$transaction` riga + item con delete dei file in fallimento.
- **M** `image/jobs/image.cleanup.job.ts:120-136`, `avatar.cleanup.job.ts:96-115` — l'originale
  ri-encodato è scritto prima della thumb; se la thumb fallisce `markAsOptimized` è saltato e il run
  successivo ri-encoda un file già a q85 (perdita generazionale, fino a 3 volte). Fix: encode entrambi in
  buffer, poi scrivere, poi marcare.
- **M** ordine album calcolato in tre modi, nessuno serializzato: `image.service.ts:683-694` (`(max||0)+1`,
  no tx), `video.service.ts:170-176` (`max+1 : 0`), `album.service.ts:353-358` (`(max??-1)+1`, in tx ma
  `findFirst` senza lock). Primo item = 1 via upload, 0 via album API; due add concorrenti stesso `order`
  (`[albumId, order]` è index, non unique, schema `:302`). Fix: far passare i due upload da
  `AlbumService.addItemsToAlbum`; se l'ordine deve essere stretto, `FOR UPDATE` sulla riga album.
- **M** `image.service.ts:1016-1018` vs `album.service.ts:578-580` — share link scaduto → `400`, album
  token scaduto → `403`: i consumer non possono fare branch su `code`. Fix: un codice di dominio
  (`SHARE_LINK_EXPIRED`), 403 o 410, su entrambi.
- **L** `image.service.ts:236-250,314` — upload scrive file poi DB; su errore DB i file restano alla sweep
  notturna. By design, ma il `catch` potrebbe fare `deleteDirectory` best-effort.

### 5.2 Avatar

- **M** `avatar.service.ts:109-116` — la vecchia dir è cancellata **prima** di encodare e scrivere la
  nuova; `encodeWebpWithThumbnail` può ancora fallire (pixel cap, frame corrotto) → riga che punta a dir
  mancante, 404 pubblico fino al prossimo upload; più finestra di 404 durante ogni re-upload riuscito.
  `saveFile` rinomina sopra i vecchi: togliere il pre-delete. (Race già in BACKLOG 1.10.)

### 5.3 Minori

- **L** `statistics.service.ts:222-242` — `to` inclusivo (`lte`), api.md §1 lo vuole esclusivo. Documentare o invertire.
- **L** `storage.service.ts:773-787` — `withMetadata({ space })` non è un'opzione sharp; riapplicare
  `orientation` dopo `.rotate()` ruoterebbe due volte. Innocuo solo perché gli input sono i nostri WebP
  senza EXIF. Togliere. BACKLOG 1.12 (EXIF orientation mai applicata in upload, `openImage:43` senza `.rotate()`) resta aperto.
- **OK** riserva quota Tinify atomica (`updateMany` condizionale, rilascio solo se `!billed`, 429 esaurisce);
  delete = riga poi file; `recordOptimizeFailure` con `updateManyAndReturn`; pagination via `PageParams`;
  date stats/snapshot tutte UTC; `addItemsToAlbum` dedupe + tx.

---

## 6. Job e infra

### 6.1 Docker / runtime

- **H** `Dockerfile:51-54`, `storage.service.ts:204-212` — i placeholder stanno in
  `${STORAGE_PATH}/defaults.fileharbor/` (tracciati in git sotto `storage/`), ma lo stage prod copia solo
  `dist`, `prisma`, `node_modules`. Volume nuovo → ogni miss pubblica = `500 "Failed to load default image"`
  (e col §4.1, path nel body). Fix: `COPY --chown=app:app storage/defaults.fileharbor ./defaults` e
  risolverli dalla dir app, non dal volume.
- **M** `Dockerfile` — niente `HEALTHCHECK`, niente doc del mount storage; uid 1001 ⇒ il bind-mount va
  chownato o `/health/ready` risponde "not writable". Fix: `HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1))"` e un commento sull'uid.
- **M** `main.ts:62` — `keepAliveTimeout` a 5 s (default Node). Se l'upstream nginx usa `keepalive`, Node
  chiude il socket idle prima di nginx → 502/ECONNRESET sporadici. Fix dopo `listen`:
  `s.keepAliveTimeout = 65_000; s.headersTimeout = 66_000`.
- **L** `app.module.ts:85-94` — throttler in memoria per replica: con N repliche il limite IP è N×;
  `clientCache` e `pendingViews` per replica (le views sono additive, corretto). Documentare; Redis solo
  se le repliche diventano reali.
- **L** `prisma/schema.prisma:8` — `binaryTargets` include `linux-musl-openssl-3.0.x`, l'immagine è Debian
  e Prisma 7 usa il driver adapter pg. Engine inutile spedito. Togliere.
- **OK** nessun `compression` middleware (giusto per binari); multi-stage, node 24.15.0 pinned,
  `pnpm prune --prod`, binari foreign rimossi, `USER app`.

### 6.2 Config

- **M** `config.schema.ts:8-43` duplica i default Joi di `config.validation.ts` leggendo `process.env`
  grezzo (`BASTION_URL` default `localhost:3001` in entrambi, `.env.example:69` dice `8080`; `THROTTLE_*`,
  `METRICS_PORT`, `BASTION_JWKS_TTL_MS` defaultati due volte). Due fonti di verità. Fix: costruire l'oggetto
  caricato dall'output di `validateConfig`.
- **M** `prisma.service.ts:20-22,50`, `storage.service.ts:34`, `video-delivery.ts:21`,
  `client-init.service.ts:24` — `process.env` fuori da config: `DATABASE_POOL_MAX`/`MAX_VIDEO_SIZE`
  bypassano la coercizione Joi (`parseInt('1e6')` = 1). Multer limits costruibili in `useFactory`.
- **L** `config.validation.ts:12,73-74,106` — `PORT` `.positive()` non `.port()`, `THROTTLE_*` non
  `.integer()`, `BASTION_JWKS_TTL_MS` senza `.min()`: `0` = un fetch JWKS per richiesta.
- **L** `main.ts:73` — `error.message.includes(...)` lancia se il reject non è un `Error`, mascherando
  l'errore originale.

### 6.3 Cron

- **M** `storage.cleanup.job.ts:39-63` — `getAllClientDomains()` lista ogni dir top-level di
  `STORAGE_PATH`, inclusa `defaults.fileharbor`: `warn "Client not found for domain: defaults.fileharbor"`
  ogni notte, e una futura pulizia delle dir sconosciute cancellerebbe i placeholder. Skip esplicito
  (o §6.1: fuori dal volume).
- **M** `prisma.service.ts:46-76` — `runExclusive` apre un `pg.Client` nuovo per run senza
  `connectionTimeoutMillis`: un connect appeso blocca quel tick a tempo indefinito. `connectionTimeoutMillis: 5000`.
- **L** `image.cleanup.job.ts:79`, `album.cleanup.job.ts:18`, `tinify-reset.job.ts:15`,
  `storage.cleanup.job.ts:28` — nessun `timeZone`, mentre lo snapshot pinna UTC. Corretto solo perché il
  container è UTC; pinnare `{ timeZone: 'UTC' }` ovunque (il mese Tinify ruota in UTC).
- **L** api.md §5 richiede `<slug>_job_last_success_timestamp_seconds{job}` per ogni job: assente.
  Sweep orfani, snapshot e pulizia token sono inosservabili quando si fermano in silenzio. Settare la
  gauge alla fine di ogni body `runExclusive`.
- **L** `fileharbor-metrics.service.ts:155-159` — `fileharbor_storage_bytes` fa 3 `groupBy sum(size)`
  (**seq scan**, nessun indice copre `size`) a ogni scrape oltre la cache 10 s di nest-common: a 15 s di
  scrape, 3 full scan di `images` ogni 15 s. ms a 100k righe, secondi a milioni. Fix: memo 60 s nel `collect`.
- **OK** sweep orfani: storage vuoto/montato tardi → `[]` → niente cancellato; dir ambigue saltate; mtime
  < 1 h lasciate; errore per dir non abortisce il dominio; advisory lock su `hashtext(job)` rilasciato in
  `finally`; Tinify auto batch limitato e stop su 401/429/5xx; snapshot idempotente.

---

## 7. Liste e DB

- **M** `album.service.ts:493-527` `listAlbumItems` — `$transaction([...])` esegue i due statement
  **in serie su una connessione**; ogni altra lista usa `Promise.all`. Fix: `Promise.all`.
- **L** `album.service.ts:174-194` — `getAlbumById` ha già `_count`, poi `countItemsByType` fa un altro
  `count`. Accorpare in `fetchItemCountMap`.
- **L** `image.service.ts:532-567` `listImages` — 6 query/pagina (findMany + 4 relazioni batchate + count),
  nessun `select` (righe intere con `dHash` 64 char, `storagePath`). Minore.
- **L** filtro `creatorId` + ordine `createdAt` → solo `@@index([creatorId])` (`:125`): sort in memoria per
  pagina. Bene finché un creator non ha 100k righe; poi `[creatorId, createdAt]`.
- **OK** indici per i predicati delle liste client (`[clientId, createdAt]`), unique su api key, share
  token, album token, creator; `dHash`, `[isOptimized, createdAt]`, `[clientId, tinifyOptimized, size]`.

---

## 8. Contratto API e documentazione

- **M** `admin-list-query.dto.ts:63-69` — sort `sortBy`/`sortOrder`; api.md §1 vuole `sort`/`order`.
  Contratto pubblicato (Meridian): aggiungere i nomi standard come alias, non rinominare.
- **M** naming tra risorse: `POST /videos/upload` vs `POST /images` / `POST /avatars`; param video `:id`
  vs `:imageId`/`:albumId`; `DELETE /images/share/:shareId` vs `POST /images/:imageId/share`. Solo
  additivo: `POST /videos` con `/upload` alias.
- **L** `upload-image.dto.ts`, `upload-video.dto.ts` — zero `@ApiProperty`; schema multipart scritto a mano
  in `@ApiBody` su 4 controller. Due descrizioni dello stesso body. `@ApiBody({ type })` + DTO decorato
  come `upload-avatar.dto.ts`.
- **L** `upload-avatar.dto.ts:10` — `file: any` senza `@Allow()`: passa solo perché multer toglie il file
  dal body.
- **L** `avatar.controller.ts:127,149`, `image.controller.ts:196` — `@ApiResponse 200` non documenta né il
  binario né il `{ data }` di `?info=true`. `@ApiOkData(…)` + `@ApiProduces('image/webp')`.
- **L** CLAUDE.md drift: client Prisma non in `node_modules/.prisma/client` con pnpm, e usa
  `@prisma/adapter-pg`; `IMAGE_X_ACCEL_REDIRECT` mai citato; job table senza nota TZ; `scripts/recover-album-items.sql`
  solo nel BACKLOG; `image.service.ts:92` cita `VIEW_FLUSH_MS` che non esiste (letterale `10_000` a `:825`).
- **OK** `TransformInterceptor` prima di `AuditInterceptor`; `@NoTransform` su file/stream/health;
  `@ApiOkData`/`@ApiPaginatedResponse` in tutti i 17 controller; DTO con class-validator su ogni input;
  ogni controller admin `@SkipThrottle` + `@RequirePermission`, ogni write admin con `@Audit()`.

---

## 9. Test e manutenibilità

`pnpm test`: 39 suite, 443 test, verdi, 17.7 s.

Scoperti: `bookmarks.service.ts` (458 righe, 0 spec, 11 `as any`), `creator.service.ts` (477) +
controller, `me/` (solo il guard; il 422 "no client mapped" no), admin controller `albums`/`videos`/
`clients`/`creators`/`bookmarks` (scope/permission wiring), `client.interceptor.ts`, `client-init.service.ts`,
`tinify-reset.job.ts`, `album.cleanup.job.ts`, `runExclusive`, `src/scripts/*`. I rami riserva/refund di
`compressImageWithTinify` solo indirettamente.

- **M** god file: `image.service.ts` 1781 righe (upload, delivery, share link, admin listing, duplicati,
  Tinify, views), `storage.service.ts` 906, `album.service.ts` 885, `image.controller.ts` 626,
  `images-admin.controller.ts` 621. Prima estrazione: Tinify (~330 righe) e share link.
- **M** duplicati: `findAdminImages`/`findAdminVideos` stessa forma; tre `addXToAlbum` (§5.1); tre
  `formatXResponse`; lookup `domain || clientId` 14× (§1.1).
- **M** `bookmarks.service.ts:68-397`, `video.service.ts:383,413` — `(this.prisma as any).adminVideoBookmark`
  sebbene i model esistano e il client sia generato: residuo, toglie il type-check. Rimuovere i cast.
- **L** 72 `any` nel codice non-spec; `no-explicit-any` disabilitato, `strictNullChecks`/`noImplicitAny`
  off. `Prisma.XGetPayload<…>` ne toglierebbe la maggior parte.
- **L** `console.*` solo in `src/scripts/`; nessun TODO/FIXME; `storage.service.ts:761` default
  `quality = 90` mai usato.

---

## 10. Piano suggerito

**Subito (un PR, mezza giornata)** — fatto, vedi CHANGELOG `Unreleased`: #1 env X-Accel (ops), #3 defaults nel Dockerfile, #5 messaggi
errore generici, #8 ETag avatar, #10 avatar pre-delete, `video.service.ts:208` lookup doppio, log
per-asset a `debug`, `connectionTimeoutMillis`, `keepAliveTimeout`.

**Prossimo (perf, un PR)** — fatto, tranne la conversione avatar cachata (il `proxy_cache` nginx a 5 m la assorbe): #2 views video bufferizzate, #4 dedupe in-flight, #6 cache domain, #7
threadpool/sharp, varianti ≤ thumb dalla thumb, conversione avatar cachata, memo `storage_bytes`.

**Poi (correttezza)**: #9 album prima dell'upload + `order` unificato, ordine write dei job optimize,
share link su pubbliche + scadenze massime, `AdminUpdateVideoDto`, tmp video in `finally`, origin check Tinify.

**Quando serve**: hash delle API key, split di `image.service.ts`, spec per bookmarks/creator/me,
metrica `job_last_success`, alias `sort`/`order`.
