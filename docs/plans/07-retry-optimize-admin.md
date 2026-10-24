---
type: plan
service: fileharbor
status: done
estimate: 0.5d
updated: 2026-10-24
verified: 4774bd3
---

# 07 · Riprova ottimizzazione da Meridian

Backlog 2b.7, con il pezzo "stato di ottimizzazione/falliti" di §2.5.

## Problema

Gli optimize job (`ImageCleanupJob.optimizeImages`, `AvatarCleanupJob.optimizeAvatars`) incrementano
`optimizeAttempts` a ogni fallimento (`recordOptimizeFailure` in `ImageService` / `AvatarService`) e
smettono di riprendere la riga a `MAX_OPTIMIZE_ATTEMPTS` (3, `storage.service.ts`). Quelle righe
finiscono in `fileharbor_optimize_given_up{kind}` e tengono acceso `FileHarborOptimizeGivenUp`
(`monitoring/alerts.yml`), che per costruzione non si spegne da solo.

Oggi l'unica uscita è SQL (`UPDATE images SET "optimizeAttempts" = 0 …`), il cancellamento o, per gli
avatar, un nuovo upload. Dalla console non si vede nemmeno *quali* righe sono ferme: le liste admin non
filtrano per stato di ottimizzazione e `AdminImageResponseDto` / `AdminAvatarResponseDto` non espongono
`optimizeAttempts`.

## Decisioni

- **Rimettere in coda, non ottimizzare subito.** L'endpoint azzera `optimizeAttempts` e basta: la riga
  rientra in `OPTIMIZE_RETRYABLE_WHERE` e la prende il job dell'ora successiva (ordina per `createdAt asc`,
  quindi una riga vecchia passa davanti al resto della coda). Motivi:
  - nessuna seconda implementazione: `optimizeImage` / `optimizeAvatar` sono metodi privati dei job;
    ottimizzare nella request vorrebbe dire estrarli in un service e duplicare la gestione degli errori;
  - nessuna corsa col cron: il job gira sotto `prisma.runExclusive('image.optimize', …)`, una request no.
    Due re-encode concorrenti dello stesso `original.webp` sono il caso da evitare;
  - Sharp sincrono in una request admin non passa dal semaforo di `resizeImage`: un bulk diventerebbe
    CPU non limitata sul processo che serve anche le immagini pubbliche;
  - il costo è solo l'attesa (≤ 1 h). Per un'operazione di manutenzione dopo un alert `info` va bene.
    Se il file è davvero rotto torna "fallito" dopo altre 3 ore e l'alert si riaccende: è il comportamento
    giusto, l'admin allora lo cancella.
- **Stessa operazione per singolo e bulk, una sola query.** `updateMany` con il where giusto: per id, o
  `OPTIMIZE_GIVEN_UP_WHERE` + scope client. Niente loop, niente transazioni.
- **Il bulk entra ora**: il caso reale è "una versione di Sharp/libvips ha rotto 200 file, aggiornata la
  dipendenza li voglio riprovare tutti". Uno per uno da Meridian non è praticabile. Costa ~15 righe.
  `clientId` opzionale: assente = tutti i client che l'admin vede (`buildClientWhere`), che è esattamente
  il perimetro dell'alert.
- **Avatar inclusi**, simmetrici alle immagini: stesso meccanismo, stessa metrica con `kind="avatar"`,
  stesso alert. Il re-upload dell'utente resta un'altra via d'uscita, non l'unica.
- **Permesso `fileharbor-media.manage`** (quello di classe di `ImagesAdminController` e
  `AvatarsAdminController`, nessun decorator in più). È manutenzione del media, non moderazione
  (`fileharbor-media.moderate` = cancellare) né configurazione del client (`fileharbor-config.manage`).
  Nessuna chiave nuova in `console-permissions.ts`, quindi niente da allineare in Bastion/Meridian lato seed.
- **Solo righe non ottimizzate.** Un'immagine già ottimizzata non si "ri-ottimizza": ri-codificare a q85
  un file già a q85 perde qualità a ogni giro. Rigenerare thumbnail/varianti è il piano 06, non questo.
  Singolo su riga già ottimizzata → `409 ALREADY_OPTIMIZED`; si può azzerare anche una riga con 1–2
  tentativi falliti (non serve aspettare il terzo).
- **Filtro `optimizeStatus`** sulle liste admin: `optimized` | `pending` | `failed`, mappati sulle
  costanti esistenti (`{ isOptimized: true }`, `OPTIMIZE_RETRYABLE_WHERE`, `OPTIMIZE_GIVEN_UP_WHERE`).
  Le stesse costanti della metrica: lista e alert non possono contare cose diverse.
  Nessun indice nuovo: il filtro si combina con `clientId` (`@@index([clientId, createdAt])`) e le righe
  non ottimizzate sono poche per costruzione.
- **Audit**: `fh_image.reoptimize_queued` / `fh_avatar.reoptimize_queued` (due segmenti, underscore nel
  secondo come `fh_album.items_added`). Metadata: id, oppure `clientId` + `count` per il bulk.

## Step

### 1. Service: un metodo per tipo

`src/modules/image/image.service.ts`, accanto a `recordOptimizeFailure`:

```ts
/**
 * Put unoptimized rows back in the optimize queue. Already optimized rows are
 * never matched: re-encoding an optimized original only loses quality.
 */
async resetOptimizeAttempts(where: Prisma.ImageWhereInput): Promise<number> {
  const { count } = await this.prisma.image.updateMany({
    where: { ...where, isOptimized: false },
    data: { optimizeAttempts: 0 },
  });
  return count;
}
```

Stesso metodo in `src/modules/avatar/avatar.service.ts` su `prisma.avatar`.

Aggiornare il commento di `MAX_OPTIMIZE_ATTEMPTS` / `OPTIMIZE_GIVEN_UP_WHERE` in `storage.service.ts`
("only a manual reset retries them" → citare anche l'endpoint) e la help string di
`fileharbor_optimize_given_up` in `metrics/fileharbor-metrics.service.ts` ("need a manual
optimizeAttempts reset" → "… reset via POST admin/{images,avatars}/:id/reoptimize").

### 2. Filtro `optimizeStatus`

`src/modules/admin/helpers/admin-query.helper.ts`, accanto a `parseBooleanQuery`:

```ts
const OPTIMIZE_STATUS_WHERE = {
  optimized: { isOptimized: true },
  pending: OPTIMIZE_RETRYABLE_WHERE,
  failed: OPTIMIZE_GIVEN_UP_WHERE,
} as const;

/** Absent or empty → no filter; an unknown value is a 400, like parseBooleanQuery. */
export function parseOptimizeStatusQuery(value?: string) {
  if (value === undefined || value === '') return undefined;
  const where = OPTIMIZE_STATUS_WHERE[value as keyof typeof OPTIMIZE_STATUS_WHERE];
  if (!where) throw new BadRequestException('optimizeStatus must be optimized, pending or failed');
  return where;
}
```

- `ImagesAdminController.listImages`: `@Query('optimizeStatus')` + `@ApiQuery({ enum: [...] })`, poi
  `Object.assign(where, parseOptimizeStatusQuery(optimizeStatus))` dopo `buildClientWhere` (le chiavi
  `isOptimized` / `optimizeAttempts` non collidono con gli altri filtri).
- `AvatarsAdminController.listAvatars`: idem.

### 3. Esporre `optimizeAttempts`

`src/modules/admin/dto/admin-response.dto.ts`: `@ApiProperty() @Expose() optimizeAttempts: number;` in
`AdminImageResponseDto` e `AdminAvatarResponseDto`. I list item (`AdminImageListItemDto`,
`AdminAvatarListItemDto`) lo ereditano via `OmitType`. Le liste restituiscono già la riga grezza
(`findAdminImages` / `findAdminAvatars` usano `include`), quindi il campo è già nel JSON: qui si
documenta in Swagger e lo si fa passare nel dettaglio (`plainToInstance` con `excludeExtraneousValues`).
Serve a Meridian per il badge "fallito" nel dettaglio (`!isOptimized && optimizeAttempts >= 3`).

### 4. Endpoint singolo

`ImagesAdminController` (`src/modules/admin/controllers/images-admin.controller.ts`):

```ts
@Post(':id/reoptimize')
@HttpCode(204)
@ApiOperation({ summary: 'Put an unoptimized image back in the optimize queue (picked up within the hour)' })
@ApiResponse({ status: 204 })
@ApiResponse({ status: 404, description: 'Image not found' })
@ApiResponse({ status: 409, description: 'Image already optimized' })
@Audit('fh_image.reoptimize_queued', {
  metadata: (_r: unknown, req: AuditRequest) => ({ imageId: req.params.id }),
})
async reoptimizeImage(@Param('id') id: string, @CurrentAdminUser() adminUser: AdminJwtPayload) {
  const image = await this.imageService.getImageById(id, undefined, false); // 404
  assertClientAccess(adminUser, image.clientId);
  if (!(await this.imageService.resetOptimizeAttempts({ id }))) {
    throw new ConflictException({ code: 'ALREADY_OPTIMIZED', message: 'Image already optimized' });
  }
}
```

`AvatarsAdminController`: `POST admin/avatars/:id/reoptimize`, stessa forma, `getAvatarById` + `NotFoundException`
come `deleteAvatar`, audit `fh_avatar.reoptimize_queued` con `avatarId`.

`assertClientAccess` **prima** dell'update: un id di un client non visibile risponde 403 come le altre
route `:id`, senza toccare la riga.

### 5. Endpoint bulk

DTO `src/modules/admin/dto/admin-reoptimize-failed.dto.ts`:

```ts
export class AdminReoptimizeFailedDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Limit to one client; omitted = every client you can see' })
  @IsOptional() @IsUUID()
  clientId?: string;
}
```

```ts
@Post('reoptimize-failed')
@HttpCode(200)
@ApiOperation({ summary: 'Re-queue every image the optimize job gave up on' })
@ApiResponse({ status: 200, schema: { properties: { count: { type: 'number' } } } })
@Audit('fh_image.reoptimize_queued', {
  metadata: (r: { count: number }, req: AuditRequest) => ({
    clientId: (req.body as { clientId?: string })?.clientId,
    count: r?.count ?? 0,
  }),
})
async reoptimizeFailedImages(@Body() dto: AdminReoptimizeFailedDto, @CurrentAdminUser() adminUser: AdminJwtPayload) {
  const count = await this.imageService.resetOptimizeAttempts({
    ...buildClientWhere(adminUser, dto.clientId), // 403 on a client out of scope
    ...OPTIMIZE_GIVEN_UP_WHERE,
  });
  return { count };
}
```

Solo i `failed` (non tutti i non ottimizzati): quelli con 1–2 tentativi sono ancora in coda, azzerarli in
massa non cambia nulla. `POST admin/avatars/reoptimize-failed` identico su `AvatarService`, stesso DTO.

Nessun conflitto di route: `reoptimize-failed` è un segmento solo, `:id/reoptimize` due (come
`bulk-delete` accanto a `:id`).

### 6. Test

- `admin-query.helper.spec.ts`: `parseOptimizeStatusQuery` → `undefined` per assente/vuoto, i tre where
  (per `failed` esattamente `OPTIMIZE_GIVEN_UP_WHERE`), 400 su valore ignoto.
- `images-admin.controller.spec.ts`:
  - `listImages` con `optimizeStatus=failed` passa a `findAdminImages` un where con scope client **e**
    `optimizeAttempts: { gte: 3 }`;
  - `reoptimizeImage`: 403 su client fuori scope senza chiamare `resetOptimizeAttempts`; 409 quando
    ritorna 0; ok quando ritorna 1;
  - `reoptimizeFailedImages`: senza `clientId` usa `{ in: allowedClientIds }`; con `clientId` fuori scope
    403 senza update; ritorna `{ count }`.
- `avatars-admin.controller.spec.ts`: gli stessi casi per gli avatar.
- `image.service.spec.ts` / `avatar.service.spec.ts`: `resetOptimizeAttempts` aggiunge sempre
  `isOptimized: false` al where.

## Doc da aggiornare

- `CLAUDE.md`:
  - Scheduled Jobs, "Set `optimizeAttempts = 0` to retry" → "`POST admin/images/:id/reoptimize` (or
    `admin/avatars/…`, or `…/reoptimize-failed` for all of them) re-queues; SQL still works";
  - Metrics, riga `fileharbor_optimize_given_up`: le vie d'uscita includono l'endpoint;
  - Admin Module: una riga sul filtro `optimizeStatus` delle liste immagini/avatar.
- `monitoring/alerts.yml`, `FileHarborOptimizeGivenUp`: il runbook nella `description` diventa "Inspect the
  files in Meridian (filter optimizeStatus=failed), then retry (reoptimize) or delete them". Espressione e
  soglia invariate.
- `../docs/integrations/fileharbor.md`: nulla, è superficie admin.

## Meridian

Repo separato, fuori da questo piano. Serve:

- filtro "Ottimizzazione" (tutte / ottimizzate / in coda / fallite) sulle liste immagini e avatar →
  `optimizeStatus`;
- badge "ottimizzazione fallita" (`!isOptimized && optimizeAttempts >= 3`) e azione "Riprova
  ottimizzazione" nel dettaglio; a 204 mostrare "in coda, entro un'ora";
- azione "Riprova tutti i falliti" sulla lista filtrata (con il `clientId` del filtro, se c'è) → `{ count }`;
- `server/utils/permission-policy.ts`: le quattro route nuove sotto `fileharbor-media.manage`.

## Fuori scope

- Ottimizzazione sincrona / "ottimizza ora": si aggiunge estraendo `optimizeImage` dal job in un service
  e passando da `runExclusive` per riga, se l'attesa di un'ora diventa un problema reale.
- Ri-ottimizzare immagini già ottimizzate, rigenerare thumbnail e varianti: piano 06.
- Video: non hanno pipeline di ottimizzazione.
- Esporre il motivo del fallimento: oggi è solo nei log (`Failed to optimize image …`). Una colonna
  `optimizeError` aiuterebbe a decidere tra "riprova" e "cancella", ma è schema in più per un caso raro.
- `getUnoptimizedAvatars` ordina per `createdAt` mentre l'indice `[isOptimized, updatedAt]` e la gauge
  `oldest_age` usano `updatedAt`: incoerenza minore notata leggendo, non toccata qui.
