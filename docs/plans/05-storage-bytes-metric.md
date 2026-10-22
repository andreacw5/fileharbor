---
type: plan
service: fileharbor
status: open
estimate: 0.5d
updated: 2026-10-22
verified: 4774bd3
---

# 05 · Metrica `fileharbor_storage_bytes{client}` + alert di crescita

Backlog: 2b.11 (`docs/BACKLOG.md`), collegato a 1.3.

## Problema

Il disco locale è il vincolo vero: sotto `HEALTH_DISK_MIN_FREE_MB` `/health/ready` va giù e si
fermano anche le letture (`health/storage-health.indicator.ts:27-36`). Oggi nessuna metrica dice
**quale client** sta riempiendo il disco: il dato esiste solo nelle risposte admin
(`totalStorage` di `GET /admin/clients[/:id]` e `GET /admin/stats`), calcolato al volo e senza
storia. Prometheus ne terrebbe la storia gratis.

## Rapporto con il piano 04

04 (`04-storage-report.md`) fa snapshot giornalieri in DB per client × tipo e un report in console.
05 è una sola gauge per l'operatore. Si toccano in un punto: **la stessa aggregazione per client**,
oggi `ClientService.storageByClient` (`client/client.service.ts:318-352`, privata).

- **Riuso**: 05 estrae `storageByClient` in una funzione condivisa (step 1). È lo stesso refactor che
  04 chiede al punto 2 ("estrarre il calcolo da `storageByClient` in un helper condiviso"): 05 lo fa
  per primo, 04 lo trova pronto e lo estende con il dettaglio per tipo e il `count` che servono allo
  snapshot (la gauge non ne ha bisogno).
- **Separato**: tabella `StorageSnapshot`, job, route e Meridian restano tutti in 04. 05 non aggiunge
  schema, job né endpoint. Le due cose non si sostituiscono: la gauge ha la storia in Prometheus (fuori
  dalla console, nessuno scope tenant), gli snapshot sono per la console e rispettano lo scope.
- **Ordine**: 05 prima (XS, nessuna migration, sblocca il refactor), poi 04.
- `StatisticsService.getGlobalStats` (`statistics/statistics.service.ts:59-64`, `:85-86`) resta com'è:
  somma per scope, non per client.

## Decisioni

- **Label `client` = `Client.id`**. Immutabile e mai null; `domain` è nullable e modificabile via
  `PATCH /admin/clients/:id` (una rinomina spezzerebbe la serie), `name` idem. L'operatore risale al
  client da Meridian o con una query su `clients`. Niente metrica `_info` con il nome: in più solo
  quando servirà davvero.
- **Cardinalità**: una serie per client con almeno un media (pochi tenant + qualche client personale,
  decine al massimo). Nessun label `kind`: il backlog chiede `{client}`, il dettaglio per tipo è di 04.
- **Client personali inclusi**, stessa label (id opaco). `/metrics` sta solo sulla rete interna
  (`METRICS_PORT`, mai pubblicato): l'operatore vede comunque il DB e il disco, la regola "invisibile in
  console" non si applica qui.
- **Lazy come le gauge del backlog di ottimizzazione**: query solo allo scrape, errore → `warn` e valore
  precedente. Tre `groupBy` (uno per tabella) per scrape, sugli indici `[clientId, createdAt]` che già
  esistono (`schema.prisma:118`, `:181`, `:237`). Nessuna cache.
- **Client cancellati spariscono**: a ogni scrape riuscito `gauge.reset()` e poi `set` per ogni client
  restituito. Il reset avviene **dopo** la query, così un errore lascia i valori vecchi.
- **Stesso numero della console**: byte degli originali (`size`), senza thumbnail e varianti in cache.
  Sottostima il disco reale (stessa avvertenza di 04, rischio 1): va bene per dire *chi* cresce, non
  quanto spazio resta. Lo spazio libero è un'altra metrica (fuori scope).
- **Alert di crescita, non di soglia assoluta**: senza la dimensione del volume una soglia assoluta
  non ha senso. `delta(...[24h])` per client, sopra **5 GiB/giorno**, severity `warning`, `for: 1h`.
  Soglia iniziale da tarare in prod (dubbio aperto 1). Un optimize o un delete abbassano la serie:
  `delta` negativo, nessun falso positivo.

## Step

### 1. Helper condiviso `storageByClient`

Nuovo `src/common/storage-bytes.ts` (accanto a `share-tokens.ts`; funzione pura, niente provider:
la metrica non deve importare `ClientModule`):

```ts
/** Bytes of originals per client (images + videos + avatars). Video sizes are BigInt; a Number is exact up to 8 PiB. */
export async function storageByClient(
  prisma: PrismaService,
  clientIds?: string[],      // undefined = every client
): Promise<Map<string, number>>
```

Corpo = quello di `client.service.ts:318-352`, con `where` solo se `clientIds` è passato. In
`ClientService` sostituire le quattro chiamate (`:192`, `:234`, `:269`, `:302`) con
`storageByClient(this.prisma, [...])` e cancellare il metodo privato.

### 2. Gauge in `FileharborMetrics`

`src/modules/metrics/fileharbor-metrics.service.ts`: nuovo `registerStorageGauge()` chiamato dal
costruttore dopo `registerOptimizeGauges()` (`:66`). Non passa da `lazyGauge` (`:74-95`): quello è
legato al label `kind`. Gauge a sé, stesso schema di errore:

```ts
const gauge = new Gauge({
  name: 'fileharbor_storage_bytes',
  help: 'Bytes of stored originals (images + videos + avatars) per client; excludes thumbnails and cached variants',
  labelNames: ['client'],
  registers: [this.metrics.registry],
  collect: async () => {
    try {
      const totals = await storageByClient(this.prisma);
      gauge.reset();
      for (const [client, bytes] of totals) gauge.set({ client }, bytes);
    } catch (err) {
      this.logger.warn(`fileharbor_storage_bytes collection failed: ...`);
    }
  },
});
```

Aggiornare il commento della classe (`:39-41`): le gauge lazy non sono più solo quelle di ottimizzazione.

### 3. Alert

`monitoring/alerts.yml`, in coda al gruppo `fileharbor`:

```yaml
      - alert: FileHarborClientStorageGrowth
        # Originals only (DB size), not the real disk: says who grows, not how much is left.
        expr: delta(fileharbor_storage_bytes[24h]) > 5 * 1024 * 1024 * 1024
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: 'FileHarbor client {{ $labels.client }} storage growing fast'
          description: >-
            Client {{ $labels.client }} grew by {{ $value | humanize1024 }}B in 24h
            (threshold 5 GiB). Check free space (/health/ready, HEALTH_DISK_MIN_FREE_MB)
            and what the client is uploading.
```

## Test

`src/modules/metrics/fileharbor-metrics.service.spec.ts`: aggiungere `groupBy` ai mock di `image`,
`avatar` e un `video: { groupBy }` (oggi `mockPrisma` ha solo `image`/`avatar` con `count`/`aggregate`,
`:8-9`). Casi, con l'helper `scrape()` già presente (indicizzato per `labels.client` invece di `kind`):

- nessuna query prima dello scrape (estendere il caso esistente `:34-38` a `groupBy`);
- somma delle tre tabelle per client, `BigInt` del video convertito;
- un client presente al primo scrape e assente al secondo sparisce (reset);
- `groupBy` che rigetta → `warn`, valori del primo scrape intatti.

`client.service.spec.ts` deve restare verde senza modifiche (mocka già i tre `groupBy`, `:50-56`):
è la prova che l'estrazione dello step 1 non cambia comportamento.

## Doc da aggiornare

- `CLAUDE.md` → **Metrics**: un punto per `fileharbor_storage_bytes{client}` (label = `Client.id`,
  lazy, originali soltanto, reset ad ogni scrape, client personali inclusi) e l'alert.
- `monitoring/alerts.yml`: step 3.
- `docs/BACKLOG.md` 2b.11: spuntare a lavoro fatto (non in questo piano).

## Fuori scope

- Spazio libero del volume come metrica (`statfs` già fatto dall'health indicator) e la scelta
  readiness vs alert di 1.3: con quella metrica l'alert potrà diventare `predict_linear` sul disco.
- Byte reali su disco (thumbnail, varianti, walk del filesystem): rischio 1 di 04.
- Label `kind`, storia per creator, report in console: piano 04.
- Metrica `fileharbor_client_info{client,name}` per leggibilità degli alert.

## Dubbi aperti

1. **Soglia 5 GiB/24h**: arbitraria. Da tarare sulla dimensione del volume di prod e sulla crescita
   osservata le prime settimane.
2. **Costo per scrape**: tre `groupBy` con `SUM` su tutte le righe a ogni scrape. Irrilevante alle
   dimensioni attuali; se le tabelle crescono molto, alzare lo `scrape_interval` del job o cachare il
   risultato qualche minuto.
