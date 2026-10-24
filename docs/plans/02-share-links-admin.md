---
type: plan
service: fileharbor
status: in-progress
estimate: 1.5d
updated: 2026-10-22
verified: 4774bd3
---

# 02 · Share-link dalla console (FX1)

Backlog Meridian: FX1 (`meridian/docs/BACKLOG.md`). Tocca FileHarbor e Meridian; il piano vive qui
perché il grosso della superficie da sistemare è lato servizio.

## Perché

Uno share-link è un bearer token che apre un'immagine privata a chiunque abbia l'URL. Oggi la console
ne mostra solo il conteggio: un admin non vede quali link esistono, quando scadono, né può revocarne
uno trapelato. Crearli si può solo con la API key del client + `X-User-Id` del proprietario.

## Stato attuale

FileHarbor (`4774bd3`):

- `ImageShareLink` (`prisma/schema.prisma:382-394`): `id`, `imageId`, `readToken @unique`, `createdAt`,
  `expiresAt?`. Revoca = delete fisico.
- API client: `POST /images/:imageId/share`, `DELETE /images/share/:shareId`
  (`image/image.controller.ts:466-560`) → `ImageService.createShareLink` / `deleteShareLink`
  (`image/image.service.ts:750-850`). `CreateShareLinkDto.expiresAt` è solo `@IsString()`
  (`image/dto/create-share-link.dto.ts`): nessun controllo di data valida né futura.
- **Esiste già un controller admin**: `admin/controllers/image-share-links-admin.controller.ts`,
  classe sotto `fileharbor-media.manage` (`:40-43`):
  - `GET /admin/image-share-links?clientId&imageId&page&perPage` (`:50-185`), busta
    `{ data, pagination }`.
  - `DELETE /admin/image-share-links/:id` (`:187-233`), con `assertClientAccess` e audit
    `fh_share_link.deleted`.
  - **Nessuna create admin.**
- **Corretto il 2026-10-22**: lista e revoca admin interrogano `imageShareLink` direttamente (anche la revoca passava l'id creator interno e rispondeva 404); spec in `image-share-links-admin.controller.spec.ts`. Il bullet sotto descrive lo stato precedente.
- **Bug nel filtro `imageId`** (`:90-117`): chiama `imageService.getShareLinks(image.id, image.clientId,
  image.creatorId)`, ma il terzo argomento è un **externalId** (`findOwnedImage` → `ownerCreatorId`,
  `image.service.ts:723-745`). Con l'id interno del creator la lookup fallisce e la lista per
  immagine risponde `404 Image not found`. È l'effetto collaterale della correzione di Known issues §1
  (`docs/integrations/fileharbor.md`). Lo stesso ramo pagina in memoria (`slice`) e distingue
  "immagine inesistente" (404) da "immagine fuori scope" (lista vuota).
- `allowedClients !== null` (`:96`, `:123`) è codice morto: `resolveAllowedClients` ritorna sempre un
  array (`admin/helpers/admin-access.helper.ts:14`).
- `shareUrl` è relativo (`image.service.ts:1018-1024`, `route.path`), niente `fullUrl`.
- La show admin conta i link attivi (`findAdminImageById`, `image.service.ts:1099-1135`,
  `_count.shareLinks` con `expiresAt` nullo o futuro) → `activeShareLinks`
  (`admin/dto/admin-response.dto.ts:251-255`).
- Cleanup: `ImageCleanupJob.cleanExpiredShareLinks` alle 04:00 (`image/jobs/image.cleanup.job.ts:79`)
  cancella gli scaduti → un link scaduto resta visibile fino a ~24 h.
- Nessun consumer del `GET /admin/image-share-links` fuori da FileHarbor (grep sul monorepo): la busta
  si può cambiare gratis.

Meridian (`2e179cb`):

- Show immagine: solo `ShellFact` col conteggio
  (`app/pages/[tenant]/fileharbor/images/[id]/index.vue:82`), tipo `activeShareLinks?`
  (`app/types/fileharbor.ts:230`).
- Nessuna route BFF share-link. `API_POLICY` (`server/utils/permission-policy.ts:49-51`) copre già
  `/fileharbor/images/**` con `media.manage`; un prefisso `/fileharbor/share-links` oggi è **deny**
  (default-deny dei prefissi gated).

## Cosa

### Lato FileHarbor

1. **Fix lista** (`image-share-links-admin.controller.ts`): il ramo `imageId` diventa una query Prisma
   come il ramo globale, con `where.imageId` + `where.image.clientId in allowed`. Un'immagine
   inesistente o fuori scope dà la stessa risposta (lista vuota). Via il `slice` e i `!== null`.
2. **Busta**: passare a `{ data, meta }` con `paginate()` di `@heyatom/nest-common` (come
   `tag.service.ts`), `page`/`limit` (default 20, max 100). Nessun consumer da migrare.
3. **Filtro stato**: `status=active|expired|all`, default `active` (stesso predicato di
   `findAdminImageById`).
4. **Riga più ricca**: `image { id, originalName, isPrivate }`, `client { id, name }`, `shareUrl`
   assoluto (`RouteHelperService.fullUrl`), oltre a `readToken`/`expiresAt`/`isExpired`.
5. **Create admin**: `POST /admin/image-share-links { imageId, expiresAt }`:
   - `assertClientAccess` sul client dell'immagine (404 se manca, 403 fuori scope come la delete);
   - `expiresAt` obbligatorio, `@IsISO8601()`, futuro, al massimo 365 giorni (costante
     `ADMIN_SHARE_LINK_MAX_DAYS`, niente env);
   - **solo su immagine privata**: `400 { code: 'IMAGE_NOT_PRIVATE' }`. Un link su un'immagine
     pubblica non serve, e diventerebbe un accesso silenzioso il giorno in cui l'immagine passa a
     privata;
   - token `randomUUID()` come `createShareLink`: estrarre la `create` + `formatShareLinkResponse` in un
     metodo `ImageService.createShareLinkFor(imageId, expiresAt)` senza il check owner, riusato dal
     path client dopo `findOwnedImage`;
   - audit `fh_share_link.created` con `{ shareLinkId, imageId, expiresAt }`, mai il token.
6. `CreateShareLinkDto` (path client): `@IsISO8601()` al posto di `@IsString()` e rifiuto di una data
   passata (oggi `new Date('x')` dà `Invalid Date` → errore Prisma 500).
7. Test: spec del controller admin (scope, 404/403, immagine pubblica, scadenza nel passato e oltre il
   tetto, filtro `imageId` che oggi dà 404).

### Lato Meridian

1. Tipi in `app/types/fileharbor.ts`: `FileHarborShareLink` + uso di `FileHarborMetaPage<T>` (busta
   `{ data, meta }`, la stessa dei tag).
2. BFF (`fileharborAdmin()`):
   - `server/api/[tenant]/fileharbor/images/[id]/share-links.get.ts` → `GET /admin/image-share-links?imageId=:id&status=all`;
   - `server/api/[tenant]/fileharbor/images/[id]/share-links.post.ts` → `POST /admin/image-share-links`,
     body in whitelist (`expiresAt`), `imageId` dal path;
   - `server/api/[tenant]/fileharbor/share-links/index.get.ts` (lista globale, inoltra
     `clientId`/`status`/`page`/`limit` via `qs()`);
   - `server/api/[tenant]/fileharbor/share-links/[id].delete.ts`.
3. `API_POLICY`: `['*', '/fileharbor/share-links/**', 'fileharbor-media.manage']` prima delle regole
   immagini; `PAGE_POLICY`: `['/fileharbor/share-links', 'fileharbor-media.manage']`.
4. Composable `useFileHarborShareLinks` con `loaded`, errore che svuota la lista (regola delle liste).
5. **Show immagine**: il fact resta (conteggio attivi), sotto i panel esistenti un `.panel.panel--flush`
   "Share link" con `.tbl`: URL (`.key-reveal` + `.btn-copy`), creato, scadenza (badge `badge--warn`
   sotto 24 h, `badge--error` se scaduto), Revoca dietro `ShellConfirmDialog`. "Nuovo link" solo su
   immagine privata: `ShellDatePicker` + preset 1/7/30 giorni, default 7. Dopo la create l'URL resta in
   evidenza (`.reveal--inline`). Su immagine pubblica con link esistenti: nota che non servono e
   revoca disponibile.
6. **Pagina globale** `/fileharbor/share-links` (voce nav sotto Immagini, `app/utils/nav.ts`): tabella
   con anteprima (`FileharborThumb` via `useFileHarborImageSrc`), immagine, client, scadenza, revoca;
   filtri `?client&status&page` in URL (`useQueryState`), `ShellTablePager`.
7. i18n `fileharbor.shareLinks.*` it/en, test di parità.

## Contratto API

| Metodo | Path | Body / query | Risposta | Permesso |
|---|---|---|---|---|
| `GET` | `/admin/image-share-links` | `clientId?`, `imageId?`, `status?=active\|expired\|all`, `page`, `limit` | **`{ data, meta }`** (cambia da `{ data, pagination }`) | `media.manage` |
| `POST` | `/admin/image-share-links` | `{ imageId, expiresAt }` | `201` → `AdminImageShareLink` | `media.manage` |
| `DELETE` | `/admin/image-share-links/:id` | — | `200` → `AdminDeleteResponse` (invariata) | `media.manage` |

```ts
interface AdminImageShareLink {
  id: string; imageId: string; clientId: string;
  readToken: string;
  shareUrl: string;          // assoluto: BASE_URL + /images/:id?token=
  createdAt: string; expiresAt: string | null; isExpired: boolean;
  image: { id: string; originalName: string; isPrivate: boolean };
  client: { id: string; name: string };
}
```

Errori: `400 VALIDATION_FAILED` (data invalida, passata, oltre 365 gg), `400 IMAGE_NOT_PRIVATE`,
`403` client fuori scope, `404` immagine o link inesistente.

## Sicurezza/permessi

- **Tutto `fileharbor-media.manage`**, revoca compresa. Revocare riduce l'esposizione: chi può crearlo
  deve poterlo togliere, e l'AUTHOR ha già accesso ai byte privati via `/admin/images/:id/file`.
  Niente split `moderate` (non è un delete di contenuto).
- `readToken` in chiaro nella lista: accettabile per lo stesso motivo (chi lo legge può già leggere
  l'immagine). Non entra in log (`sanitizeLoggedUrl` copre `?token=`), audit né snackbar.
- Scope: sempre `allowedClientIds`, risposta uniforme per inesistente/fuori scope nella lista.
- Il BFF non decide niente oltre `API_POLICY`: FileHarbor ricontrolla permesso e scope.

## Ordine di deploy

1. FileHarbor (busta nuova, create, fix filtro). Nessun consumer rotto: la lista admin non la chiama
   nessuno.
2. Meridian. Contro un FileHarbor vecchio la create risponde 404 e la lista per immagine 404 (bug
   attuale): la sezione mostra l'errore, la show resta in piedi.

## Rischi/domande aperte

1. **"Mai" come scadenza?** Il piano impone una scadenza (≤ 365 gg) dalla console; il path client resta
   libero. Serve un link permanente da console?
2. **Link esistenti su immagini pubbliche**: revocarli in blocco con una migration o lasciarli scadere?
   Diventano attivi se l'immagine torna privata.
3. **Revoca in blocco** ("revoca tutti i link di questa immagine") non è nel piano: si aggiunge se la
   pagina lo chiede.

## Implementazione (2026-10-22)

- FileHarbor: `admin/dto/admin-share-link.dto.ts` (query `AdminShareLinkListQuery extends PageParams`,
  `AdminCreateShareLinkDto` con `@IsDate` + `@MinDate`/`@MaxDate`, `ADMIN_SHARE_LINK_MAX_DAYS`),
  `ImageService.createShareLinkFor()`, controller riscritto, spec estesa. Path client:
  `CreateShareLinkDto` su `@IsDate` + `@MinDate` (stringa invalida o passata → `400`).
- Meridian: BFF `images/[id]/share-links.{get,post}.ts` e `share-links/{index.get,[id].delete}.ts`,
  `useFileHarborShareLinks`, `FileharborShareLinksPanel` + `FileharborShareLinkExpiry`, pagina
  `share-links/index.vue`, nav, `API_POLICY`/`PAGE_POLICY`, i18n it/en.
- Domande aperte 1–3: lasciate come nel piano (scadenza obbligatoria da console; link su immagini
  pubbliche visibili con nota e revoca; niente revoca in blocco).
- Resta: la verifica manuale in Meridian (ultimi due criteri, a parte il CLAUDE.md fatto).

## Criteri di completamento

- [x] `GET /admin/image-share-links?imageId=<id>` di un'immagine in scope con link risponde 200 con
      i link (oggi 404); fuori scope o inesistente → `{ data: [], meta.total: 0 }`.
- [x] La lista risponde `{ data, meta: { total, page, limit, totalPages } }`.
- [x] `POST` su immagine pubblica → 400 `IMAGE_NOT_PRIVATE`; `expiresAt` passato o oltre 365 gg →
      400; client fuori scope → 403; successo → 201 con `shareUrl` assoluto e audit
      `fh_share_link.created` senza token.
- [x] `POST /images/:id/share` con `expiresAt: "x"` → 400, non 500.
- [x] `pnpm test` FileHarbor verde con i nuovi spec.
- [ ] Meridian: dalla show di un'immagine privata creo un link, lo copio, lo apro in incognito (immagine
      visibile), lo revoco, riapro (placeholder `permission_denied`).
- [ ] Un AUTHOR vede e usa la sezione; un utente senza `media.manage` prende 403 su
      `/api/:tenant/fileharbor/share-links`.
- [x] `node --test test/i18n-parity.test.ts` verde; CLAUDE.md Meridian aggiornato ("gli share-link non
      hanno gestione" → descrizione della sezione).
