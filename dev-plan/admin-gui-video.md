# Admin GUI — Video Integration Plan (Nuxt/Vue)

## Scope

Admin visualizza, filtra e gestisce video. Nessun upload dalla GUI.
Operazioni supportate: **lista**, **dettaglio + player**, **edit metadata/tags**, **bookmark**.

---

## Backend endpoints disponibili

| Method   | Path                               | Uso                               |
|----------|------------------------------------|-----------------------------------|
| `GET`    | `/admin/videos`                    | Lista paginata con filtri         |
| `GET`    | `/admin/videos/:id`                | Dettaglio singolo video           |
| `PATCH`  | `/admin/videos/:id`                | Edit metadata/tags/isPrivate      |
| `DELETE` | `/admin/videos/:id`                | Elimina video                     |
| `GET`    | `/videos/:id/thumb`                | Thumbnail WebP (poster `<video>`) |
| `GET`    | `/videos/:id`                      | Stream video (con Range)          |
| `GET`    | `/videos/:id/info`                 | Metadata senza incremento views   |
| `POST`   | `/admin/bookmarks/videos/:videoId` | Aggiungi bookmark                 |
| `DELETE` | `/admin/bookmarks/videos/:videoId` | Rimuovi bookmark                  |
| `GET`    | `/admin/bookmarks/videos`          | Lista video bookmarkati           |

Query params `GET /admin/videos`:
- `clientId`, `name` (search), `tags` (array), `sortBy`, `sortOrder`, `page`, `perPage`

---

## Struttura file da creare

```
pages/
  videos/
    index.vue              ← lista video
    [id].vue               ← dettaglio + player + edit

components/
  video/
    VideoTable.vue         ← tabella paginata con filtri
    VideoFilters.vue       ← form filtri (client, nome, tag, sort)
    VideoPlayer.vue        ← <video> con poster thumb + stream src
    VideoMetadataForm.vue  ← form edit (description, isPrivate, tags)
    VideoCard.vue          ← card per lista bookmarks (opzionale)

composables/
  useVideos.ts             ← listVideos, getVideo, updateVideo, deleteVideo
  useVideoBookmarks.ts     ← bookmarkVideo, removeBookmark, listBookmarks

types/
  video.ts                 ← VideoResponse, AdminVideoResponse, ecc.
```

---

## Phase 1 — Types

**File:** `types/video.ts`

```typescript
export interface AdminVideo {
  id: string
  clientId: string
  originalName: string
  mimeType: string
  size: number
  duration?: number
  width?: number
  height?: number
  isPrivate: boolean
  tags: string[]
  description?: string
  views: number
  downloads: number
  storagePath: string
  createdAt: string
  updatedAt: string
  client?: { id: string; name: string; domain?: string }
  user?: { externalUserId: string; username?: string }
  isBookmarked: boolean
}

export interface AdminVideoListResponse {
  data: AdminVideo[]
  pagination: {
    page: number
    perPage: number
    total: number
    totalPages: number
  }
}

export interface AdminVideoFilters {
  clientId?: string
  name?: string
  tags?: string[]
  sortBy?: 'createdAt' | 'size' | 'views' | 'downloads' | 'originalName'
  sortOrder?: 'asc' | 'desc'
  page?: number
  perPage?: number
}

export interface UpdateVideoPayload {
  description?: string
  isPrivate?: boolean
  tags?: string[]
  originalName?: string
}
```

---

## Phase 2 — Composables

### `composables/useVideos.ts`

```typescript
export function useVideos() {
  const { $api } = useNuxtApp() // o useFetch/useApi pattern del progetto

  async function listVideos(filters: AdminVideoFilters): Promise<AdminVideoListResponse> {
    return $api.get('/admin/videos', { params: filters })
  }

  async function getVideo(id: string): Promise<AdminVideo> {
    return $api.get(`/admin/videos/${id}`)
  }

  async function updateVideo(id: string, payload: UpdateVideoPayload): Promise<AdminVideo> {
    return $api.patch(`/admin/videos/${id}`, payload)
  }

  async function deleteVideo(id: string): Promise<void> {
    return $api.delete(`/admin/videos/${id}`)
  }

  return { listVideos, getVideo, updateVideo, deleteVideo }
}
```

### `composables/useVideoBookmarks.ts`

```typescript
export function useVideoBookmarks() {
  const { $api } = useNuxtApp()

  async function bookmarkVideo(videoId: string) {
    return $api.post(`/admin/bookmarks/videos/${videoId}`)
  }

  async function removeBookmark(videoId: string) {
    return $api.delete(`/admin/bookmarks/videos/${videoId}`)
  }

  async function listVideoBookmarks(params?: { clientId?: string; search?: string; page?: number; perPage?: number }) {
    return $api.get('/admin/bookmarks/videos', { params })
  }

  async function toggleBookmark(video: AdminVideo) {
    if (video.isBookmarked) {
      await removeBookmark(video.id)
      video.isBookmarked = false
    } else {
      await bookmarkVideo(video.id)
      video.isBookmarked = true
    }
  }

  return { bookmarkVideo, removeBookmark, listVideoBookmarks, toggleBookmark }
}
```

---

## Phase 3 — VideoPlayer Component

**File:** `components/video/VideoPlayer.vue`

Il componente usa:
- `poster` → `GET /admin/videos/:id/thumb` (AdminJwtGuard ✅)
- `src` → `GET /admin/videos/:id/stream` (AdminJwtGuard ✅)
- `preload="none"` → video non carica finché user non preme play
- Nginx gestisce Range requests in prod; dev usa `createReadStream`

Entrambi gli endpoint sono **già implementati** nel backend e usano `AdminJwtGuard` — nessuna API key necessaria.

```vue
<template>
  <div class="video-player-wrapper">
    <video
      :poster="thumbUrl"
      :src="streamUrl"
      controls
      preload="none"
      class="w-full rounded-lg"
      @error="onError"
    >
      Your browser does not support the video tag.
    </video>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ videoId: string; apiBase: string }>()

const thumbUrl = computed(() => `${props.apiBase}/admin/videos/${props.videoId}/thumb`)
const streamUrl = computed(() => `${props.apiBase}/admin/videos/${props.videoId}/stream`)

function onError(e: Event) {
  console.error('[VideoPlayer] Stream error', e)
}
</script>
```

> **Nota auth**: il browser non può inviare `Authorization: Bearer` da tag `<video>`/`<img>` nativi.
> Gli endpoint `/admin/videos/:id/stream` e `/admin/videos/:id/thumb` usano `AdminJwtGuard`
> ma il token deve viaggiare via cookie (se la GUI usa cookie-based auth) oppure
> il fetcher Nuxt deve fare una fetch manuale e creare un `blob:` URL.
>
> **Se la GUI usa cookie JWT** (httpOnly): funziona direttamente, il browser manda il cookie.
>
> **Se la GUI usa token in memoria/localStorage**: usare blob URL nel player (vedi sotto).

### Blob URL fallback (token in-memory)

```vue
<script setup lang="ts">
const props = defineProps<{ videoId: string }>()
const { $api } = useNuxtApp()

const streamUrl = ref<string>('')
const thumbUrl = ref<string>('')

onMounted(async () => {
  // Fetch con JWT header → blob URL
  const [streamBlob, thumbBlob] = await Promise.all([
    $api.get(`/admin/videos/${props.videoId}/stream`, { responseType: 'blob' }),
    $api.get(`/admin/videos/${props.videoId}/thumb`, { responseType: 'blob' }),
  ])
  streamUrl.value = URL.createObjectURL(streamBlob)
  thumbUrl.value = URL.createObjectURL(thumbBlob)
})

onUnmounted(() => {
  URL.revokeObjectURL(streamUrl.value)
  URL.revokeObjectURL(thumbUrl.value)
})
</script>
```

> ⚠️ Il blob URL scarica tutto il video in memoria — non ideale per file grandi.
> Per video grandi preferire cookie-based auth o un token di accesso temporaneo.

---

## Phase 4 — VideoMetadataForm Component

**File:** `components/video/VideoMetadataForm.vue`

```vue
<template>
  <form @submit.prevent="submit">
    <!-- originalName -->
    <input v-model="form.originalName" />

    <!-- description -->
    <textarea v-model="form.description" />

    <!-- isPrivate toggle -->
    <toggle v-model="form.isPrivate" label="Private" />

    <!-- tags: tag input con chip UI -->
    <tag-input v-model="form.tags" />

    <button type="submit" :disabled="loading">Save</button>
  </form>
</template>

<script setup lang="ts">
const props = defineProps<{ video: AdminVideo }>()
const emit = defineEmits<{ updated: [AdminVideo] }>()
const { updateVideo } = useVideos()

const form = reactive({
  originalName: props.video.originalName,
  description: props.video.description ?? '',
  isPrivate: props.video.isPrivate,
  tags: [...props.video.tags],
})

const loading = ref(false)

async function submit() {
  loading.value = true
  try {
    const updated = await updateVideo(props.video.id, form)
    emit('updated', updated)
  } finally {
    loading.value = false
  }
}
</script>
```

---

## Phase 5 — Lista Video (`pages/videos/index.vue`)

Funzionalità:
- Tabella paginata con colonne: thumbnail (poster WebP), nome, client, dimensione, durata, views, tag, privato, data, azioni
- Filtri: client dropdown, search per nome, tag multi-select, sort (campo + direzione)
- Bookmark toggle su ogni riga (stella)
- Click riga → navigazione a `/videos/:id`
- Delete con confirm dialog

```vue
<template>
  <div>
    <VideoFilters v-model="filters" @change="loadVideos" />

    <table>
      <thead>...</thead>
      <tbody>
        <tr v-for="video in videos" :key="video.id" @click="navigate(video.id)">
          <td>
            <img :src="`${apiBase}/videos/${video.id}/thumb`" class="thumb" />
          </td>
          <td>{{ video.originalName }}</td>
          <td>{{ video.client?.name }}</td>
          <td>{{ formatSize(video.size) }}</td>
          <td>{{ formatDuration(video.duration) }}</td>
          <td>{{ video.views }}</td>
          <td><TagList :tags="video.tags" /></td>
          <td><PrivateBadge :isPrivate="video.isPrivate" /></td>
          <td>{{ formatDate(video.createdAt) }}</td>
          <td>
            <BookmarkButton :bookmarked="video.isBookmarked" @toggle="toggleBookmark(video)" />
            <DeleteButton @confirm="deleteVideo(video)" />
          </td>
        </tr>
      </tbody>
    </table>

    <Pagination v-model:page="filters.page" :totalPages="pagination.totalPages" />
  </div>
</template>
```

> **Thumbnail nella lista**: URL costruita inline dall'ID — nessuna chiamata extra.
> `<img :src="\`${apiBase}/admin/videos/${video.id}/thumb\`" />`
> Il browser la carica automaticamente al render.
> Se auth via **cookie** → funziona out-of-the-box.
> Se auth **in-memory** → il browser non manda Bearer header → 401. In quel caso usare blob URL (vedi VideoPlayer).

---

## Phase 6 — Dettaglio Video (`pages/videos/[id].vue`)

Layout a due colonne:
- **Sinistra**: VideoPlayer + info (dimensione, durata, views, downloads, client, user, date)
- **Destra**: VideoMetadataForm + BookmarkButton

```vue
<template>
  <div class="grid grid-cols-2 gap-8">
    <div>
      <VideoPlayer :videoId="video.id" :apiBase="apiBase" />
      <VideoInfo :video="video" />
    </div>
    <div>
      <BookmarkButton :bookmarked="video.isBookmarked" @toggle="toggleBookmark(video)" />
      <VideoMetadataForm :video="video" @updated="onUpdated" />
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const { getVideo } = useVideos()
const { toggleBookmark } = useVideoBookmarks()

const { data: video } = await useAsyncData(`video-${route.params.id}`, () =>
  getVideo(route.params.id as string)
)

function onUpdated(updated: AdminVideo) {
  Object.assign(video.value, updated)
}
</script>
```

---

## Phase 7 — Auth per Stream/Thumb ✅ IMPLEMENTATA

Endpoint già disponibili nel backend (`VideosAdminController`):

```
GET /admin/videos/:id/thumb    → WebP thumbnail, AdminJwtGuard, Cache-Control: private
GET /admin/videos/:id/stream   → MP4 stream, AdminJwtGuard, Range support, X-Accel-Redirect in prod
```

Nessuna modifica backend necessaria. Usare queste URL nella GUI.

---

## Phase 8 — Sidebar / Navigazione

Aggiungere voce "Videos" nella sidebar admin, con badge contatore totale (opzionale).

```
Sidebar:
  - Dashboard
  - Images
  - Videos  ← nuovo
  - Avatars
  - Albums
  - Clients
  - Users
  - Bookmarks
    - Images
    - Videos  ← nuovo
    - Users
```

---

## Implementation Order

```
1. types/video.ts                          (Phase 1)
2. composables/useVideos.ts                (Phase 2)
3. composables/useVideoBookmarks.ts        (Phase 2)
4. components/video/VideoPlayer.vue        (Phase 3)
5. components/video/VideoMetadataForm.vue  (Phase 4)
6. pages/videos/index.vue                  (Phase 5)
7. pages/videos/[id].vue                   (Phase 6)
8. Backend: /admin/videos/:id/stream+thumb (Phase 7)  ← sblocca player con auth
9. Sidebar update                          (Phase 8)
```

---

## Key Constraints

- Thumbnail/stream nella lista (`<img>`, `<video>`) richiedono Phase 7 per funzionare con JWT admin
- Workaround temporaneo per dev: usare `blob:` URL via fetch manuale se Phase 7 non è ancora implementata
- `preload="none"` obbligatorio — non pre-caricare video in lista (performance)
- Delete deve avere confirm dialog (azione irreversibile)
- Edit tags: inviare sempre l'array completo — il backend fa `deleteMany + create`
- `isPrivate` toggle mostra badge visivo nella lista (non nasconde il video all'admin)
- Pagination: default 20 per pagina, max 100
