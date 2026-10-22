# FileHarbor — Backlog

Aggiornato al 2026-10-22 (§2 rivisto, nuova §2b). Nasce da una revisione multi-agente delle feature possibili (integratori,
ops/sicurezza, console/end-user), passata al vaglio di un revisore critico sul codice, e dalla revisione
dei commit `50ae9c9`, `edf5424`, `c42848a`, `02f658a`.

Contesto che guida le priorità: pochi tenant, un solo sviluppatore, storage su disco locale. Articuno è
l'unico consumer reale dell'API client (Gatherly e Beacon salvano URL, Meridian usa solo l'admin).
**Dal 2026-10:** anche Almanac carica (archivio DeviantArt, immagini + avatar autori) tramite l'SDK
`@heyatom/client`, che ora esiste — due consumer, non più uno.

---

## 0. Prima del prossimo deploy (bloccanti)

I commit su `develop` non sono ancora pushati. Due cambiano il comportamento al boot in base all'env di
prod (`services/fileharbor/config/fileharbor.env` nel repo `server-backup`, gitignored):

- [ ] **Env di prod per 3.3.0** (`fileharbor.env` + `fileharbor.env.example` in `server-backup`):
  - `API_PREFIX=` (vuoto) — da `edf5424` guida `setGlobalPrefix`. nginx toglie già `/v2`
    (`^/v2(.*)$ → $1`): con `v2` l'app servirebbe `/v2/*` e tutto risponderebbe 404, mentre `/health/*`
    (escluso dal prefisso) resta verde.
  - `BASE_URL=https://fileharbor.heyatom.dev/v2` — il prefisso pubblico sta qui. `fullPath` resta uguale a
    oggi; i link dei webhook diventano corretti (oggi senza `/v2`); i campi relativi (`url`,
    `thumbnailUrl`, `shareUrl`, `url` del token album) perdono `/v2` (`/images/<id>`).
  - `TRUST_PROXY_HOPS=1` — obbligatorio con `NODE_ENV=production` (un nginx davanti).
  - `CORS_ORIGIN=<origini>` (o `*`) — da `50ae9c9` obbligatorio con `NODE_ENV=production`, e il
    Dockerfile lo imposta sempre. Senza, il container va in crash-loop.
  - `ADMIN_SECRET` — non più letto: si può togliere.
- [ ] **Migrazioni (a mano, backup del DB prima)** — `20260625203420_mixed_albms` (contiene la data
  migration `album_images` → `album_items`: la prima versione perdeva le righe, vedi
  `scripts/recover-album-items.sql`), `20261008104503_index_cleanup`, `20261014120000_video_size_bigint`.
- [ ] **Spazio disco** — `/health/ready` va giù sotto `HEALTH_DISK_MIN_FREE_MB` (default 1024). Verificare
  lo spazio libero sul volume di prod prima del deploy (vedi anche 1.3).
- [ ] **Cache varianti** — dopo il deploy, svuotare le cartelle `storage/*/images/*/variants/` (sono solo
  cache). I file con i nomi pre-snapping contano nel limite di 20 e, su un'immagine già satura, nessuna
  variante snappata verrebbe più messa in cache: ogni richiesta passerebbe dal semaforo, con rischio 503.
- [x] **Lint** — `album.service.spec.ts:113`, un errore prettier (`pnpm run lint` lo sistema).

## 1. Bug e rifiniture emersi dalla revisione

| # | Cosa | Dove | Effort |
|---|---|---|---|
| 1.1 ✅ | `shareUrl` delle immagini punta a `/images/shared/<token>`, route inesistente (404). Va costruito come `/images/:id?token=…` | `image.service.ts:~999` | XS |
| 1.2 | URL `/v2/images/…` già salvati nei DB dei client restituiscono 404. Serve un rewrite `^/v2/(.*)` → `/$1` in nginx, oppure un `replace()` una tantum sui DB di Articuno e dei siti. Controllare anche `fileharborEndpoint` dei tenant Articuno: se finisce in `/v2`, `isUnderEndpoint` rifiuta i nuovi URL | nginx / Articuno | S |
| 1.3 | Disco quasi pieno → readiness down → stop anche delle letture. Valutare se spostarlo su metrica + alert invece che readiness, o abbassare la soglia | `storage-health.indicator.ts` | S |
| 1.4 ✅ | `CORS_ORIGIN=` (stringa vuota) fa fallire il boot anche in dev; `*` dentro una lista e trailing slash non funzionano | `config.validation.ts:17`, `main.ts:34` | XS |
| 1.5 ✅ | 503 da coda render senza `Retry-After`; il contatore views viene incrementato anche sui 503 | `image.controller.ts:~281` | XS |
| 1.6 ✅ | `BASE_URL` con slash finale genera `//` negli URL | `route.utils.ts:64` | XS |
| 1.7 ✅ | `totalStorage` per singolo client conta ancora solo le immagini (le stats admin ora includono video e avatar) | `client.service.ts:~315` | XS |
| 1.8 ✅ | Errore dell'incremento views video ingoiato in silenzio: allinearlo al `warn` delle immagini | `video.service.ts` | XS |
| 1.9 | Doc obsolete in Meridian: `FILEHARBOR_API_PREFIX=v2`, "setGlobalPrefix never called" | `../../meridian/CLAUDE.md:656,756`, `fileharbor-proxy.ts:21` | XS |
| 1.10 | Race `deleteAvatar` / `uploadAvatar` contemporanei sullo stesso creator → riga con file mancanti (pre-esistente) | `avatar.service.ts` | S |
| 1.11 ✅ | Sweep orfani: un errore su una dir interrompe il resto del dominio per quella notte (pre-esistente) | `storage.cleanup.job.ts` | XS |

## 2. Feature — da fare più avanti

In ordine di valore stimato. Non vanno fatte tutte: ognuna parte quando c'è un caso d'uso concreto.

1. **Bulk ops admin** (delete, tag, privacy, aggiungi ad album) — `POST admin/images/bulk`,
   `admin/videos/bulk`. Oggi Meridian fa un loop di chiamate (`images/index.vue:429`). **S**
   — *parziale*: `POST admin/images/bulk-delete` fatto (`aeb84be`); restano tag/privacy/album e i video.
2. **API key salvata come hash** (sha256 + prefisso visibile). Niente multi-key né rotazione con overlap:
   con un solo consumer basta cambiare l'env. **S**
3. **`fit=cover` + `position`** sulle trasformazioni (oggi sempre `fit: 'inside'`), per le cover
   quadrate di Articuno/Gatherly. **S**
4. **Gestione tag**: rename/merge/delete con conteggi (`tag.controller.ts` ha solo `GET`). **S**
5. **Filtri lista più ricchi** (isPrivate, range di date, `q` su nome+descrizione, stato di
   ottimizzazione/falliti) per l'admin, aggiunti quando servono a Meridian. **S**
   — *parziale*: `isPrivate` fatto (`2ab1eda`), ricerca avatar per username/externalId (`411007e`).
6. **`DELETE admin/creators/:id`** con cascata su file e audit (diritto all'oblio). **S-M**
7. **Alt text / caption** su Image e Video, se Articuno li usa. **XS**
8. **Share link e album token in Meridian**: l'API admin per gli share link esiste già, manca la UI;
   mancano anche gli endpoint per i token album. **S**
9. **Restore di prova** del backup storage + mini runbook (lo script con rotazione è in `server-backup`).
   **S**
10. **Faststart MP4** (`-movflags +faststart`) all'upload, da fare insieme a un altro intervento sui video.
    **XS**

## 2b. Nuove idee (2026-10-22)

Dalla lettura dell'app (schema, controller, consumer). Stessa regola di §2: si parte con un caso d'uso.
Le prime quattro servono ai siti Nuxt (portfolio, puma-arts, sgweb, Articuno) che mostrano immagini.

| # | Feature | Perché / dove | Effort |
|---|---|---|---|
| 2b.1 | **Placeholder: ThumbHash/BlurHash + colore dominante** calcolati all'upload (Sharp ha già i pixel), salvati su `Image` ed esposti in `info` | Blur-up nei siti senza una seconda richiesta; oggi il layout salta finché l'immagine non arriva | S |
| 2b.2 | **`srcset` pronto** nella risposta `info`: lista di URL sulle `VARIANT_SIZES` ≤ larghezza originale | I client oggi costruiscono a mano i `?w=`; con lo snapping ogni URL sarebbe comunque una variante in cache | XS |
| 2b.3 | **Focal point** (`focusX`/`focusY` 0–1 su `Image`, settabile da PATCH e Meridian), usato da `fit=cover` (§2.3) | Senza, `cover` taglia al centro e decapita i ritratti. Va fatto insieme a §2.3 | XS (sopra 2.3) |
| 2b.4 | **`format=auto` / AVIF**: negoziazione su `Accept` (avif → webp → jpeg) con `Vary: Accept`; `avif` aggiunto a `GetImageDto` (oggi `webp`/`jpeg`/`png`) | 20–30% di byte in meno sulle foto. Attenzione: AVIF costa CPU in encoding → passa dal semaforo e conta nel limite di 20 varianti | S |
| 2b.5 | **Throttle per API key** invece che per IP sulle route client autenticate (key = `clientId`, store in memoria come oggi) | Almanac si autolimita a 10/60s (`FILEHARBOR_MIN_INTERVAL_MS`) perché il bucket è per IP: un servizio fidato dietro la stessa rete paga per tutti. Non è lo "store condiviso" scartato in §3 | XS |
| 2b.6 | **Webhook mancanti**: `image.updated` (privacy, descrizione, tag), `video.updated`, item video negli album | Oggi un cambio di `isPrivate` via PATCH (`d7151a5`) non arriva a nessuno | XS |
| 2b.7 | **Riprova ottimizzazione da Meridian**: `POST admin/images/:id/reoptimize` (azzera `optimizeAttempts`) + filtro "falliti" (§2.5) | L'alert `fileharbor_optimize_given_up > 0` oggi si risolve solo in SQL | XS |
| 2b.8 | **Rigenera thumbnail/varianti** (`POST admin/images/:id/regenerate`, svuota `variants/`) | Dopo un cambio di `THUMBNAIL_SIZE`/qualità, o un thumb corrotto; oggi l'unica via è cancellare e ricaricare (id nuovo, URL rotti) | S |
| 2b.9 | **Poster video a scelta**: `?t=<sec>` sul thumbnail all'upload o `PATCH admin/videos/:id/poster` | Il frame fisso iniziale è spesso nero/dissolvenza | S |
| 2b.10 | **Metadati EXIF utili conservati prima dello strip** (data scatto, fotocamera, obiettivo) in colonne/JSON su `Image`; GPS mai | Gallerie di portfolio e puma-arts ordinano per data di scatto, non di upload | S |
| 2b.11 | **Metrica `fileharbor_storage_bytes{client}`** (gauge lazy come il backlog di ottimizzazione) + alert di crescita | Il disco locale è il vincolo vero (§1.3): sapere *chi* lo riempie prima che la readiness cada | XS |
| 2b.12 | **Download ZIP di un album** (`GET /albums/:id/zip`, stream con `archiver`, stessi controlli di accesso/token) | Consegna a cliente di un set (puma-arts). Solo se arriva la richiesta: nuova dipendenza | M |

Escluse di proposito: upload da URL lato server (SSRF; Almanac scarica già da sé), signed URL stateless
(gli share link coprono il caso), gestione `AdminPrincipal` via API (scelta di sicurezza, vedi CLAUDE.md).

## 3. Scartate (per ora)

Motivo comune: nessun consumer oggi. Si riconsiderano se cambia il contesto.

- Storage S3/R2 pluggable · Pipeline video HLS/transcoding · ~~SDK TypeScript~~ (fatto: `@heyatom/client`)
- Webhook HTTP firmati con retry (nessun ricevitore oltre Discord) · Upload diretto da browser
- Dedup sha256 / integrity scrub · Moderazione / ClamAV (tutti gli uploader sono servizi fidati)
- Soft delete / cestino (c'è il backup) · Quote per client (un solo owner)
- Rate limit per client con store condiviso (sostituito da snapping + semaforo) · Idempotency-Key / replace atomico
- `/me` oltre l'avatar, export GDPR self-service · Analytics per client/creator · Riordino album

## 4. Fatto (2026-10-14)

- `50ae9c9` — snapping delle varianti + semaforo sui render (fix CPU-DoS), readiness disco, check ffmpeg al
  boot, `CORS_ORIGIN` validato, `monitoring/alerts.yml`.
- `edf5424` — `API_PREFIX` unica fonte di verità per route servite e URL restituiti; doc allineate.
- `c42848a` — sweep orfani video, delete row-first, `Video.size` BigInt, views video senza bump di
  `updatedAt`, stats con byte di video e avatar.
- `02f658a` — stream video `Cache-Control: private` (c42848a l'aveva `public`: non rilasciarli separati).
- Backup storage: script con rotazione (ultimo + 2) in `server-backup/services/fileharbor/backup_images.sh`.
  Il backup del DB esiste già ed è testato.
