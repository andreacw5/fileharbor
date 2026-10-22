---
type: plan
service: fileharbor
status: open
estimate: 1d
updated: 2026-10-22
verified: 4774bd3
---

# 08 · Placeholder immagine: ThumbHash + colore dominante

Backlog 2b.1.

## Problema

I siti Nuxt (heyatom-portfolio, puma-arts, sgweb, i consumer di Articuno) ricevono da `info`/list
solo `width`/`height` e URL. Finché il file non arriva il riquadro resta vuoto: per un blur-up serve
una seconda richiesta (il thumb, 800 px a q70, decine di KB) o niente. Vogliamo un placeholder di
poche decine di byte già dentro la risposta JSON, calcolato una volta all'upload.

## Decisioni

- **ThumbHash, non BlurHash.** Verificati 2026-10-22 su npm: `thumbhash@0.1.1` (MIT, Evan Wallace,
  zero dipendenze, 12 KB, fermo dal 2023 perché l'algoritmo è chiuso) e `blurhash@2.0.5` (MIT).
  ThumbHash a parità di byte (~25 B, ~35 caratteri base64) rende più dettaglio, **codifica il
  rapporto d'aspetto e l'alpha** (PNG/WebP trasparenti: BlurHash li appiattisce) e non ha parametri
  da scegliere (BlurHash vuole `componentX/Y` per immagine). Il decoder lato browser è una funzione
  (`thumbHashToDataURL`) del pacchetto stesso.
- **Encoder copiato nel repo, nessuna dipendenza.** `thumbhash` è ESM-only (`"type": "module"`),
  FileHarbor è CommonJS con ts-jest: `require(esm)` va su Node 24 ma Jest richiederebbe
  `transformIgnorePatterns` ad hoc. Ci serve solo `rgbaToThumbHash` (~80 righe, aritmetica pura):
  va in `src/utils/thumbhash.ts` con l'header di licenza MIT originale. Se si preferisce la
  dipendenza: `pnpm add thumbhash@0.1.1` e sistemare Jest, il resto del piano non cambia.
- **Più colore dominante** (`sharp().stats().dominant`, già installato): ThumbHash richiede JS nel
  client; `dominantColor` basta come `background-color` CSS senza JS (SSR, email, liste lunghe).
  Solo il colore dominante non basta: per le foto un blocco piatto è peggio di un blur.
- **Calcolato dal thumbnail appena codificato, non dalla sorgente.** Il thumb (≤ `THUMBNAIL_SIZE`,
  default 800) è già in memoria, decodificarlo costa pochi ms contro una seconda decodifica del
  sorgente fino a 100 MP. Il placeholder corrisponde ai pixel serviti, e il backfill può usare lo
  stesso file da disco (`thumb.webp`): stessa funzione, stesso risultato.
- **Immagini animate: primo frame.** `openImage(buffer, false)` (`storage.service.ts`) prende solo il
  primo frame; aperta animata, `raw()` uscirebbe come striscia di frame.
- **Mai far fallire l'upload.** Errore nel calcolo → `warn`, colonne `null`. Il placeholder è un
  abbellimento: il consumer deve già gestire `null` (righe vecchie prima del backfill).
- **Non ricalcolato dopo optimize o Tinify.** L'optimize ricodifica il thumb a qualità diversa e
  Tinify tocca solo l'originale: a 100 px di lato i pixel non cambiano in modo visibile.
- **Avatar: no.** Mostrati piccoli e tondi, il layout non salta (dimensione fissa nel CSS del
  consumer). Si aggiunge chiamando la stessa funzione se un sito lo chiede.
- **Video thumbnail: no.** Servirebbero colonne su `Video` e il calcolo dopo ffmpeg; nessun sito
  oggi fa blur-up dei poster. Stessa funzione quando servirà.
- **Admin (`AdminImageResponseDto`): no** in questo piano. Meridian non fa blur-up; sono due righe
  quando servirà.

## Step

### 1. Schema

```prisma
model Image {
  thumbHash     String? // base64 ThumbHash of the first frame; null = not computed
  dominantColor String? // "#rrggbb"; null = not computed
}
```

`pnpm run prisma:migrate` (nome `image_placeholders`). Colonne nullable, nessun default, nessun
indice (mai filtrate, salvo il backfill una tantum). Migrazione additiva: nessun lock lungo.

### 2. Encoder e funzione di calcolo

- `src/utils/thumbhash.ts`: `rgbaToThumbHash(w, h, rgba): Uint8Array`, copiato da
  [evanw/thumbhash](https://github.com/evanw/thumbhash) `js/thumbhash.js`, tipizzato, header MIT.
- `StorageService.computePlaceholder(input: Buffer): Promise<{ thumbHash: string; dominantColor: string }>`:

  ```ts
  const small = openImage(input, false) // first frame only
    .resize(100, 100, { fit: 'inside' }) // ThumbHash encoder caps at 100x100
    .ensureAlpha();
  const [{ data, info }, { dominant }] = await Promise.all([
    small.clone().raw().toBuffer({ resolveWithObject: true }),
    small.clone().stats(),
  ]);
  const thumbHash = Buffer.from(rgbaToThumbHash(info.width, info.height, data)).toString('base64');
  const dominantColor = '#' + [dominant.r, dominant.g, dominant.b]
    .map((c) => c.toString(16).padStart(2, '0')).join('');
  ```

  Nessun try/catch qui: decide il chiamante (upload ingoia, backfill conta).
- Non passa dal `Semaphore` di `resizeImage`: è nell'upload, come `encodeWebpWithThumbnail`.

### 3. Upload

`ImageService.uploadImage` (`image/image.service.ts`), dopo `encodeWebpWithThumbnail`:

```ts
const placeholder = await this.storage.computePlaceholder(thumbBuffer).catch((error) => {
  this.logger.warn(`[uploadImage] Placeholder failed - ID: ${imageId}: ${error instanceof Error ? error.message : error}`);
  return null;
});
```

e nel `prisma.image.create`: `thumbHash: placeholder?.thumbHash ?? null`,
`dominantColor: placeholder?.dominantColor ?? null`. Costo atteso: decodifica WebP ≤ 800 px +
resize + due passate su 10k pixel, nell'ordine di pochi ms contro le decine/centinaia della
codifica WebP q100. Da confermare con un upload locale di una foto da 12 MP (log `debug` dei tempi,
poi tolto).

### 4. Risposte API

- `ImageResponseDto` (`image/dto/image-response.dto.ts`): due campi, letti da `formatImageResponse`
  tramite lo spread `...image` (le query di info/list/upload/PATCH usano `include`, quindi le colonne
  arrivano già). Copre `POST /images`, `GET /images?…`, `GET /images/:id?info=true`,
  `PATCH /images/:id`, la risposta Tinify (`TinifyCompressionResponseDto.image`) e la bulk upload
  admin (`images-admin.controller.ts`, che ritorna `ImageResponseDto[]`).

  ```ts
  @ApiPropertyOptional({
    description: 'ThumbHash of the first frame (base64), for blur-up placeholders. Decode with thumbHashToDataURL from the thumbhash package. Null until computed.',
    example: '1QcSHQRnh493V4dIh4eXh1h4kJUI',
    nullable: true,
    type: String,
  })
  @Expose()
  thumbHash: string | null;

  @ApiPropertyOptional({
    description: 'Dominant color as #rrggbb, usable as a CSS background while loading. Null until computed.',
    example: '#6b7f8c',
    nullable: true,
    type: String,
  })
  @Expose()
  dominantColor: string | null;
  ```

- Album: `AlbumItemImageDataDto` (`album/dto/album-item.dto.ts`) stessi due campi; in
  `AlbumService.listAlbumItems` aggiungere `thumbHash: true, dominantColor: true` alla `select`
  dell'immagine (lì è `select`, non `include`: senza, i campi escono `undefined`) e copiarli in
  `mapAlbumItem`. Le gallerie di puma-arts e portfolio leggono gli album: senza questo il piano
  serve a metà.
- Webhook `image.uploaded`: invariato (Discord).

> **Coordinare con il piano 09** (`srcset` nella risposta `info`): tocca gli stessi file
> (`ImageResponseDto`, `formatImageResponse`, forse `AlbumItemImageDataDto`/`mapAlbumItem`) e la
> stessa rigenerazione dell'SDK. Chi arriva secondo fa rebase sui DTO; una sola release dell'SDK
> con entrambi i campi se escono vicini.

### 5. Backfill

`src/scripts/backfill-image-placeholders.ts`, sul modello di `backfill-media-size.ts`: in `src/`
(passa da `nest build`), niente `AppModule`, `PrismaService` + `StorageService(new ConfigService())`
istanziati a mano, `domain = client.domain || clientId`.

- immagini con `thumbHash: null`, a pagine da 500 per `id` (cursor, `orderBy id`);
- legge `storage.getImageFilePath(dir, id, 'thumb')`; se manca, ripiega su `'original'`; se mancano
  entrambi → `missing`, `warn`, avanti;
- `computePlaceholder` → `update` con `--apply`; un errore → `failed`, `warn`, avanti (un file
  corrotto non ferma il lotto);
- dry run di default: calcola comunque (verifica che i file siano leggibili) e stampa la tabella
  `checked / computed / missing / failed`, senza scrivere. Idempotente: le righe scritte escono dal
  filtro.

```bash
docker exec <fileharbor-container> node dist/scripts/backfill-image-placeholders.js          # dry run
docker exec <fileharbor-container> node dist/scripts/backfill-image-placeholders.js --apply
```

Lanciarlo **dopo** il deploy: le immagini caricate prima del deploy restano `null` fino al run.
Gira su un processo a parte, sequenziale: CPU di un core per pochi minuti anche su migliaia di
immagini, accettabile in orario di basso traffico.

## Test

- `storage.service.spec.ts`, `computePlaceholder` con buffer veri generati da Sharp (niente mock):
  - PNG pieno rosso 200×100 → `dominantColor === '#ff0000'`, `thumbHash` base64 non vuoto;
  - stesso input → stesso output (deterministico);
  - GIF animata 2 frame (rosso, blu) → colore del primo frame;
  - PNG trasparente → non lancia.
- `src/utils/thumbhash.spec.ts`: un vettore calcolato una volta con il pacchetto npm upstream
  (input RGBA fisso → hash atteso, scritto nel test), così un errore di trascrizione dell'encoder
  fallisce subito.
- `image.service.spec.ts`: upload salva `thumbHash`/`dominantColor`; con `computePlaceholder` che
  rigetta l'upload riesce e salva `null`.
- `album.service.spec.ts`: `mapAlbumItem` espone i due campi.

## Doc da aggiornare

- `CLAUDE.md` (fileharbor), sezione Image Processing: placeholder calcolato all'upload dal thumb,
  primo frame per le animate, `null` se fallisce; riga sullo script di backfill accanto a
  `backfill-media-size`.
- `../docs/integrations/fileharbor.md`: `thumbHash` e `dominantColor` in `interface ImageResponse`
  e nell'item album, con esempio Nuxt:

  ```ts
  import { thumbHashToDataURL } from 'thumbhash';
  const placeholder = img.thumbHash
    ? thumbHashToDataURL(Uint8Array.from(atob(img.thumbHash), (c) => c.charCodeAt(0)))
    : undefined;
  // <img :style="{ background: img.dominantColor ?? undefined }" ...>
  ```

  e la nota: entrambi possono essere `null` (righe vecchie, calcolo fallito).
- SDK `@heyatom/client` (`../heyatom-client/`): solo rigenerazione, nessun codice a mano (nessun
  file fuori da `types.gen.ts` cita `ImageResponseDto`). `pnpm openapi:dump && pnpm gen:types` →
  `ImageResponseDto` e `AlbumItemImageDataDto` prendono `thumbHash?: string | null` e
  `dominantColor?: string | null`. Campi opzionali: minor bump (0.2.2 → 0.3.0, insieme al 09 se
  vicini). Il decoder non va nell'SDK: è una dipendenza browser del sito.

## Fuori scope

- Avatar e poster video (vedi Decisioni): stessa `computePlaceholder` quando un consumer lo chiede.
- Campi nella risposta admin e in Meridian.
- Data URL già decodificato lato server: ~1–2 KB per immagine in ogni lista, contro ~35 caratteri;
  il decoding è affare del client.
- Ricalcolo su optimize/Tinify/rigenerazione thumbnail (2b.8): da rivedere solo se 2b.8 cambia i
  pixel del thumb in modo visibile (es. crop).
