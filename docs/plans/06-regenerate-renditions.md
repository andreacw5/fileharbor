---
type: plan
service: fileharbor
status: open
estimate: 0.5d
updated: 2026-10-22
verified: 4774bd3
---

# 06 · Rigenerare thumbnail e varianti di un'immagine senza cambiarne l'id

Backlog 2b.8.

## Problema

Il thumbnail (`{imageDir}/thumb.webp`) nasce all'upload (`StorageService.encodeWebpWithThumbnail`,
chiamato da `ImageService` con `THUMBNAIL_SIZE` / `THUMBNAIL_QUALITY`) e viene rifatto solo quando
qualcosa riscrive l'originale: l'optimize job (`ImageCleanupJob.optimizeImage`) e Tinify
(`ImageService.compressImageWithTinify`). Le varianti on-demand (`{imageDir}/variants/`) si
svuotano negli stessi due punti (`StorageService.clearImageVariants`).

Due casi restano scoperti:

- **cambio di `THUMBNAIL_SIZE` / `THUMBNAIL_QUALITY`**: i thumb esistenti restano alla vecchia
  misura per sempre (le immagini già ottimizzate non ripassano dal job);
- **thumb o variante corrotti** (file troncato da un disco pieno, bug di Sharp): nessun modo di
  rifarli.

Oggi l'unica via è cancellare e ricaricare: id nuovo, URL rotti in tutti i consumer.

## Decisioni

- **Solo immagini.** Gli avatar si ricaricano già sullo stesso URL (upsert per creator, l'URL è
  per creator e non per id), quindi il problema "URL rotti" non esiste; il loro thumb si
  rifà con un re-upload. I video hanno il thumbnail da ffmpeg, che è il tema di 2b.9 (poster a
  scelta, `PATCH admin/videos/:id/poster`): lì si rigenera il poster, non qui.
- **Thumb rigenerato dall'originale salvato**, non dal file d'upload (che non esiste più): stessa
  `storage.createThumbnail(original, thumbnailSize, thumbnailQuality)` che usano già optimize e
  Tinify. Seconda generazione lossy su un'immagine di 800 px: irrilevante.
- **L'originale non si tocca.** Niente re-encode, niente cambio di `size`, `isOptimized`,
  `optimizeAttempts`. Resettare `isOptimized` per far ripassare il job sarebbe la scorciatoia
  sbagliata: ricodificherebbe l'originale un'altra volta (perdita di qualità a ogni giro).
- **Le varianti si cancellano e basta**, si rigenerano da sole alla prossima GET. Dipendono solo
  da originale + parametri snappati nell'URL, non da env: un cambio di `THUMBNAIL_*` non le
  tocca. Svuotare `variants/` serve per il caso "file corrotto" ed è gratis.
- **Niente Semaphore di render.** `renderLimiter` protegge le GET pubbliche non throttolate;
  `createThumbnail` non ci passa nemmeno oggi (optimize, Tinify). Una rigenerazione admin è un
  render singolo dietro `fileharbor-media.manage`; metterla in coda con le GET pubbliche le
  farebbe solo prendere `503` sotto carico.
- **Niente lock con l'optimize job.** I file si scrivono con `saveFile` (tmp + rename, già
  atomico): nessun lettore vede mai un file a metà. Le corse possibili sono innocue:
  - GET che sta scrivendo una variante mentre `variants/` viene svuotata: la variante rinasce
    dallo stesso originale (che qui non cambia), byte identici. Se `saveFile` arriva dopo il
    `rm` della dir, `ensureDirectory` la ricrea: corretto.
  - Optimize job in parallelo sulla stessa immagine: chi scrive il thumb per ultimo vince; nel
    caso peggiore il thumb nasce dall'originale pre-optimize (q100 invece di q85), visivamente
    uguale e mai corrotto. Non vale un advisory lock.
- **`updatedAt` si muove per ultimo**, dopo thumb scritto e varianti svuotate. L'ETag è
  `"{id}-{variant}-{updatedAt}"` (`image.controller.ts`): spostandolo prima, una GET nella
  finestra servirebbe il vecchio thumb sotto il nuovo ETag e un client lo terrebbe per un anno.
  Va scritto esplicitamente (`data: { updatedAt: new Date() }`): nessun altro campo cambia.
- **Cache HTTP: stessa limitazione che ha già l'optimize job, nessun peggioramento.** Le GET
  pubbliche escono con `Cache-Control: public, max-age=31536000, immutable`: un browser o un
  proxy che ha già il thumb **non** rivalida e continua a mostrare il vecchio fino all'evizione.
  Il nuovo ETag serve solo a chi rivalida (cache svuotata, `no-cache` forzato) e trasforma il
  `304` in `200`. Chi deve vedere subito il nuovo thumb usa il cache-buster `?t=` già supportato
  da `GET /images/:id` (es. `?thumb=true&t=<updatedAt>`): la risposta dell'endpoint ritorna
  `updatedAt` apposta. URL versionati in tutte le risposte API sono fuori scope (vedi sotto).
- **Bulk come script, non come endpoint.** Il caso bulk vero è "ho cambiato `THUMBNAIL_SIZE`":
  un'azione di ops, su migliaia di immagini, che in una request HTTP andrebbe in timeout.
  Script one-off sul modello di `src/scripts/backfill-media-size.ts`, sequenziale. Niente
  `POST admin/images/bulk-regenerate`: Meridian non ne ha bisogno per il caso "thumb corrotto".
- **Nessun webhook**: l'originale non cambia, per i consumer l'immagine è la stessa.

## Step

### 1. `StorageService.regenerateImageThumb` (disco)

`src/modules/storage/storage.service.ts`, accanto a `clearImageVariants`. Disco soltanto, niente
Prisma, così lo usano sia l'endpoint sia lo script (che non può istanziare `ImageService`).

```ts
/** Rebuilds thumb.webp from the stored original and drops cached variants. The original is untouched. */
async regenerateImageThumb(domain: string, imageId: string, size: number, quality: number): Promise<void> {
  const original = await this.readFile(this.getImageFilePath(domain, imageId, 'original'));
  const thumb = await this.createThumbnail(original, size, quality);
  await this.saveFile(this.getImageFilePath(domain, imageId, 'thumb'), thumb);
  await this.clearImageVariants(domain, imageId);
}
```

Ordine: thumb prima delle varianti (se la seconda fallisce il thumb è comunque buono).
Non rifattorizzare optimize/Tinify per usarla: loro scrivono anche l'originale, è un'altra
operazione.

### 2. `ImageService.regenerateRenditions(image)`

`src/modules/image/image.service.ts`. Riceve l'immagine già caricata da `getImageById` (che
include `client.domain`).

- `domain = image.client?.domain || image.clientId` (come `getImageFile`).
- Originale assente su disco (`storage.fileExists`) → `NotFoundException('Original file missing')`.
  Senza originale non c'è niente da rigenerare: serve un re-upload.
- `storage.regenerateImageThumb(domain, image.id, this.thumbnailSize, this.thumbnailQuality)`.
  Un errore di Sharp (originale illeggibile) arriva come `InternalServerErrorException` da
  `createThumbnail`: catturarlo e rilanciare `UnprocessableEntityException('Original file is
  not a readable image')`, così Meridian distingue "file rotto, ricarica" da un 500 vero.
- `prisma.image.update({ where: { id }, data: { updatedAt: new Date() }, select: { id: true, updatedAt: true } })`
  e ritornarlo.

### 3. Endpoint `POST admin/images/:id/regenerate`

`src/modules/admin/controllers/images-admin.controller.ts`, sullo stampo di
`compressImageWithTinify` (stessa classe, quindi `@SkipThrottle()` e
`@RequirePermission('fileharbor-media.manage')` ereditati dal controller):

```ts
@Post(':id/regenerate')
@HttpCode(200)
@ApiOperation({ summary: 'Regenerate thumbnail and drop cached variants', description: '…keeps id and original; immutable caches keep the old thumb, use ?t=<updatedAt>' })
@ApiResponse({ status: 200, type: RegenerateImageResponseDto })
@ApiResponse({ status: 404, description: 'Image or original file not found' })
@ApiResponse({ status: 422, description: 'Original file is not a readable image' })
@Audit('fh_image.regenerated', {
  metadata: (_r: unknown, req: AuditRequest) => ({ imageId: req.params.id }),
})
async regenerateImage(@Param('id') id: string, @CurrentAdminUser() adminUser: AdminJwtPayload) {
  const image = await this.imageService.getImageById(id, undefined, false);
  assertClientAccess(adminUser, image.clientId);
  return plainToInstance(RegenerateImageResponseDto, await this.imageService.regenerateRenditions(image), { excludeExtraneousValues: true });
}
```

- `@HttpCode(200)` come `bulk-delete`: non crea niente (`tinify-compress` risponde 201 per default, da non imitare).
- `RegenerateImageResponseDto` in `src/modules/admin/dto/` (file dei DTO admin immagini):
  `id`, `updatedAt` (`@Expose()`, `@ApiProperty()`, `@Type(() => Date)`). Niente
  `AdminImageResponseDto` completo: la console ha già il dettaglio, le serve solo il nuovo
  `updatedAt` per il cache-buster.
- `fh_image.regenerated`: due segmenti, regex Bastion ok; metadata solo l'id.

### 4. Script bulk `src/scripts/regenerate-thumbnails.ts`

Stessa impostazione di `backfill-media-size.ts`: in `src/` (va in `dist/`), niente `AppModule`,
istanzia `ConfigService`, `PrismaService`, `StorageService` a mano; dry run di default,
`--apply` scrive.

- Argomento opzionale `--client <clientId>`; senza, tutte le immagini.
- Pagine da 500 per `id` (cursor), `select: { id, clientId, client: { select: { domain } } }`.
- Per riga, sequenziale: `storage.regenerateImageThumb(...)` con `THUMBNAIL_SIZE` /
  `THUMBNAIL_QUALITY` letti dal `ConfigService`, poi `prisma.image.update({ data: { updatedAt: new Date() } })`.
  Originale mancante o illeggibile → `warn`, contatore `failed`, avanti.
- Dry run: conta solo le righe e quelle senza originale su disco.
- Tabella finale `checked / regenerated / missing / failed`.
- Idempotente: rilanciarlo rifà gli stessi thumb.

```bash
docker exec <fileharbor-container> node dist/scripts/regenerate-thumbnails.js                 # dry run
docker exec <fileharbor-container> node dist/scripts/regenerate-thumbnails.js --apply [--client <id>]
```

Gira col servizio acceso: le scritture sono atomiche e la CPU è un render alla volta. Il
container deve avere già il nuovo `THUMBNAIL_SIZE` (quindi: deploy dell'env, poi script).

### 5. Commento ETag

`image.controller.ts`, commento sopra l'`etag` ("updatedAt moves when the file is rewritten
(optimize job, Tinify)"): aggiungere la rigenerazione.

## Test

- `image.service.spec.ts` (`regenerateRenditions`):
  - chiama `storage.regenerateImageThumb` con `THUMBNAIL_SIZE` / `THUMBNAIL_QUALITY` e il domain
    risolto (`client.domain`, poi fallback a `clientId`);
  - aggiorna `updatedAt` **dopo** la rigenerazione (ordine delle chiamate sui mock);
  - originale assente → `404`, nessuna scrittura, `updatedAt` invariato;
  - `createThumbnail` che lancia → `422`, `updatedAt` invariato.
- `storage.service.spec.ts` (`regenerateImageThumb`, su dir temporanea): thumb riscritto con le nuove
  dimensioni, `variants/` sparita, originale byte-identico.
- `images-admin.controller.spec.ts`: `assertClientAccess` rifiuta un client fuori scope (403)
  prima di toccare il servizio.
- Script: niente spec (come `backfill-media-size.ts`); prova manuale in locale con dry run e
  `--apply` su un client.

## Doc da aggiornare

- `CLAUDE.md`:
  - Image Processing → On-demand variants: `POST admin/images/:id/regenerate` rifà il thumb e
    svuota `variants/`, originale e id invariati; per la cache `immutable` serve `?t=`.
  - Scheduled Jobs, paragrafo dello script one-off: aggiungere `regenerate-thumbnails.js`
    (dopo un cambio di `THUMBNAIL_SIZE` / `THUMBNAIL_QUALITY`).
  - Audit: `fh_image.regenerated` tra gli esempi solo se si tiene una lista (oggi no).
- `openapi.json` (radice del repo, generato da `pnpm openapi:dump`, letto da `gen:types` di
  `@heyatom/client`): rigenerarlo e committarlo. Contiene già le route `admin/images/*`
  (`/admin/images/{id}/tinify-compress` c'è).
- `.env.example`: commento su `THUMBNAIL_SIZE` / `THUMBNAIL_QUALITY` — un cambio vale solo per i
  nuovi upload finché non si lancia lo script.
- `../docs/integrations/fileharbor.md`: nulla, l'endpoint è admin-only e la guida cita già `?t=`.

## Meridian (nota, repo separato)

- Bottone "Rigenera anteprime" nel dettaglio immagine, dietro `fileharbor-media.manage`
  (stessa policy di `tinify-compress` in `server/utils/permission-policy.ts`): route BFF
  `POST /api/fileharbor/admin/images/:id/regenerate`.
- Dopo il 200, ricaricare l'anteprima con `?thumb=true&t=<updatedAt>`: il browser della console
  ha il vecchio thumb in cache `immutable` e senza `t` continuerebbe a mostrarlo.
- `422` → messaggio "file originale illeggibile, ricaricare l'immagine".
- Nessuna azione bulk in console.

## Fuori scope

- **Avatar**: re-upload sullo stesso URL. Aggiungere `POST admin/avatars/:id/regenerate` solo se
  serve rifare in massa i thumb degli avatar dopo un cambio di `THUMBNAIL_SIZE` (lo script dello
  step 4 si estende con un flag `--avatars`).
- **Thumbnail video**: 2b.9.
- **URL versionati** (`thumbnailUrl` con `?t=<updatedAt>` in tutte le risposte): risolverebbe la
  cache `immutable` per tutti i consumer, anche dopo optimize e Tinify, ma cambia ogni risposta
  e gli URL già salvati dai consumer. Problema preesistente, non di questo piano.
- **Purge di CDN/proxy**: nessuna CDN in mezzo oggi. Se nginx in prod ha un `proxy_cache` sulle
  immagini (config fuori repo, da verificare), il vecchio thumb resta anche lì fino alla scadenza.
- Endpoint bulk HTTP, rigenerazione automatica al cambio di env (confrontare dimensioni dei thumb
  al boot): lo script basta.
