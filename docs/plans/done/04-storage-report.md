---
type: plan
service: fileharbor
status: done
estimate: 2d
updated: 2026-10-29
verified: 636ff71
---

# 04 · Report storage per client e creator nel tempo (FX5)

Backlog Meridian: FX5 (`meridian/docs/BACKLOG.md`).

## Perché

Serve sapere chi occupa spazio e come cresce: quale client, quale creator, immagini o video. Oggi la
console dà un numero solo, senza storia né ripartizione, e la tile storage della dashboard è l'unica
senza sparkline.

## Stato attuale

**La premessa del backlog è superata**: da `c42848a` (2026-10-14) FileHarbor somma già immagini,
video e avatar.

- `StatisticsService.getGlobalStats` (`statistics/statistics.service.ts:59-64`, `:85-86`, `:120-124`):
  `totalStorage` e `last7Days.newStorage` = somma `size` di `images` + `videos` + `avatars` nello
  scope. Nessuna ripartizione per tipo nella risposta.
- `ClientService.storageByClient` (`client/client.service.ts:318-352`): stesso calcolo per client,
  usato da `GET /admin/clients[/:id]` → `totalStorage` per client.
- `dailyChart` (`statistics.service.ts:136-176`) conta **solo elementi** per giorno, niente byte: da qui
  il commento in Meridian "Storage has no daily series"
  (`app/pages/[tenant]/fileharbor/index.vue:60-61`).
- Nessuna storia: tutto è calcolato al momento sulle righe vive. Un delete o un optimize cambiano il
  passato.
- `size` è il solo originale: `thumb.webp`, le varianti in cache (fino a `MAX_CACHED_VARIANTS` = 20 per
  immagine, `image/image.service.ts:45`) e le thumbnail video non sono contate. `Image.size`/`Avatar.size`
  `Int`, `Video.size` `BigInt` (`prisma/schema.prisma:96`, `:164`, `:224`).
- Per creator non esiste nessun aggregato di byte.

Meridian, documentazione stantia (da correggere in questo piano):

- `meridian/CLAUDE.md`, sezione FileHarbor: "`totalStorage` somma **solo** i byte delle immagini".
- `app/types/fileharbor.ts:150`: commento "Sum of image sizes".
- `docs/BACKLOG.md` FX5: "`totalStorage` somma solo le immagini".

## Cosa

### Snapshot vs on-demand

| Opzione | Storia vera | Costo | Esito |
|---|---|---|---|
| Ricostruire dal `createdAt` delle righe vive | no: delete e optimize riscrivono il passato | zero schema | no |
| Walk del disco | sì (byte reali, varianti comprese) | I/O su tutto lo storage ogni giorno | no |
| **Snapshot giornaliero da DB** per client e tipo | sì, da oggi in avanti | 3 `groupBy`/giorno, righe = client × 3 | **sì** |
| Snapshot anche per creator | sì | righe = creator × 3 al giorno | no: per creator basta il presente |

Storia solo per client; per creator solo il valore corrente, on-demand. La serie parte dal giorno del
deploy: niente ricostruzione stimata.

### Lato FileHarbor

1. **Schema**: `StorageSnapshot { day Date @db.Date, clientId, kind MediaKind (IMAGE|VIDEO|AVATAR),
   count Int, bytes BigInt, createdAt }`, `@@unique([day, clientId, kind])`, `@@index([clientId, day])`,
   FK `clientId` `onDelete: Cascade`. Nessuna retention (poche decine di righe al giorno).
2. **Job** `StorageSnapshotJob` nel modulo `statistics`, `@Cron('30 0 * * *')` dentro
   `prisma.runExclusive('stats.storage_snapshot')`: tre `groupBy({ by: ['clientId'], _count, _sum: { size } })`
   senza filtro di scope (tutti i client), `upsert` per `(oggi UTC, clientId, kind)`. Idempotente:
   rilanciato lo stesso giorno sovrascrive. Un client senza righe di un tipo → riga a 0, così la serie
   non ha buchi. Estrarre il calcolo da `storageByClient` in un helper condiviso (stessa query, oggi
   duplicata fra `client.service.ts` e `statistics.service.ts`).
3. **Seed**: al primo avvio dopo il deploy il job gira subito una volta (o script
   `src/scripts/storage-snapshot.ts`), così il giorno 0 esiste.
4. **`GET /admin/stats` arricchito** (stessa risposta, campi in più):
   - `storageByKind: { images, videos, avatars }` (byte, scope del chiamante);
   - `dailyChart[].storage`: byte totali dello scope a fine giorno, dagli snapshot; `null` nei giorni
     prima del primo snapshot.
5. **`GET /admin/stats/storage`** — report: `from`/`to` (giorni, max 366), `clientId?`. Serie per giorno
   e tipo dagli snapshot (somma sui client in scope), più `byClient` corrente (count e byte per tipo).
6. **`GET /admin/stats/storage/creators`** — classifica corrente per creator: `groupBy creatorId` sulle
   tre tabelle nello scope (`clientId?` per restringere), ordinata per byte totali, paginata.
7. Spec: job (idempotenza, client senza video = 0), scope delle due route (client fuori scope → 403
   su `clientId`, mai nei totali).

### Lato Meridian

1. Tipi: `storageByKind`, `dailyChart[].storage` (opzionali: contro un FileHarbor vecchio mancano),
   `FileHarborStorageReport`, `FileHarborCreatorStorage`; la classifica usa `FileHarborMetaPage<T>`.
2. **Dashboard FileHarbor** (`app/pages/[tenant]/fileharbor/index.vue`): la tile storage riceve
   `:sparkline` da `dailyChart[].storage` (filtrando i `null`; sotto due punti niente sparkline) e
   diventa un link al report. Via il commento "no daily series".
3. **Pagina** `/fileharbor/storage` (voce nav "Storage", sezione `structure`): tre `GatherlyStatTile`
   (immagini, video, avatar) con valore attuale, delta sul periodo e `GatherlyMiniChart` della serie; periodo
   30/90/365 giorni + filtro client in URL (`useQueryState`); tabella per client (`.panel--flush`,
   link alla show client se `canPage`); tabella creator con `ShellTablePager`, link alla show creator.
   Una nota sotto il titolo: "byte degli originali, senza thumbnail e varianti in cache".
4. BFF: `server/api/[tenant]/fileharbor/stats/storage.get.ts` e `stats/storage/creators.get.ts`
   (`fileharborAdmin`, `qs()` per `from`/`to`/`clientId`/`page`/`limit`).
5. `API_POLICY`: `['GET', '/fileharbor/stats/storage/creators', 'fileharbor-library.manage']` **prima**
   di `['GET', '/fileharbor/stats/**', 'fileharbor-media.manage']` (oggi c'è solo `/fileharbor/stats`
   esatto). `PAGE_POLICY`: `['/fileharbor/storage', 'fileharbor-media.manage']`; la tabella creator
   sparisce senza `library.manage` (nascondere, non disabilitare).
6. Correggere la documentazione stantia elencata sopra; i18n `fileharbor.storage.*` it/en.

## Contratto API

| Metodo | Path | Query | Risposta | Permesso |
|---|---|---|---|---|
| `GET` | `/admin/stats` | — | oggetto nudo, come oggi, + `storageByKind`, `dailyChart[].storage` | `media.manage` |
| `GET` | `/admin/stats/storage` | `from`, `to` (YYYY-MM-DD, max 366 gg), `clientId?` | **oggetto nudo** (non è una lista: niente busta di paginazione, come `/admin/stats`) | `media.manage` |
| `GET` | `/admin/stats/storage/creators` | `clientId?`, `page`, `limit` (≤ 100) | **`{ data, meta }`** (nest-common `paginate`) | `library.manage` |

```ts
interface StorageReport {
  from: string; to: string;
  firstSnapshot: string | null;          // il giorno da cui la serie è vera
  series: { date: string; images: number | null; videos: number | null; avatars: number | null }[];
  byClient: { clientId: string; name: string;
              images: { count: number; bytes: number };
              videos: { count: number; bytes: number };
              avatars: { count: number; bytes: number } }[];
}
interface CreatorStorage {
  creatorId: string; externalId: string; username: string | null; clientId: string;
  images: number; videos: number; avatars: number;   // byte
  totalBytes: number; itemCount: number;
}
```

Byte come `number` (esatto fino a 8 PiB, stessa scelta di `sumBytes`). `to < from` o oltre 366 gg →
`400 VALIDATION_FAILED`; `clientId` fuori scope → `403`.

## Sicurezza/permessi

- Ogni lettura filtra `clientId = ANY(allowedClientIds)` (`buildClientWhere`); il job scrive tutti i
  client ma la lettura è sempre scoped, client personali altrui compresi.
- Serie e per-client sotto `media.manage`, come `/admin/stats`: sono gli stessi numeri ripartiti.
- Per creator sotto `library.manage`: la lista creator della console è già lì.
- Nessun nuovo audit: sono letture.

## Ordine di deploy

1. FileHarbor: migration, job, route. Il job crea il giorno 0 al primo avvio.
2. Meridian. Contro un FileHarbor vecchio la tile resta senza sparkline (campi opzionali) e la pagina
   storage mostra l'errore 404; niente si rompe.
3. La sparkline compare dal secondo giorno, il report a 30 gg è pieno dopo un mese.

## Rischi/domande aperte

1. **Disco reale vs originali**: thumbnail e varianti possono pesare quanto gli originali. Basta il
   numero dal DB (economico, coerente con `totalStorage`) o serve un walk mensile del disco per client?
2. **Storia per creator**: il piano dà solo il presente. Serve la crescita per creator (righe = creator
   × 3 al giorno)?
3. **Fuso**: snapshot a mezzanotte UTC, come `dailyChart`. Va bene per una console italiana?

## Implementazione (2026-10-22)

Fatto come da piano, con queste scelte:

- `day` = giorno UTC in cui lo snapshot è preso (00:30): lo stato a inizio giornata. Al boot il job gira
  se oggi non ha righe (fire-and-forget, `runExclusive`), quindi il giorno 0 arriva col deploy; nessuno
  script a parte.
- `from`/`to` opzionali: default ultimi 30 giorni. Range rovesciato, oltre 366 gg o data impossibile
  (`2026-02-31`) → `400 VALIDATION_FAILED`.
- Serie: un giorno con almeno una riga nello scope conta 0 i tipi mancanti, uno senza righe è `null`.
- Meridian: le tile del report mostrano il valore **live** (da `byClient`), sparkline e delta dagli
  snapshot; la tabella creator non c'è proprio senza `library.manage`.
- Domande aperte: risposte di default (numero dal DB, niente storia per creator, UTC). Da rivedere se serve.

Da verificare dopo il deploy (sotto): niente test E2E con Bastion, la UI Meridian non è stata provata
nel browser.

## Criteri di completamento

- [x] Dopo il deploy esiste una riga `storage_snapshots` per ogni client × 3 tipi con la data di oggi;
      rilanciare il job non duplica.
- [x] `sum(bytes)` dello snapshot di oggi per un client = `totalStorage` di `GET /admin/clients/:id`.
- [x] `GET /admin/stats` ha `storageByKind` con somma = `totalStorage`, e `dailyChart[].storage`.
- [x] `GET /admin/stats/storage?from&to` restituisce `series` lunga quanto il range, `null` prima di
      `firstSnapshot`; range > 366 gg → 400; `clientId` fuori scope → 403.
- [x] `GET /admin/stats/storage/creators` risponde `{ data, meta }`, ordinata per `totalBytes` desc,
      solo creator in scope; un AUTHOR prende 403 (FileHarbor e BFF).
- [x] Meridian: la tile storage della dashboard ha la sparkline dopo due snapshot e porta al report; il
      report mostra immagini/video/avatar separati; un AUTHOR non vede la tabella creator.
- [x] Documentazione stantia corretta (`meridian/CLAUDE.md`, `app/types/fileharbor.ts:150`, FX5 nel
      backlog); `node --test test/i18n-parity.test.ts` verde.

Verificato in prod il 2026-10-29: tutto funziona.
