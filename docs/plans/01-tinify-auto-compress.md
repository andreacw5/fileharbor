---
type: plan
service: fileharbor
status: done
estimate: 1d
updated: 2026-10-24
verified: ab856c6
---

# 01 · Compressione Tinify automatica delle immagini grandi

## Problema

Oggi Tinify parte solo a mano: `POST /admin/images/:id/tinify-compress`
(`ImageService.compressImageWithTinify`). Le immagini enormi restano enormi finché un umano non
le apre in Meridian. Vogliamo un job che, per i client che lo scelgono, comprima da solo le
immagini sopra una soglia, senza sforare la quota mensile.

## Limiti Tinify (verificati 2026-10-22)

| Limite | Valore | Fonte |
|---|---|---|
| Dimensione file max (API) | **500 MB** | [help.tinify.com](https://help.tinify.com/help/is-there-a-file-size-limit-for-images), [how it works](https://tinypng.com/developers/how-it-works) |
| Canvas max | **256 MP**, nessun lato > 32000 px | stesse fonti |
| Formati in ingresso | AVIF, JPEG XL, WebP, JPEG, PNG | [API reference](https://tinypng.com/developers/reference) |
| Quota gratuita | 500 compressioni/mese (il nostro default `currentTinifyLimit`) | — |
| Rate limit | non documentato ("generous"), consigliano pause tra richieste | API reference |
| Contatore | header `Compression-Count` = compressioni del mese solare | API reference |

(I limiti 5/75/150 MB che si trovano online sono quelli dell'interfaccia web, non dell'API.)

**Da noi questi limiti non scattano mai**: l'upload è capato a `MAX_FILE_SIZE` (10 MB), Sharp
rifiuta oltre `MAX_INPUT_PIXELS` (100 MP, `storage.service.ts`) e WebP non supera 16383 px per
lato. Il job non ha bisogno di controlli di dimensione lato Tinify; la soglia serve solo a
decidere *cosa vale la pena* comprimere.

## Bug trovato durante l'analisi: `size` stantio dopo l'optimize

Immagini **e** avatar, stesso difetto:

- `ImageCleanupJob.optimizeImage` (`image/jobs/image.cleanup.job.ts`) e
  `AvatarCleanupJob.optimizeAvatar` (`avatar/avatar.cleanup.job.ts`) riscrivono l'originale a
  `OPTIMIZE_QUALITY` (85).
- `ImageService.markAsOptimized` e `AvatarService.markAsOptimized` scrivono solo
  `isOptimized` / `optimizedAt`: `size` resta il WebP q100 dell'upload.

Effetti: `totalStorage` / `newStorage` di `GET admin/stats` (somma di `size`) sovrastimati;
`size` nelle risposte API sbagliato; un filtro `size > soglia` di questo job sceglierebbe
immagini che non sono più grandi. Si sistema nello step 1, **prima** del job.

## Decisioni

- **Opt-in per client, con soglia per client**: nuova colonna `Client.tinifyAutoMinBytes Int?`.
  `null` = auto spento (default, nessun client cambia comportamento al deploy). Una colonna fa
  sia da flag sia da soglia. Richiede comunque `tinifyActive` + `tinifyApiKey`.
  Il job spende quota senza un umano: il consenso deve stare sul client, non su un env globale.
- **Valore consigliato all'attivazione: 1 MB (`1048576`)**. Default colonna resta `null`.
  Dati DB locale (501 immagini, 2026-10-22): p50 25 KB, p90 320 KB, p99 848 KB, max 921 KB.
  Dopo l'optimize a q85 una foto web tipica sta sotto 500 KB: sopra 1 MB c'è un'anomalia da
  comprimere (foto da fotocamera, screenshot enormi), sotto il guadagno per compressione è
  piccolo rispetto alla quota (500/mese). Da rifare la stessa query in prod prima di attivarlo:
  `percentile_disc(array[0.5,0.9,0.99]) within group (order by size)` su `images`.
- **La quota vive nel DB** (`currentTinifyUsage` / `currentTinifyLimit` su `Client`) ed è
  condivisa con l'endpoint manuale: il job non tiene contatori propri, la rilegge e la
  aggiorna a ogni compressione (step 3 e 4).
- **Riuso del metodo manuale**: il job chiama `compressImageWithTinify(id)`. Stessi controlli
  (già compressa, attiva, chiave, quota, animata), stesso webhook, stesso contatore. Niente
  seconda implementazione.
- **Solo dopo l'ottimizzazione Sharp** (`isOptimized = true`): altrimenti l'optimize job
  ricodificherebbe il file appena compresso da Tinify, buttando la compressione.
- **Le più grandi prima** (`orderBy size desc`): con quota limitata, ogni compressione va dove
  risparmia di più.
- **Tentativi limitati**: nuova colonna `Image.tinifyAttempts Int @default(0)`, stesso schema di
  `optimizeAttempts` (`MAX_OPTIMIZE_ATTEMPTS` = 3). Senza, un'immagine animata o un file
  corrotto verrebbe ripreso a ogni run per sempre. Le animate falliscono prima della chiamata
  API, quindi non consumano quota.

## Step

### 1. Fix `size` dopo l'optimize (commit separato, prima del job)

Commit a sé (`fix(storage): keep media size in sync after optimize`): è un bug indipendente
dal job e va rilasciato anche se il job slitta.

**Codice**

- `optimizeImage(image)` / `optimizeAvatar(avatar)` ritornano `optimizedBuffer.length`.
- `markAsOptimized(id, size: number)` in `ImageService` e `AvatarService` scrive anche `size`.
  Parametro obbligatorio: un chiamante nuovo non può dimenticarlo.
- Nei due job: `const size = await this.optimizeX(row); await service.markAsOptimized(row.id, size);`
- Il thumbnail non ha colonna `size`: nulla da fare.
- Tinify aggiorna già `size: compressedSize` (corretto, nessuna modifica).

**Backfill delle righe già ottimizzate**

Script one-off `src/scripts/backfill-media-size.ts`. Sta in `src/`, non in `scripts/`:
l'immagine Docker di prod copia solo `dist/` e `node_modules` prunato (niente ts-node), quindi
deve passare da `nest build`. Niente `AppModule` (avvierebbe cron e metrics server sulla 9091):
istanzia `PrismaService` e `StorageService` direttamente.

- immagini e avatar con `isOptimized = true`, a pagine da 500 per `id` (cursor);
- path con `storage.getImageFilePath` / `getAvatarFilePath`, `domain = client.domain || clientId`;
- `fs.stat(path).size` ≠ `size` → `update`; file mancante → `warn` e avanti;
- dry run di default (tabella `checked / changed / missing / before / after`), `--apply` scrive.
  Idempotente.
- Lancio in prod **dopo** il deploy del fix: lanciato prima, le righe ottimizzate tra lo script
  e il deploy tornerebbero sbagliate e andrebbe rilanciato.

```bash
docker exec <fileharbor-container> node dist/scripts/backfill-media-size.js          # dry run
docker exec <fileharbor-container> node dist/scripts/backfill-media-size.js --apply
```

**Test**

- `image.cleanup.job.spec.ts` / `avatar.cleanup.job.spec.ts`: `markAsOptimized` chiamato con
  la lunghezza del buffer ottimizzato, non con la `size` originale della riga.
- `image.service.spec.ts`: `markAsOptimized` scrive `size`.

**Doc**: riga in `CLAUDE.md` (Scheduled Jobs, "Optimize jobs …"): l'optimize aggiorna `size`.

### 2. Schema

```prisma
model Client {
  tinifyAutoMinBytes Int? // null = auto-compress off; else compress images above this size
}
model Image {
  tinifyAttempts Int @default(0) // failed auto Tinify runs; skipped at MAX_OPTIMIZE_ATTEMPTS
  @@index([clientId, tinifyOptimized, size])
}
```

`pnpm run prisma:migrate` (nome `tinify_auto_compress`).

### 3. Job `TinifyAutoJob.compressLargeImages`

File `src/modules/image/jobs/tinify-auto.job.ts`, registrato in `image.module.ts`.

- `@Cron('30 * * * *')` — ogni ora al minuto 30, sfasato dall'optimize (minuto 0).
- Dentro `prisma.runExclusive('image.tinify_auto', …)`.
- Client candidati: `tinifyActive = true`, `tinifyApiKey` non vuoto,
  `tinifyAutoMinBytes not null`, `currentTinifyUsage < currentTinifyLimit`.
- Per client: `budget = min(TINIFY_AUTO_BATCH, limit - usage)` letto dal DB a inizio client
  (solo per il `take`; il vero controllo è la prenotazione dello step 4); immagini
  `{ clientId, isOptimized: true, tinifyOptimized: false, tinifyAttempts < 3, size > soglia }`,
  `orderBy size desc`, `take budget`.
- Prima della chiamata rileggere la dimensione reale del file: se è già sotto soglia, aggiornare
  `size` e saltare. Rete di sicurezza se il backfill dello step 1 non è ancora girato: nessuna
  quota spesa su un valore stantio.
- Errori:
  - 4xx/5xx di Tinify o errore locale → `tinifyAttempts++`, `warn`, prossima immagine.
  - 401 (chiave non valida) o 429 / quota account esaurita → **stop per quel client** in questo
    run (le altre immagini fallirebbero uguale e brucerebbero i tentativi).
  - `BadRequestException` "limit reached" → stop per quel client.
- Nuovo env `TINIFY_AUTO_BATCH` (Joi, default 20): tetto per client per run. Con 500/mese e
  24 run/giorno la quota finirebbe in poche ore senza tetto; con 20 la si spalma.
- Log finale: `compressed / skipped / failed` per client.

### 4. Correzioni al metodo condiviso

- **Nessun guadagno → non sovrascrivere**: se `compressedSize >= originalSize` tenere il file,
  ma marcare comunque `tinifyOptimized = true` e contare l'uso (Tinify l'ha contata).
- **Prenotare la quota prima della chiamata**, non dopo. Oggi il metodo legge `usage < limit`
  e incrementa a fine compressione: job e endpoint manuale in parallelo possono sforare.
  Diventa un update condizionale atomico prima di `POST /shrink`:
  ```ts
  const { count } = await prisma.client.updateMany({
    where: { id, currentTinifyUsage: { lt: prisma.client.fields.currentTinifyLimit } },
    data: { currentTinifyUsage: { increment: 1 } },
  });
  if (!count) throw new BadRequestException('Monthly Tinify compression limit reached …');
  ```
  Se la chiamata fallisce **prima** che Tinify comprima (rete, 401, 429, 5xx) → decremento
  (rimborso). Se Tinify ha risposto 2xx la compressione è contata da loro: niente rimborso,
  anche se poi fallisce download o salvataggio.
- **Allineare il contatore a `Compression-Count`** (obbligatorio, non più opzionale): a ogni
  risposta Tinify che lo porta, `currentTinifyUsage = max(currentTinifyUsage, header)`. È il
  valore vero del mese per quella chiave: copre compressioni fatte fuori da FileHarbor con la
  stessa chiave e un reset mensile nostro sfasato rispetto al loro mese solare. Con 429 / quota
  esaurita lato account → `currentTinifyUsage = currentTinifyLimit`, così nessun run riprova
  fino al reset del 1° del mese.

### 5. Admin / Meridian

- `AdminUpdateClientDto` + `PATCH /admin/clients/:id`: `tinifyAutoMinBytes` (int ≥ 0 o `null`),
  incluso nella risposta admin. Permesso `fileharbor-config.manage` come il resto della config
  Tinify. L'audit `fh_client.updated` riporta il nome del campo, non il valore (già così).
- Meridian (repo separato): campo nella pagina client accanto a Tinify. Fuori da questo piano,
  basta che l'OpenAPI rigenerato lo esponga.

### 6. Metriche (opzionale)

`fileharbor_tinify_auto_total{result}` (`compressed` | `skipped` | `failed`), pre-inizializzato
a 0. Regola in `monitoring/alerts.yml` solo se serve; un giorno di `failed > 0` senza
`compressed` indica chiave rotta.

### 7. Test e doc

- `tinify-auto.job.spec.ts`: client senza soglia ignorato; ordine per size; budget rispettato;
  401 ferma il client; fallimento incrementa `tinifyAttempts`; file reale sotto soglia → skip
  senza chiamata.
- `image.service.spec.ts`: prenotazione rifiutata a quota piena (nessuna chiamata HTTP);
  rimborso su errore pre-2xx, nessun rimborso dopo 2xx; `Compression-Count` più alto del
  locale lo sovrascrive; 429 porta `usage` a `limit`.
- `CLAUDE.md`: riga nella tabella Scheduled Jobs, env `TINIFY_AUTO_BATCH`.
- `.env.example`, `config.validation.ts`.
- `../docs/integrations/fileharbor.md` solo se il campo client è esposto ai consumer (non lo è:
  è admin-only).

## Dubbi aperti

- `TinifyResetJob` azzera il contatore alle 00:00 del 1° (ora del server). Se Tinify azzera il suo
  mese più tardi, la prima risposta dopo il nostro reset porta ancora il `Compression-Count` del mese
  vecchio e `syncTinifyUsage` lo riscrive: il mese nuovo parte dal conteggio vecchio (bloccato, se
  era al limite) finché Tinify non azzera. Da
  verificare quando e in che fuso azzera Tinify.

## Fuori scope

- Avatar: piccoli per natura (5 MB, ridimensionati). Aggiungere se servono.
- Video: Tinify non li gestisce.
- Retry automatico dei `tinifyAttempts >= 3`: reset manuale via SQL come `optimizeAttempts`.
