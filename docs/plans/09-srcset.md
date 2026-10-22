---
type: plan
service: fileharbor
status: open
estimate: 0.5d
updated: 2026-10-22
verified: 4774bd3
---

# 09 · `srcset` pronto nelle risposte immagine

Backlog §2b.2.

## Problema

Le risposte immagine danno un solo URL (`fullPath`) e ogni sito si costruisce i `?width=` a mano.
Oggi lo fanno puma-arts e heyatom-portfolio con `app/utils/img.ts` (`srcset(url, widths)`), con
larghezze scelte pagina per pagina: `[600, 750, 900, 1200, 1800]`, `[400, 600, 800, 1200]`,
`[800, 1200, 1600, 2000]`, `[600, 900, 1200, 1600]` (`puma-arts/app/pages/*.vue`).

Questo crea tre problemi:

- **Descrittori sbagliati**: il server arrotonda per eccesso (`snapSize`, `image-variants.ts`), quindi
  `?width=750` restituisce 768 px, `?width=900` 960, `?width=2000` 2560, mentre lo `srcset` dichiara
  `750w`, `900w`, `2000w`. Il browser sceglie su larghezze che non corrispondono ai file.
- **Varianti inutili**: Sharp usa `withoutEnlargement: true` (`StorageService.resizeImage`), quindi su
  un originale da 1000 px `?width=1200`, `?width=1600` e `?width=2000` producono lo stesso file in
  tre slot di cache diversi.
- **Cache per immagine frammentata**: ogni pagina usa una serie diversa, così una stessa opera
  accumula 480, 640, 768, 960, 1280, 1600, 1920, 2560 (8 varianti su `MAX_CACHED_VARIANTS` = 20,
  `image.service.ts`). Superato il limite la variante viene renderizzata a ogni richiesta e non
  viene salvata.

## Decisioni

- **Larghezze fisse: `SRCSET_WIDTHS = [320, 640, 960, 1280, 1920]`**, tutte presenti in
  `VARIANT_SIZES` (il test lo verifica). Restano solo quelle **strettamente minori** della `width`
  originale, e in fondo si aggiunge sempre l'originale stesso (`fullPath` senza query,
  `{width}w`).
  - Non uso tutte le `VARIANT_SIZES` ≤ originale: su una foto da 4096 px sarebbero 23 voci, oltre
    il limite di 20 varianti in cache. Il browser ne scaricherebbe una sola, ma su viewport
    diversi riempirebbe la cache con varianti a 32 px di distanza l'una dall'altra.
  - Cinque larghezze con passo circa 1,5× coprono da mobile 1x a desktop 2x. Lasciano 15 slot liberi
    per thumb, `?width=` scritti a mano e formati jpeg/png.
  - L'originale si serve dal file su disco, senza render e senza slot di cache
    (`getImageFile`: niente width/height e formato webp vuol dire `original.webp`). Per questo
    sostituisce la larghezza fissa che gli è uguale o più grande: un'immagine da 1920 px ha
    320/640/960/1280 più l'originale, mentre `?width=1920` sarebbe lo stesso file renderizzato
    di nuovo.
  - Niente 2560/3840: sopra 1920 px si usa l'originale, che è già WebP ottimizzato a q85
    dall'optimize job.
- **Formato e qualità non compaiono nell'URL**: `?width=N` da solo vuol dire WebP
  (`format` di default) a q85 (`snapQuality(undefined)` = `DEFAULT_VARIANT_QUALITY`). URL più corti
  e una sola variante per larghezza. Quando arriverà `format=auto` (§2b.4) gli stessi URL
  cambieranno formato in base all'header `Accept`, senza modificare il contratto.
- **URL assoluti, basati su `fullPath`**: lo `srcset` serve a chi deve mostrare l'immagine
  pubblicamente, e i path relativi (`url`, `thumbnailUrl`) in prod non hanno il `/v2` di nginx (vedi
  CLAUDE.md "API Versioning"). Si parte da `this.route.fullUrl('images', id)` e si aggiunge
  `?width=N` come stringa, non come segmento: `fullUrl` unisce i segmenti con `/`.
- **Immagini private: campo omesso** (`srcset` `undefined`, quindi assente dal JSON). Per le
  private servono `X-API-Key` + `X-User-Id` oppure `?token=`. Un `<img srcset>` non manda
  header, e copiare un token di condivisione in N URL lo spargerebbe nell'HTML di chi lo usa. Chi
  ha il token si costruisce gli URL da solo, come oggi.
- **Solo stringa, niente array `{width, url}`**: è quello che va dritto in `<img srcset>` /
  `<NuxtImg>`. L'array si ricava con uno `split(', ')`, e lo aggiungo quando un consumer lo chiede
  davvero (ad esempio per scegliere un URL `og:image`).
- **Calcolato al volo, senza colonne DB**: è funzione di `id`, `width` e `isPrivate`, che sono già sulla riga.
- **Dove compare**: in `ImageResponseDto`, cioè ovunque passi da `ImageService.formatImageResponse`
  (`?info=true`, `GET /images`, upload, `PATCH`, Tinify), e negli item immagine degli album
  (`AlbumService.mapAlbumItem`), che sono le gallerie dei siti. **Non nell'admin**: Meridian usa
  thumb e `fullPath`, nessun caso d'uso.

## Coordinamento con il piano 08 (ThumbHash / colore dominante)

Il piano 08 tocca gli stessi punti: `ImageResponseDto`, `formatImageResponse`, la `select` e
`mapAlbumItem` di `album.service.ts`, l'interfaccia `ImageResponse` in
`../docs/integrations/fileharbor.md` e i tipi dell'SDK. I due campi sono indipendenti, ma conviene:

- implementare uno dopo l'altro sullo stesso branch (o fare rebase del secondo), perché i conflitti
  cadrebbero sulle stesse righe del DTO e della `select`;
- rigenerare `types.gen.ts` dell'SDK **una volta sola**, dopo che entrambi sono in `develop`, con un
  solo bump di versione.

## Step

### 1. Helper puro in `src/modules/image/image-variants.ts`

```ts
/** Widths offered in `srcset`: a fixed subset of VARIANT_SIZES, so they share cache slots. */
export const SRCSET_WIDTHS = [320, 640, 960, 1280, 1920] as const;

/**
 * `srcset` for a public image: each fixed width below the original, then the
 * original itself (served from disk, no render, no cache slot).
 */
export function buildSrcset(fullPath: string, originalWidth: number): string {
  return [
    ...SRCSET_WIDTHS.filter((w) => w < originalWidth).map(
      (w) => `${fullPath}?width=${w} ${w}w`,
    ),
    `${fullPath} ${originalWidth}w`,
  ].join(', ');
}
```

Riceve `fullPath` già costruito, così resta una funzione pura e non dipende da `RouteHelperService`.
`Image.width` è `Int` non nullabile (`prisma/schema.prisma`), quindi non serve gestire `null`.

### 2. `ImageResponseDto` (`src/modules/image/dto/image-response.dto.ts`)

Nuovo campo dopo `fullPath`:

```ts
@ApiPropertyOptional({
  description:
    'Ready-made srcset (absolute URLs, WebP q85): 320/640/960/1280/1920w below the original width, then the original. Omitted for private images',
  example: 'https://cdn.example.com/images/b2ce…?width=320 320w, …, https://cdn.example.com/images/b2ce… 2400w',
})
@Expose()
srcset?: string;
```

### 3. `ImageService.formatImageResponse` (`src/modules/image/image.service.ts`)

Calcolare `fullPath` una volta e aggiungere:

```ts
const fullPath = this.route.fullUrl('images', image.id);
// …
fullPath,
srcset: image.isPrivate ? undefined : buildSrcset(fullPath, image.width),
```

Sono coperti in automatico tutti i chiamanti: `getImageMetadata` (`?info=true`), la lista `GET /images`,
l'upload, `updateImageMetadata` e la risposta Tinify.

### 4. Item album (`src/modules/album/album.service.ts`)

- Nella `select` di `image` della lista item (circa riga 569) aggiungere `isPrivate: true`.
- In `mapAlbumItem` riusare `fullPath` e aggiungere
  `srcset: item.image.isPrivate ? undefined : buildSrcset(fullPath, item.image.width)`.

`thumbnailPath` resta com'è.

### 5. SDK `@heyatom/client` (`../heyatom-client/`)

Nessun codice scritto a mano: dopo il merge (e dopo il piano 08, vedi sopra)
`pnpm openapi:dump && pnpm gen:types`. `ImageResponse` in `src/fileharbor/types.gen.ts` riceve
`srcset?: string`. Bump minor e changelog. Gli item album non sono un DTO Swagger tipizzato, quindi
nei tipi generati non compaiono.

## Test

- `image-variants.spec.ts`:
  - ogni valore di `SRCSET_WIDTHS` è presente in `VARIANT_SIZES`;
  - originale 1000 → `…?width=320 320w, …?width=640 640w, …?width=960 960w, <fullPath> 1000w`;
  - originale 1920 → niente `?width=1920`, l'ultima voce è `<fullPath> 1920w`;
  - originale 200 → una sola voce, `<fullPath> 200w`;
  - `fullPath` con prefisso (`https://x/v2/images/id`) → URL `https://x/v2/images/id?width=320`.
- `image.service.spec.ts`: `getImageMetadata` su un'immagine pubblica restituisce `srcset` che
  inizia con `fullPath`; su una privata `srcset` è `undefined`.
- `album.service.spec.ts`: `mapAlbumItem` (attraverso la lista item) espone `srcset` per l'immagine
  pubblica e lo omette per quella privata.

## Doc da aggiornare

- `CLAUDE.md`, sezione "On-demand variants — bounded by design": aggiungere un punto su `srcset`
  (`SRCSET_WIDTHS` fisse, larghezze minori dell'originale più l'originale, assente per le private,
  costruito su `fullPath`).
- `../docs/integrations/fileharbor.md`: `srcset?: string` nell'interfaccia `ImageResponse` (circa
  riga 138), con nota "absolute, public images only", più una riga sotto `GET /images/:imageId`:
  "usate `srcset` invece di costruire `?width=` a mano".

## Fuori scope

- Migrare puma-arts e heyatom-portfolio (`app/utils/img.ts`) a `srcset` dal server: è un passo
  separato per ogni sito, dopo il deploy, e i loro dati arrivano da Articuno/config, non sempre da
  una risposta FileHarbor.
- Array `{ width, url }`, `sizes` suggerito, `srcset` per thumbnail, avatar o video.
- `srcset` con token per le immagini private.
- Admin/Meridian.
- Pre-generare le varianti all'upload: le crea la prima richiesta, come oggi.
