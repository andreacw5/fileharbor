---
type: plan
service: fileharbor
status: open
estimate: 2d
updated: 2026-10-22
verified: 4774bd3
---

# 03 · Immagini duplicate (FX4)

Backlog Meridian: FX4 (`meridian/docs/BACKLOG.md`).

## Perché

La libreria cresce senza controllo: la stessa immagine caricata due volte (re-upload da un'app client,
un archivio Almanac rifatto, un upload a mano dalla console) occupa disco e confonde le liste. Oggi non
c'è modo di trovarle: nessuna colonna di hash, nessuna query.

## Stato attuale

- `Image` (`prisma/schema.prisma:87-123`): nessun hash. Indici `(clientId, createdAt)`, `(creatorId)`,
  `(isOptimized, createdAt)`.
- Upload (`image/image.service.ts:89-200`): l'input (`file.buffer`) viene ricodificato in WebP a
  `ORIGINAL_QUALITY` e **non** si conserva; su disco resta solo `original.webp` + `thumb.webp`.
- I byte salvati cambiano dopo l'upload:
  - optimize job → riscrive a `OPTIMIZE_QUALITY` (`image/jobs/image.cleanup.job.ts:51`,
    `markAsOptimized`);
  - Tinify → riscrive e aggiorna `size` (`image/image.service.ts:1385-1392`).
- Precedente di backfill: `src/scripts/backfill-media-size.ts` (dry-run di default, `--apply`, gira in
  container come `node dist/scripts/...`).
- Bulk-delete esistente: `POST /admin/images/bulk-delete` (`admin/controllers/images-admin.controller.ts:333-376`),
  `fileharbor-media.moderate`, max 100 id, `{ deleted, failed[] }`.
- Lista admin `GET /admin/images` (`images-admin.controller.ts:161-256`): filtri `clientId`, `creatorId`,
  `albumId`, `name`, `tags`, `isPrivate`, sort, busta `{ data, pagination }`.
- Scope: `admin.allowedClientIds`; un tenant mappa al massimo un client (`bastionTenantSlug @unique`),
  più gli eventuali client personali; `fullAccess` vede tutti i client non personali altrui
  (`admin/helpers/admin-access.helper.ts`).

## Cosa

### Scelta dell'hash

| Opzione | Pro | Contro | Esito |
|---|---|---|---|
| sha256 dei byte salvati | esatto, banale | cambia dopo optimize e Tinify: due copie identiche, una ottimizzata, non combaciano | no |
| sha256 dell'input all'upload | esatto e stabile | l'input non è conservato → **niente backfill** sulle immagini esistenti | no |
| **dHash 64 bit** sul `original.webp` decodificato | stabile a ricodifica, optimize, Tinify e resize; calcolabile sull'esistente; Sharp già installato | collisioni su immagini piatte; non è "stesso byte" | **sì** |
| pHash (DCT) | più robusto a ritocchi | più codice, nessun guadagno per "stesso contenuto" | no |

"Duplicato" = stesso dHash (distanza di Hamming 0). I quasi-duplicati (distanza ≤ N) sono fuori dal
piano.

### Lato FileHarbor

1. **Schema**: `Image.dHash BigInt?` + `@@index([dHash])`. Nullable: le righe vecchie restano `null`
   finché il backfill non passa. Un solo indice: il filtro per hash è selettivissimo, il raggruppamento
   è comunque una scansione dello scope.
2. **Calcolo**: `StorageService.computeDHash(buffer): Promise<bigint>` — Sharp
   `grayscale().resize(9, 8, { fit: 'fill' }).raw()`, 64 confronti pixel-a-destra. Animati: primo frame
   (default Sharp). Spec con due codifiche della stessa immagine (q100 vs q85) → stesso hash; due
   immagini diverse → hash diversi.
3. **Upload**: `uploadImage` calcola il dHash su `webpBuffer` (lo stesso input del backfill) e lo salva
   nella `create`. Un errore di calcolo non fa fallire l'upload: `warn` e `dHash: null`.
4. **Backfill**: `src/scripts/backfill-image-dhash.ts`, stesso stile di `backfill-media-size.ts`: dry-run
   di default, `--apply`, lotti da 200 per `createdAt`, una immagine alla volta (CPU), riprendibile
   (`WHERE dHash IS NULL`), file mancante o illeggibile = log e avanti.
5. **Query**:
   - `GET /admin/images/duplicates` — gruppi. SQL raw su `images` filtrato da `clientId = ANY(allowed)`,
     `dHash IS NOT NULL AND dHash <> 0` (lo 0 è l'hash di un'immagine piatta: rumore), `GROUP BY` sulla
     chiave, `HAVING count(*) > 1`, ordine `count desc, bytes desc`. Chiave: `(clientId, dHash)` di
     default; `dHash` da solo con `crossClient=true`, ammesso **solo** a un principal `fullAccess`
     (403 altrimenti). Per gruppo: `count`, `totalBytes`, fino a 6 anteprime (`id`, `clientId`,
     `originalName`, `width`, `height`, `size`, `createdAt`, `isPrivate`, `creator.externalId`).
   - `GET /admin/images?dHash=<hex>`: nuovo filtro sulla lista esistente, così il dettaglio di un gruppo
     è la lista immagini con tutto quello che già fa (sort, selezione, bulk-delete).
   - `dHash` (hex 16 caratteri) esposto su `AdminImageResponseDto` e sulla riga lista, più
     `duplicates: number` sulla show (count stesso hash in scope, sé esclusa, `0` se `dHash` è null).
   - `@Get('duplicates')` va dichiarato **prima** di `@Get(':id')` nel controller.
6. Nessuna azione nuova: il "che fare" è il bulk-delete che esiste.

### Lato Meridian

1. Tipi: `dHash?`, `duplicates?` su immagine; `FileHarborDuplicateGroup`; il gruppo usa
   `FileHarborMetaPage<T>`.
2. BFF: `server/api/[tenant]/fileharbor/images/duplicates.get.ts` (inoltra `clientId`, `creatorId`,
   `crossClient`, `page`, `limit`); `images/index.get.ts` inoltra anche `dHash`. Le regole
   `/fileharbor/images/**` (`media.manage`) e `bulk-delete` (`moderate`) di `API_POLICY` coprono già
   tutto; Nitro preferisce la route statica a `[id].get.ts`.
3. Pagina `app/pages/[tenant]/fileharbor/images/duplicates.vue` (link dall'header della lista
   immagini, `PAGE_POLICY` `/fileharbor/images/**` già copre): un gruppo per riga in `.panel` con le
   anteprime (`useFileHarborImageSrc`, private comprese), `count`, spazio recuperabile
   (`totalBytes - size del più vecchio`), link "Apri" → `/fileharbor/images?dHash=<hex>&clientId=<id>`.
   Filtro client (+ "Fra client" solo se l'utente è `fullAccess`: il BFF non lo sa, quindi il toggle
   appare e un 403 lo spiega — vedi domande). Liste = URL, `ShellCardPager`, `loaded`.
4. Lista immagini: `?dHash=` letto dall'URL e mostrato come chip rimovibile (stesso pattern di
   `?error` su Herald); da lì selezione + bulk-delete (solo con `media.moderate`).
5. Show immagine: `ShellFact` "Duplicati" con link alla lista filtrata quando `duplicates > 0`.
6. i18n `fileharbor.duplicates.*` it/en.

## Contratto API

| Metodo | Path | Query | Risposta | Permesso |
|---|---|---|---|---|
| `GET` | `/admin/images/duplicates` | `clientId?`, `creatorId?`, `crossClient?=false`, `page`, `limit` (≤ 50) | **`{ data, meta }`** (nest-common `paginate`, come `/admin/tags`) | `media.manage` |
| `GET` | `/admin/images` | + `dHash?` (hex 16) | `{ data, pagination }` invariata | `media.manage` |
| `GET` | `/admin/images/:id` | — | + `dHash: string \| null`, `duplicates: number` | `media.manage` |

```ts
interface DuplicateGroup {
  dHash: string;              // hex, 16 caratteri
  clientId: string | null;    // null solo con crossClient=true
  count: number;
  totalBytes: number;
  images: DuplicateImage[];   // max 6, più vecchia prima
}
```

`dHash` malformato → `400 VALIDATION_FAILED`; `crossClient=true` senza `fullAccess` → `403`.

## Sicurezza/permessi

- **Mai fuori scope**: ogni query parte da `clientId = ANY(allowedClientIds)`. Né un conteggio né un
  gruppo dice "esiste una copia in un client che non vedi".
- `crossClient` solo `fullAccess`. Per gli altri, anche fra i propri client (tenant + personali) la
  chiave resta `(clientId, dHash)`: regola semplice, nessun incrocio tenant/personale.
- `creatorId` filtra, non allarga.
- L'hash di per sé non è un segreto ma non va nella superficie client (`X-API-Key`): resta admin.
- Cancellare = `fileharbor-media.moderate` via bulk-delete esistente. Niente auto-delete, mai: un dHash
  uguale è "quasi certamente identico", non "identico".

## Ordine di deploy

1. FileHarbor: migration (colonna nullable + indice; tabella `images` piccola, `CREATE INDEX` in
   transazione accettabile — se cresce, `CONCURRENTLY` a mano), codice.
2. Backfill in dry-run, poi `--apply` fuori orario.
3. Meridian. Contro un FileHarbor vecchio `duplicates` risponde 404 (la pagina mostra l'errore), ma
   ⚠️ `?dHash=` viene **ignorato** in silenzio: `listImages` legge i parametri uno per uno con
   `@Query('…')` (`images-admin.controller.ts:198-210`), niente DTO con `forbidNonWhitelisted`. La lista
   "filtrata" sarebbe la libreria intera, con la bulk bar di delete sopra. Per questo la lista, con
   `?dHash=` attivo, scarta le righe il cui `dHash` non coincide e nasconde la bulk bar se il campo
   manca dalla risposta.

## Rischi/domande aperte

1. **Volume**: quante immagini ci sono in produzione? Il backfill costa una decodifica per immagine
   (stima 20-100 ms, fino a 100 MP); oltre ~50k serve un job orario a lotti invece dello script.
2. **Falsi positivi** oltre lo 0 (immagini quasi piatte, screenshot dello stesso layout): basta la
   revisione visiva o serve anche `width/height` uguali nella chiave?
3. **`fullAccess` in Meridian**: il BFF non lo conosce (non è nel JWT). Esporlo da FileHarbor (es.
   `GET /admin/me`) o lasciare il toggle con il 403 esplicativo?

## Criteri di completamento

- [ ] Spec `computeDHash`: stessa immagine a q100/q85 e ridimensionata → stesso hash; immagini diverse →
      hash diversi; PNG piatto → 0.
- [ ] Upload nuovo → `dHash` valorizzato; errore di calcolo non fa fallire l'upload.
- [ ] Backfill dry-run stampa conteggi senza scrivere; `--apply` porta a zero le righe `dHash IS NULL`
      leggibili; rilanciato non rifà nulla.
- [ ] Caricando due volte lo stesso file sullo stesso client, `GET /admin/images/duplicates` mostra un
      gruppo da 2; la stessa immagine su un client fuori scope non compare né cambia `count`.
- [ ] `crossClient=true` da non-`fullAccess` → 403.
- [ ] `GET /admin/images/duplicates` risponde `{ data, meta }`.
- [ ] Meridian: dalla pagina duplicati apro il gruppo, seleziono la copia più nuova e la cancello col
      bulk-delete; il gruppo sparisce. Un AUTHOR vede la pagina ma non la bulk bar di delete.
