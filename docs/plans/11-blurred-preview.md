---
type: plan
service: fileharbor
status: done
estimate: 1d
updated: 2026-10-29
verified: f9d95ee
---

# 11 · Anteprima sfocata delle immagini private (`?blur=1`)

## Problema

Almanac archivia su FileHarbor le opere DeviantArt degli autori, tutte con `isPrivate: true`
([upload.service.ts](../../../almanac/src/modules/sync/upload.service.ts)), e le serve dal proprio
proxy (`stream()` in [admin-catalog.service.ts](../../../almanac/src/modules/admin/admin-catalog.service.ts))
con `X-API-Key` + `X-User-Id` dell'autore. Chi può vedere cosa (`PUBLIC` / `TIER` / `PREMIUM`) lo
decide Almanac, non FileHarbor.

Vogliamo che un utente free veda le opere riservate **sfocate** e che un subscriber le veda
**reali**. Oggi FileHarbor sa dare solo l'originale o il lucchetto
(`fileharbor_permission_denided.webp`): non esiste un "parzialmente visibile".

## Decisioni

- **FileHarbor non sa niente di abbonamenti.** Free o subscriber lo decide il client (Almanac) e lo
  traduce in una richiesta: `?blur=1` per il free, la richiesta normale per il subscriber.
  FileHarbor offre solo la variante sfocata.
- **Il blur è una rendition, non una regola d'accesso.** `?blur=1` richiede lo stesso accesso
  dell'originale (proprietario, share token valido, oppure immagine pubblica): `validateImageAccess`
  non cambia. Ad Almanac basta, perché il proxy manda già `X-User-Id` = autore, cioè il proprietario.
  Anonimi e altri client continuano a ricevere il lucchetto. Scartati sia `Client.privatePreview`
  (blur per gli anonimi) sia la regola "chiave del client senza `X-User-Id`": non servono a nessun
  consumer, e `X-User-Id` è comunque dichiarato da chi possiede la chiave, quindi non è un confine di
  sicurezza.
- **`blur` effettivo = `query.blur && !query.info && !query.download`.** `info` e `download` vincono,
  e il percorso resta quello normale. Su `thumb` / `width` / `height` / `format` / `quality` vince
  `blur`: vengono ignorati e si serve sempre lo stesso file.
- **Prima si rimpicciolisce, poi si sfoca, in due passate.** In sharp una pipeline ha una sola
  `resize()`: la seconda sostituisce la prima. Con `.resize(32).resize(480)` in catena si passerebbe
  quindi da 2000 a 480 direttamente, cioè un blur su una sorgente piena, parzialmente invertibile
  (verificato in review su rumore 2000×1000: stdev 15.8 contro 1.1). Il passaggio a 32 px va fatto
  con un `toBuffer()` intermedio:
  ```ts
  const small = await openImage(input, false).resize(32, 32, { fit: 'inside' }).png().toBuffer();
  return sharp(small).resize(480, 480, { fit: 'inside' }).blur(6).webp({ quality: 50 }).toBuffer();
  ```
  Si serve a 480 px, così il risultato è liscio senza contare sull'upscaling del browser, e pesa
  pochi KB. `BLUR_SOURCE_SIZE = 32` è la manopola della sicurezza: più alto vuol dire più
  riconoscibile. A 32 px restano leggibili composizione, colori e sagoma. È una scelta di prodotto:
  il free vede "cosa" c'è, non "come". Le costanti vanno in `image-variants.ts`, nessuna env finché
  non serve tararle in prod.
- **Una sola sorgente: il thumb.** Il blur si fa sempre da `thumb.webp` (≤ 800 px), sia all'upload
  sia al volo. Si usa l'originale solo se il thumb manca. Così si decodificano pochi pixel e il
  contenuto è sempre lo stesso sotto lo stesso ETag. A 32 px il risultato equivale a quello che si
  otterrebbe partendo dalla sorgente.
- **Pre-generato all'upload, per ogni immagine.** `images/{id}/blurred.webp`, accanto a
  `thumb.webp`. Va generato sempre, non solo per le private: costa pochi KB e copre il `PATCH` che
  porta `isPrivate` a `true` più tardi. Best-effort: un errore dà un `warn` e l'upload riesce comunque.
- **Generato al volo se manca.** Immagini caricate prima di questo piano, o una generazione fallita:
  alla prima richiesta `?blur=1` si costruisce dentro `renderLimiter` e si salva. **Nessuno script di
  backfill.** Due richieste concorrenti sullo stesso file mancante lo generano entrambe: `saveFile` fa
  tmp + rename, vince l'ultima, il contenuto è identico. Non serve un lock.
- **Mai ripiegare sull'originale.** Se il blur non si può dare (sorgente illeggibile, coda piena),
  il ramo `blur` lancia un'eccezione (`422` / `503` con `Retry-After`) e non prosegue nel resto di
  `getImageFile`. Un fall-through servirebbe l'originale a chi Almanac voleva mostrare solo il blur.
- **Animate: primo frame** (`openImage(buffer, false)`).
- **Ricostruito solo da regenerate.** `POST admin/images/:id/regenerate` lo riscrive dopo il thumb.
  Optimize e Tinify ricodificano a parità di pixel: a 32 px non cambia nulla, quindi non lo toccano.
  Il loro `updatedAt` cambia comunque l'ETag, il che è innocuo.
- **Non conta come view**, nemmeno sul `304`.
- **Cache: invariata.** Privata o con token → `private, no-store` (regola `restricted` di oggi),
  pubblica → `public, immutable`. ETag con variante `blur`.
- **Storage report e metriche: escluso**, come thumb e varianti (si conta solo `size` dell'originale).
- **Verificato in review, nessun bypass.** Le route admin `download`/`file` passano da `getImageFile`
  senza `blur`. `albums/shared/:token` restituisce JSON e i byte passano sempre da `GET /images/:id`.
  `deleteImage` e `StorageCleanupJob` cancellano l'intera dir. `X-Accel-Redirect` funziona sul nuovo
  file.
- **Fuori da questo piano:**
  - Il lato Almanac (il proxy passa `?blur=1` ai free) è la decisione P-6 del
    [piano 14 di Almanac](../../../almanac/docs/plans/14-public-api.md). Vincolo per quel piano: **URL distinte per variante** (es. `/assets/:id/image?blur=1` e `/assets/:id/image`, o due
    route). Il proxy risponde `Cache-Control: private, max-age=86400`: se free e subscriber leggessero
    la stessa URL e solo il server scegliesse cosa servire, chi si abbona vedrebbe il blur dalla cache
    del browser fino a 24 h (e chi disdice continuerebbe a vedere l'originale). Con URL diverse è la UI a
    scegliere quale chiedere, e la cache non si confonde. `Vary` non è un'alternativa affidabile per la
    cache del browser.
  - Lo share link breve, per far caricare l'originale al subscriber direttamente da FileHarbor senza
    passare dal proxy, esiste già (`POST /images/:imageId/share`) e si valuta su Almanac.
  - Avatar e video: da aggiungere, con la stessa funzione, quando qualcuno lo chiede.

## Step

### 1. Storage

- `StorageService.blurImage(source: Buffer): Promise<Buffer>`: la pipeline in due passate sopra,
  dentro `renderLimiter.run(...)` sullo schema di `resizeImage` (coda piena → `RenderBusyException`).
  È una sola funzione pubblica, usata da upload, generazione al volo e regenerate. Upload e regenerate
  sono rari, quindi il limiter lì non fa danni.
- `getImageFilePath(..., variant)`: `variant` accetta anche `'blurred'`.
- `regenerateImageThumb`: dopo aver salvato il thumb, `blurImage(thumb)` → `saveFile(..., 'blurred')`
  **fuori** dal `try` che produce il `422`, con `.catch(warn)`. Un blur rotto non deve bloccare la
  rigenerazione del thumb, e c'è comunque la generazione al volo.

### 2. Upload

`ImageService.uploadImage`: dopo il salvataggio del thumb,
`blurImage(thumbBuffer)` → `saveFile(..., 'blurred')`, dentro `.catch(warn)` come `dHash`.

### 3. File

`getImageFile(image, { blur })`: se `blur`, all'inizio, ramo chiuso:
1. `blurred.webp` esiste → `return fromDisk(...)` (vale anche con `X-Accel-Redirect`).
2. Altrimenti la sorgente è `thumb.webp` se esiste, se no l'originale. `blurImage(sorgente)`, salvataggio
   con `.catch(warn)` come per le varianti, `return { mimeType: 'image/webp', buffer }`.
3. Lettura o decodifica fallita → `UnprocessableEntityException`, limiter pieno → `RenderBusyException`
   (`503`). **Nessun `return` sull'originale.**

### 4. Controller e DTO

- `GetImageDto`: `blur?: boolean`, `@Transform` come `thumb`, `@ApiPropertyOptional` ("stesso accesso
  dell'originale; ignorato con `info`/`download`").
- `getImage`: `const blur = !!query.blur && !query.info && !query.download`, usato per:
  - `variant` dell'ETag = `'blur'`;
  - `countHit` = no-op quando `blur`, così il ramo `304` (image.controller.ts:333) non conta;
  - `getImageFile(image, { blur, ... })`;
  - `requestType` nel log = `'blur'`.
- `validateImageAccess` e il ramo dello share token: invariati.
- Swagger dell'endpoint: aggiungere `?blur`.

### 5. SDK

`heyatom-client`: rigenerare `src/fileharbor/types.gen.ts` dall'OpenAPI (`blur` in query). Nessun
helper nuovo.

### 6. Test

- `storage.service.spec`, `blurImage`:
  - su un PNG di rumore 2000×1000 l'output è ≤ 480 px di lato, mantiene le proporzioni e ha `stdev`
    (sharp `stats()`) sotto una soglia bassa. Questo test fallisce se le due passate collassano in
    una;
  - su una GIF animata produce un solo frame;
  - con coda piena lancia `RenderBusyException`.
- `image.service.spec`, `getImageFile` con `blur`:
  - file presente → letto da disco;
  - assente → generato dal thumb e salvato;
  - thumb assente → generato dall'originale;
  - `blurImage` che lancia → l'errore si propaga e l'originale non viene mai restituito.
- Controller:
  - `?blur=1` non incrementa le view, nemmeno su `304`;
  - ETag diverso dalla variante piena;
  - `?blur=1&download=1` → download normale;
  - `?blur=1` anonimo su un'immagine privata → lucchetto.

### 7. Doc

- `CLAUDE.md` § Image Processing: `blurred.webp`, rendition con stesso accesso, due passate, generazione
  al volo, nessun fall-through, nessuna view. § Storage Paths: il nuovo file.
- `../docs/integrations/fileharbor.md`: `?blur=1` e lo schema free/subscriber via proxy.
- `plans/README.md`: riga 11 (già aggiunta).

## Verifica

1. Upload privato → `blurred.webp` su disco, pochi KB, ≤ 480 px, illeggibile nei dettagli.
2. `GET /images/:id?blur=1` con chiave + `X-User-Id` del proprietario (come Almanac) → `200` sfocata,
   view invariate.
3. Stessa richiesta senza chiave, o con un altro client → lucchetto
   (`X-FileHarbor-Fallback: permission_denied`).
4. Cancellare `blurred.webp` → `?blur=1` lo rigenera dal thumb e lo salva.
5. Cancellare anche `thumb.webp` → rigenera dall'originale.
6. `POST admin/images/:id/regenerate` → `thumb.webp` e `blurred.webp` riscritti.

## Addendum `blurPublic`

29/10/2026, per Almanac piano 14 P-8. **Approvato dall'utente il 29/10/2026.**

Il sito `wood19aw.cc` carica le immagini **direttamente da FileHarbor** (Almanac dà solo l'URL,
[piano 14](../../../almanac/docs/plans/14-public-api.md) § Immagini e cache). Le copie delle opere
bloccate sono private: il browser di un visitatore free è anonimo, e "stesso accesso dell'originale"
gli darebbe il lucchetto anche per `?blur=1`. Uno share token non va bene: apre l'intera immagine
(`?blur=1&token=` meno `blur=1` = originale). Serve che la sfocata di una copia privata sia servibile
a un anonimo, **quando il proprietario lo decide, per immagine**.

### Decisione

- **`Image.blurPublic Boolean @default(false)`**: "la rendition `?blur=1` di questa immagine è
  pubblica, anche se l'immagine è privata". Per immagine e non per client (il `Client.privatePreview`
  scartato sopra): il client di Almanac tiene anche le copie degli artisti dei preferiti, che non
  devono uscire nemmeno sfocate (Almanac D-013). Almanac lo scrive con `isPrivate`.
- **Scrittura**: `PATCH /images/:id` accetta `blurPublic` (solo il proprietario, come `isPrivate`);
  `POST /images` lo accetta all'upload. Audit con `fields: ['blurPublic']`. Nella risposta immagine.
- **Lettura**: in `getImage`, quando `blur` è effettivo (`query.blur && !info && !download`) e
  `image.blurPublic`, si salta `validateImageAccess` (niente token, niente chiave): l'unica cosa
  servibile in quel ramo è `blurred.webp`, e il piano sopra garantisce che il ramo blur non ripiega
  mai sull'originale. `info`, `download` e la richiesta senza `blur` restano come oggi (lucchetto o
  `403`). Con un token valido non cambia niente.
- **Cache**: in quel caso `restricted = false` → `public, max-age=31536000, immutable`, ETag con la
  variante `blur`. La sfocata è uguale per tutti e non cambia se `isPrivate` cambia; se l'immagine
  viene cancellata una copia in cache è innocua (è la sfocata).
- **Non conta come view**, come ogni `?blur=1`.
- **Pre-generazione**: già prevista per tutte le immagini; il caso "al volo se manca" vale anche qui
  (`renderLimiter`, `503` + `Retry-After` se piena, mai l'originale).

### Step in più

1. Prisma: colonna + migration additiva. DTO `UpdateImageMetadataDto`/`UploadImageDto`:
   `blurPublic?: boolean`; `ImageResponseDto.blurPublic`.
2. `image.controller.ts` `getImage`: calcolo di `blur` **prima** del controllo d'accesso; ramo
   `if (blur && image.blurPublic)` che carica l'immagine senza `validateImageAccess`; `restricted`
   che tiene conto del caso.
3. Test controller: `?blur=1` anonimo su privata con `blurPublic` → `200` sfocata, `public, immutable`,
   nessuna view; la stessa senza `blur` → lucchetto; `?blur=1&download=1` → `403`; `?blur=1&info=1`
   → `403`; `blurPublic: false` → lucchetto; `PATCH` di `blurPublic` da un non proprietario → `404`.
4. SDK `heyatom-client`: tipi rigenerati, `blurPublic` in `updateImage`/`uploadImage`.
5. Doc: `../docs/integrations/fileharbor.md` (campo e regola), `CLAUDE.md`.

Stima: +0,25d. Approvato (Almanac P-8, 29/10/2026): si fa insieme al piano 11; la sfocata delle bloccate
non passa dal proxy di Almanac.

## Implementazione (2026-10-29)

Fatto come da piano, addendum compreso: `StorageService.blurImage`, `ImageService.getBlurredFile`
(ramo chiuso di `getImageFile`), pre-generazione in upload e `regenerateImageThumb`, `blur` in
`GetImageDto`, `Image.blurPublic` (migration `20261029120000_image_blur_public`) su upload, `PATCH`,
risposta e audit; SDK rigenerato; doc in `CLAUDE.md` e `../docs/integrations/fileharbor.md`.

Scostamento: il test sulla `stdev` usa una scacchiera a quadri da 50 px, non il rumore. Con sharp 0.35
il rumore 2000×1000 esce piatto anche in una passata sola (0,9 contro 0,9), quindi non distingueva i
due casi; la scacchiera sì (~20 contro ~1,5).

Da fare dopo il deploy: la [Verifica](#verifica) manuale sopra e la migration.

