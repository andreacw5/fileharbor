# Mixed Albums — Dev Plan

## Obiettivo

Sostituire `AlbumImage` con `AlbumItem` unificato (immagini + video, ordinamento comune).
Nessuna backward compat — `AlbumImage` viene droppata completamente.

---

## Schema attuale → target

```
PRIMA:  Album → AlbumImage (albumId, imageId, order) → Image
DOPO:   Album → AlbumItem  (albumId, imageId?, videoId?, resourceType, order) → Image | Video
```

---

## Phase 1 — Prisma Schema

**File:** `prisma/schema.prisma`

### 1a. Rimuovere `AlbumImage`

```diff
- model AlbumImage {
-   id      String   @id @default(uuid())
-   albumId String
-   imageId String
-   order   Int      @default(0)
-   addedAt DateTime @default(now())
-   album Album @relation(fields: [albumId], references: [id], onDelete: Cascade)
-   image Image @relation(fields: [imageId], references: [id], onDelete: Cascade)
-   @@unique([albumId, imageId])
-   @@index([albumId])
- }
```

### 1b. Aggiungere enum + `AlbumItem`

```prisma
enum AlbumResourceType {
  IMAGE
  VIDEO
}

model AlbumItem {
  id           String            @id @default(uuid())
  albumId      String
  imageId      String?
  videoId      String?
  resourceType AlbumResourceType
  order        Int               @default(0)
  addedAt      DateTime          @default(now())

  album Album  @relation(fields: [albumId], references: [id], onDelete: Cascade)
  image Image? @relation(fields: [imageId], references: [id], onDelete: Cascade)
  video Video? @relation(fields: [videoId], references: [id], onDelete: Cascade)

  @@unique([albumId, imageId])
  @@unique([albumId, videoId])
  @@index([albumId, order])
  @@index([albumId, resourceType])
}
```

### 1c. Aggiornare relazioni

```prisma
model Album {
  // rimuovere: albumImages AlbumImage[]
  albumItems  AlbumItem[]   // ← sostituisce
  albumTokens AlbumToken[]
  coverImage  Image? @relation("AlbumCoverImage", ...)
  // resto invariato
}

model Image {
  // rimuovere: albumImages AlbumImage[]
  albumItems AlbumItem[]   // ← sostituisce
  // resto invariato
}

model Video {
  // aggiungere:
  albumItems AlbumItem[]
}
```

### 1d. Migration SQL

La migration Prisma genera `DROP TABLE "AlbumImage"` + `CREATE TABLE "AlbumItem"`.
Se ci sono dati da preservare, aggiungere nella migration manuale:

```sql
-- Inserire PRIMA del DROP nella migration generata
INSERT INTO "AlbumItem" (id, "albumId", "imageId", "resourceType", "order", "addedAt")
SELECT gen_random_uuid(), "albumId", "imageId", 'IMAGE'::"AlbumResourceType", "order", "addedAt"
FROM "AlbumImage";
```

```bash
pnpm run prisma:migrate
```

---

## Phase 2 — DTOs

**File:** `src/modules/album/dto/album-item.dto.ts` (nuovo)

```typescript
import { Expose, Type } from 'class-transformer';

export class AlbumItemImageDataDto {
  @Expose() id: string;
  @Expose() originalName: string;
  @Expose() mimeType: string;
  @Expose() width: number;
  @Expose() height: number;
  @Expose() size: number;
  @Expose() tags: string[];
  @Expose() fullPath: string;
  @Expose() thumbnailPath: string;
}

export class AlbumItemVideoDataDto {
  @Expose() id: string;
  @Expose() originalName: string;
  @Expose() mimeType: string;
  @Expose() duration?: number;
  @Expose() width?: number;
  @Expose() height?: number;
  @Expose() size: number;
  @Expose() tags: string[];
  @Expose() url: string;
  @Expose() thumbnailUrl: string;
}

export class AlbumItemDto {
  @Expose() id: string;
  @Expose() resourceType: 'IMAGE' | 'VIDEO';
  @Expose() order: number;
  @Expose() addedAt: Date;
  @Expose() @Type(() => AlbumItemImageDataDto) image?: AlbumItemImageDataDto;
  @Expose() @Type(() => AlbumItemVideoDataDto) video?: AlbumItemVideoDataDto;
}

export class AlbumItemListResponseDto {
  @Expose() @Type(() => AlbumItemDto) data: AlbumItemDto[];
  @Expose() pagination: { page: number; perPage: number; total: number; totalPages: number };
}
```

**File:** `src/modules/album/dto/add-album-items.dto.ts` (nuovo)

```typescript
import { IsArray, IsEnum, IsInt, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AlbumResourceType } from 'generated/prisma';

export class AddAlbumItemDto {
  @IsUUID() id: string;
  @IsEnum(AlbumResourceType) resourceType: AlbumResourceType;
  @IsOptional() @IsInt() @Min(0) order?: number;
}

export class AddAlbumItemsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => AddAlbumItemDto)
  items: AddAlbumItemDto[];
}

export class AddAlbumItemsResponseDto {
  @Expose() albumId: string;
  @Expose() items: { id: string; resourceType: string; order: number }[];
  @Expose() count: number;
}
```

**File:** `src/modules/album/dto/remove-album-items.dto.ts` (nuovo)

```typescript
export class RemoveAlbumItemDto {
  @IsUUID() id: string;
  @IsEnum(AlbumResourceType) resourceType: AlbumResourceType;
}

export class RemoveAlbumItemsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => RemoveAlbumItemDto)
  items: RemoveAlbumItemDto[];
}
```

**File:** `src/modules/album/dto/list-album-items.dto.ts` (nuovo)

```typescript
export class ListAlbumItemsDto {
  @IsOptional() @IsEnum(AlbumResourceType) resourceType?: AlbumResourceType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) perPage?: number;
}
```

Aggiornare barrel `src/modules/album/dto/index.ts` con i nuovi DTO.

---

## Phase 3 — AlbumService

**File:** `src/modules/album/album.service.ts`

### 3a. Sostituire tutti i riferimenti `albumImages` → `albumItems`

Ogni occorrenza di:
- `albumImages` → `albumItems`
- `_count: { select: { albumImages: true } }` → `_count: { select: { albumItems: true } }`
- `c._count.albumImages` → `c._count.albumItems`
- `album.albumImages[0]?.image` → cercare il primo item con `resourceType: IMAGE`

### 3b. Helper include

```typescript
private buildAlbumItemInclude(resourceType?: AlbumResourceType) {
  return {
    image: resourceType === AlbumResourceType.VIDEO ? false : {
      select: {
        id: true, originalName: true, mimeType: true,
        width: true, height: true, size: true,
        imageTags: { include: { tag: { select: { name: true } } } },
      },
    },
    video: resourceType === AlbumResourceType.IMAGE ? false : {
      select: {
        id: true, originalName: true, mimeType: true,
        duration: true, width: true, height: true, size: true,
        videoTags: { include: { tag: { select: { name: true } } } },
      },
    },
  };
}
```

### 3c. `addItemsToAlbum` (sostituisce `addImagesToAlbum` + `forceAddImagesToAlbum`)

```typescript
async addItemsToAlbum(
  albumId: string,
  clientId: string,
  userId: string | undefined,
  items: { id: string; resourceType: AlbumResourceType; order?: number }[],
  force = false,
) {
  const album = force
    ? await this.prisma.album.findFirst({ where: { id: albumId, clientId } })
    : await this.verifyAlbumAccess(albumId, clientId, userId);
  if (!album) throw new NotFoundException('Album not found');

  const results = await Promise.all(items.map(async (item, idx) => {
    const isImage = item.resourceType === AlbumResourceType.IMAGE;

    if (isImage) {
      const img = await this.prisma.image.findFirst({ where: { id: item.id, clientId } });
      if (!img) throw new NotFoundException(`Image ${item.id} not found`);
    } else {
      const vid = await this.prisma.video.findFirst({ where: { id: item.id, clientId } });
      if (!vid) throw new NotFoundException(`Video ${item.id} not found`);
    }

    return this.prisma.albumItem.upsert({
      where: isImage
        ? { albumId_imageId: { albumId, imageId: item.id } }
        : { albumId_videoId: { albumId, videoId: item.id } },
      create: {
        albumId,
        ...(isImage ? { imageId: item.id } : { videoId: item.id }),
        resourceType: item.resourceType,
        order: item.order ?? idx,
      },
      update: { order: item.order ?? idx },
    });
  }));

  return {
    albumId,
    items: results.map(r => ({ id: r.id, resourceType: r.resourceType, order: r.order })),
    count: results.length,
  };
}
```

### 3d. `removeItemsFromAlbum` (sostituisce `removeImagesFromAlbum`)

```typescript
async removeItemsFromAlbum(
  albumId: string,
  clientId: string,
  userId: string | undefined,
  items: { id: string; resourceType: AlbumResourceType }[],
) {
  await this.verifyAlbumAccess(albumId, clientId, userId);

  let removed = 0;
  for (const item of items) {
    const isImage = item.resourceType === AlbumResourceType.IMAGE;
    try {
      await this.prisma.albumItem.delete({
        where: isImage
          ? { albumId_imageId: { albumId, imageId: item.id } }
          : { albumId_videoId: { albumId, videoId: item.id } },
      });
      removed++;
    } catch { /* già rimosso */ }
  }

  return { albumId, removed, success: true, message: `${removed} item(s) removed` };
}
```

### 3e. `listAlbumItems`

```typescript
async listAlbumItems(
  albumId: string,
  clientId: string,
  params: { resourceType?: AlbumResourceType; page: number; perPage: number },
) {
  const where: any = { albumId, album: { clientId } };
  if (params.resourceType) where.resourceType = params.resourceType;

  const [rows, total] = await this.prisma.$transaction([
    this.prisma.albumItem.findMany({
      where,
      orderBy: { order: 'asc' },
      skip: (params.page - 1) * params.perPage,
      take: params.perPage,
      include: this.buildAlbumItemInclude(params.resourceType),
    }),
    this.prisma.albumItem.count({ where }),
  ]);

  return {
    data: rows.map(item => this.mapAlbumItem(item)),
    pagination: {
      page: params.page,
      perPage: params.perPage,
      total,
      totalPages: Math.ceil(total / params.perPage),
    },
  };
}
```

### 3f. `mapAlbumItem` (private)

```typescript
private mapAlbumItem(item: any) {
  const base = { id: item.id, resourceType: item.resourceType, order: item.order, addedAt: item.addedAt };

  if (item.resourceType === 'IMAGE' && item.image) {
    return {
      ...base,
      image: {
        ...item.image,
        tags: item.image.imageTags?.map((t: any) => t.tag.name) ?? [],
        fullPath: this.route.fullUrl('images', item.image.id),
        thumbnailPath: this.route.fullUrl('images', item.image.id, 'thumb'),
      },
    };
  }

  return {
    ...base,
    video: {
      ...item.video,
      tags: item.video.videoTags?.map((t: any) => t.tag.name) ?? [],
      url: this.route.fullUrl('videos', item.video.id),
      thumbnailUrl: this.route.fullUrl('videos', item.video.id, 'thumb'),
    },
  };
}
```

### 3g. `coverUrl` fallback

Nelle query che calcolano `coverUrl` dall'album, sostituire:

```typescript
// PRIMA
coverUrl: album.albumImages[0]?.image ? this.buildImageFullPath(album.albumImages[0].image.id) : null

// DOPO — prendi primo item IMAGE
const firstImage = album.albumItems?.find(i => i.resourceType === 'IMAGE');
coverUrl: firstImage?.image ? this.buildImageFullPath(firstImage.image.id) : null
```

Per farlo, le query che caricano album devono includere:

```typescript
albumItems: {
  where: { resourceType: 'IMAGE' },
  orderBy: { order: 'asc' },
  take: 1,
  include: { image: { select: { id: true, storagePath: true } } },
}
```

---

## Phase 4 — AlbumController

**File:** `src/modules/album/album.controller.ts`

### Rimuovere endpoint obsoleti

```diff
- @Post(':albumId/images')       // addImagesToAlbum
- @Delete(':albumId/images')     // removeImagesFromAlbum
- @Get(':albumId/images')        // se esistente
```

### Aggiungere nuovi endpoint

```typescript
@Post(':albumId/items')
@ApiOperation({ summary: 'Add images and/or videos to album' })
@ApiBody({ type: AddAlbumItemsDto })
async addItems(
  @Param('albumId') albumId: string,
  @ClientId() clientId: string,
  @UserId() userId: string,
  @Body() dto: AddAlbumItemsDto,
): Promise<AddAlbumItemsResponseDto> {
  const result = await this.albumService.addItemsToAlbum(albumId, clientId, userId, dto.items);
  return plainToInstance(AddAlbumItemsResponseDto, result, { excludeExtraneousValues: true });
}

@Delete(':albumId/items')
@ApiOperation({ summary: 'Remove images and/or videos from album' })
@ApiBody({ type: RemoveAlbumItemsDto })
async removeItems(
  @Param('albumId') albumId: string,
  @ClientId() clientId: string,
  @UserId() userId: string,
  @Body() dto: RemoveAlbumItemsDto,
) {
  return this.albumService.removeItemsFromAlbum(albumId, clientId, userId, dto.items);
}

@Get(':albumId/items')
@ApiOperation({ summary: 'List album items ordered (filter by resourceType optional)' })
@ApiQuery({ name: 'resourceType', required: false, enum: AlbumResourceType })
@ApiQuery({ name: 'page', required: false, type: Number })
@ApiQuery({ name: 'perPage', required: false, type: Number })
async listItems(
  @Param('albumId') albumId: string,
  @ClientId() clientId: string,
  @Query() query: ListAlbumItemsDto,
) {
  return this.albumService.listAlbumItems(albumId, clientId, {
    resourceType: query.resourceType,
    page: query.page ?? 1,
    perPage: query.perPage ?? 20,
  });
}
```

---

## Phase 5 — Admin controller album

**File:** `src/modules/admin/controllers/albums-admin.controller.ts`

Stesso pattern: rimuovere vecchi endpoint immagini, aggiungere 3 endpoint `/items`.

Admin usa `force: true` in `addItemsToAlbum` per bypassare controllo owner.

Aggiornare `AdminAlbumResponseDto`:

```typescript
// Rimuovere: totalImages (o rinominare)
@ApiPropertyOptional() @Expose() totalItems?: number;    // totale immagini + video
@ApiPropertyOptional() @Expose() totalImages?: number;   // solo IMAGE
@ApiPropertyOptional() @Expose() totalVideos?: number;   // solo VIDEO
```

Per popolare i conteggi separati:

```typescript
_count: {
  select: {
    albumItems: true,
    albumTokens: { where: activeTokensWhere },
  }
}
// Per split per tipo: due count separati o una groupBy
```

---

## Phase 6 — Cleanup job album

**File:** `src/modules/job/album.cleanup.job.ts`

Verificare che il job usi `albumItems` invece di `albumImages` se fa pulizie basate su conteggio item.

---

## Phase 7 — AlbumModule

Nessun import aggiuntivo — `PrismaService` già accede a `prisma.albumItem`, `prisma.video`.

---

## Implementation Order

```
1. prisma/schema.prisma
   - Rimuovere AlbumImage
   - Aggiungere AlbumResourceType + AlbumItem
   - Aggiornare Album, Image, Video relations

2. pnpm run prisma:migrate
   - Aggiungere SQL di migrazione dati (se necessario) nella migration generata
   - Verificare che Prisma client si rigeneri

3. src/modules/album/dto/
   - album-item.dto.ts
   - add-album-items.dto.ts
   - remove-album-items.dto.ts
   - list-album-items.dto.ts
   - Aggiornare index.ts

4. album.service.ts
   - Sostituire tutti i riferimenti albumImages → albumItems
   - Aggiungere addItemsToAlbum, removeItemsFromAlbum, listAlbumItems, mapAlbumItem
   - Aggiornare coverUrl logic

5. album.controller.ts
   - Rimuovere endpoint /images
   - Aggiungere endpoint /items

6. admin/controllers/albums-admin.controller.ts
   - Stesso aggiornamento endpoint
   - Aggiornare AdminAlbumResponseDto

7. album.cleanup.job.ts
   - Aggiornare se referenzia albumImages

8. Test via Swagger
   - Crea album
   - Aggiungi immagine + video con order
   - GET /items → verifica ordinamento misto
   - DELETE /items per tipo
```

---

## Key Constraints

- `AlbumImage` droppata completamente — nessuna compat
- `@@unique([albumId, imageId])` + `@@unique([albumId, videoId])` — no duplicati
- Upsert → stessa risorsa aggiunta due volte aggiorna solo `order`
- `coverImageId` su `Album` resta `Image` — coverImage video fuori scope
- `AlbumToken` invariato — protegge album intero indipendente dal tipo item
- `order` unificato — immagini e video ordinati insieme nello stesso spazio
