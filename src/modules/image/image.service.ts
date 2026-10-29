import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  OnModuleDestroy,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '@/modules/prisma/prisma.service';
import {
  FLAT_DHASH,
  MAX_OPTIMIZE_ATTEMPTS,
  OPTIMIZE_RETRYABLE_WHERE,
  StorageService,
} from '@/modules/storage/storage.service';
import { Prisma } from '@prisma/client';
import { paginate, PageParams, PaginatedResult } from '@heyatom/nest-common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { lastValueFrom } from 'rxjs';
import { RouteHelperService } from '@/utils/route.utils';
import {
  ImageResponseDto,
  ShareLinkResponseDto,
  DeleteResponseDto,
  TinifyCompressionResponseDto,
} from './dto';
import {
  buildImageTagCreateInput,
  extractTagNames,
} from '@/modules/tag/tag.utils';
import { CreatorService } from '@/modules/creator/creator.service';
import {
  BLUR_QUALITY,
  buildSrcset,
  snapQuality,
  snapSize,
} from './image-variants';

// On-demand resizes cached per image; past this many, new ones are served but
// not stored, so arbitrary width/height/quality combinations can't fill the disk.
// Requests are snapped to a fixed grid first (image-variants.ts), so in practice
// a handful of variants per image covers every URL in use.
const MAX_CACHED_VARIANTS = 20;

export interface ImageFileOptions {
  width?: number;
  height?: number;
  format?: 'webp' | 'jpeg' | 'png';
  quality?: number;
  thumb?: boolean;
  /** The `?blur=1` rendition (plan 11): every other option but format and skipDiskRead is ignored. */
  blur?: boolean;
  /** Return only `filePath` when the file is already on disk (X-Accel-Redirect). */
  skipDiskRead?: boolean;
}

/** Previews per duplicate group. */
const DUPLICATE_PREVIEWS = 6;

export interface DuplicateImage {
  id: string;
  clientId: string;
  originalName: string;
  width: number;
  height: number;
  size: number;
  createdAt: Date;
  isPrivate: boolean;
  creatorExternalId: string;
}

export interface DuplicateGroup {
  dHash: string;
  clientId: string | null;
  count: number;
  totalBytes: number;
  images: DuplicateImage[];
}

/** `code` of the 400 thrown when the client's monthly Tinify slots are used up. */
export const TINIFY_LIMIT_REACHED = 'TINIFY_LIMIT_REACHED';

@Injectable()
export class ImageService implements OnModuleDestroy {
  private readonly logger = new Logger(ImageService.name);
  // ponytail: views buffered in memory, up to VIEW_FLUSH_MS of counts lost on a crash
  private pendingViews = new Map<string, number>();
  private readonly originalQuality: number;
  private readonly thumbnailQuality: number;
  private readonly thumbnailSize: number;

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private config: ConfigService,
    private httpService: HttpService,
    private creatorService: CreatorService,
    private route: RouteHelperService,
  ) {
    // Original should be high quality to preserve image fidelity
    this.originalQuality = parseInt(
      this.config.get('ORIGINAL_QUALITY') || '100',
    );
    // Thumbnail can use lower quality to reduce file size
    this.thumbnailQuality = parseInt(
      this.config.get('THUMBNAIL_QUALITY') || '70',
    );
    this.thumbnailSize = parseInt(this.config.get('THUMBNAIL_SIZE') || '800');
  }

  /**
   * Upload image
   */
  async uploadImage(
    clientId: string,
    externalId: string | undefined,
    file: Express.Multer.File,
    albumId?: string,
    tags?: string[],
    description?: string,
    isPrivate?: boolean,
    username?: string,
    blurPublic?: boolean,
  ) {
    const imageId = randomUUID();
    this.logger.debug(
      `[uploadImage] Start - ID: ${imageId}, Client: ${clientId}, Creator: ${externalId || 'system'}, File: ${file.originalname}, Size: ${file.size}, Type: ${file.mimetype}`,
    );

    try {
      // Validate file
      if (!file.mimetype.startsWith('image/')) {
        this.logger.warn(
          `[uploadImage] Invalid MIME type - ID: ${imageId}, Client: ${clientId}, Type: ${file.mimetype}`,
        );
        throw new BadRequestException('Only image files are allowed');
      }

      // Get client to retrieve domain
      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
        select: { domain: true },
      });
      if (!client) {
        this.logger.error(
          `[uploadImage] Client not found - ID: ${imageId}, Client: ${clientId}`,
        );
        throw new BadRequestException('Client not found');
      }
      const domain = client.domain || clientId;

      // Get or create creator
      let creator;
      if (externalId) {
        this.logger.debug(
          `[uploadImage] Resolving creator - ID: ${imageId}, External: ${externalId}, Username: ${username || 'auto'}`,
        );
        creator = await this.creatorService.resolveCreator(
          clientId,
          externalId,
          username,
        );
      } else {
        // If no externalId, use the system creator
        creator = await this.prisma.creator.findUnique({
          where: {
            clientId_externalId: {
              clientId,
              externalId: 'system',
            },
          },
        });
        if (!creator) {
          this.logger.error(
            `[uploadImage] System creator not found - ID: ${imageId}, Client: ${clientId}`,
          );
          throw new BadRequestException('System creator not found for client');
        }
      }
      const creatorId = creator.id;

      const imagePath = this.storage.getImagePath(domain, imageId);

      // Get metadata
      this.logger.debug(`[uploadImage] Extracting metadata - ID: ${imageId}`);
      const metadata = await this.storage.getImageMetadata(file.buffer);
      this.logger.debug(
        `[uploadImage] Metadata extracted - ID: ${imageId}, Dimensions: ${metadata.width}x${metadata.height}`,
      );

      // Convert to WebP for original (high quality)
      this.logger.debug(
        `[uploadImage] Encoding WebP + thumbnail - ID: ${imageId}, Quality: ${this.originalQuality}`,
      );
      const { original: webpBuffer, thumb: thumbBuffer } =
        await this.storage.encodeWebpWithThumbnail(
          file.buffer,
          this.originalQuality,
          this.thumbnailSize,
          this.thumbnailQuality,
        );

      // Save original
      this.logger.debug(
        `[uploadImage] Saving original - ID: ${imageId}, Size: ${webpBuffer.length} bytes`,
      );
      const originalPath = this.storage.getImageFilePath(
        domain,
        imageId,
        'original',
      );
      await this.storage.saveFile(originalPath, webpBuffer);

      const thumbnailPath = this.storage.getImageFilePath(
        domain,
        imageId,
        'thumb',
      );
      await this.storage.saveFile(thumbnailPath, thumbBuffer);
      this.logger.debug(
        `[uploadImage] Thumbnail saved - ID: ${imageId}, Size: ${thumbBuffer.length} bytes`,
      );

      // Pre-generated only where a site shows it (private, or blurPublic), so a
      // gallery's first visit doesn't fill the render queue. Public images get
      // it lazily on the first ?blur=1, a PATCH to private via warmBlurred.
      // Best-effort: GET ?blur=1 rebuilds a missing one.
      if (isPrivate || blurPublic)
        await this.storage
          .blurImage(thumbBuffer)
          .then((blurred) =>
            this.storage.saveFile(
              this.storage.getImageFilePath(domain, imageId, 'blurred'),
              blurred,
            ),
          )
          .catch((error: unknown) =>
            this.logger.warn(
              `[uploadImage] Blurred not saved - ID: ${imageId}: ${error instanceof Error ? error.message : error}`,
            ),
          );

      // Same input the backfill hashes (original.webp). Duplicate detection is
      // best-effort: a failure leaves dHash null rather than failing the upload.
      const dHash = await this.storage
        .computeDHash(webpBuffer)
        .catch((error: unknown) => {
          this.logger.warn(
            `[uploadImage] dHash failed - ID: ${imageId}: ${error instanceof Error ? error.message : error}`,
          );
          return null;
        });

      // Save to database (storagePath is the base path without extension)
      this.logger.debug(
        `[uploadImage] Saving to database - ID: ${imageId}, Tags: ${tags?.length || 0}, Private: ${isPrivate}`,
      );
      const imageTagsInput = buildImageTagCreateInput(clientId, tags);
      const image = await this.prisma.image.create({
        data: {
          id: imageId,
          clientId,
          creatorId,
          originalName: file.originalname,
          storagePath: imagePath,
          format: 'webp',
          width: metadata.width,
          height: metadata.height,
          size: webpBuffer.length,
          mimeType: 'image/webp',
          dHash,
          isOptimized: false,
          isPrivate: isPrivate || false,
          blurPublic: blurPublic || false,
          description: description || null,
          ...(imageTagsInput.length > 0 && {
            imageTags: { create: imageTagsInput },
          }),
        },
        include: {
          imageTags: {
            include: {
              tag: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      // Add to album if specified
      if (albumId) {
        this.logger.debug(
          `[uploadImage] Adding to album - ID: ${imageId}, Album: ${albumId}`,
        );
        await this.addImageToAlbum(imageId, albumId, clientId);
      }

      this.logger.log(
        `[uploadImage] Success - ID: ${imageId}, Client: ${clientId}, Creator: ${creatorId}, Size: ${webpBuffer.length}`,
      );
      return this.formatImageResponse(image);
    } catch (error) {
      this.logger.error(
        `[uploadImage] Failed - ID: ${imageId}, Client: ${clientId}, Error: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Get image by ID
   */
  async getImageById(imageId: string, clientId?: string, withTags = true) {
    const where: any = { id: imageId };
    if (clientId) {
      where.clientId = clientId;
    }

    // Tags cost two more queries; serving the file doesn't need them
    const image = await this.prisma.image.findFirst({
      where,
      include: {
        client: { select: { domain: true } },
        imageTags: withTags && {
          include: {
            tag: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!image) {
      throw new NotFoundException('Image not found');
    }

    return image;
  }

  /**
   * Resolve the file for a view of an already-loaded image (`image.client` must
   * carry `domain`). Thumbnails, untouched originals and cached resizes come from
   * disk; a resize not cached yet is made and stored under `{imageDir}/variants/`.
   * width/height/quality are snapped to the variant grid (`image-variants.ts`)
   * before anything else, so close values share one cached file.
   * `filePath` is set whenever the bytes exist on disk; `buffer` is set unless
   * `skipDiskRead` asked to leave an on-disk file unread.
   */
  async getImageFile(
    image: { id: string; clientId: string; client?: { domain: string | null } },
    {
      width: requestedWidth,
      height: requestedHeight,
      format = 'webp',
      quality: requestedQuality,
      thumb = false,
      blur = false,
      skipDiskRead = false,
    }: ImageFileOptions = {},
  ): Promise<{ mimeType: string; filePath?: string; buffer?: Buffer }> {
    const width = snapSize(requestedWidth);
    const height = snapSize(requestedHeight);
    const quality = snapQuality(requestedQuality);
    const domain = image.client?.domain || image.clientId;
    const fromDisk = async (filePath: string, mimeType: string) => ({
      mimeType,
      filePath,
      buffer: skipDiskRead ? undefined : await this.storage.readFile(filePath),
    });

    if (blur) {
      const blurred = await this.getBlurredFile(domain, image.id, fromDisk);
      if (format === 'webp') return blurred;
      // Converted per request, not cached: ≤ 480 px, and blurred.webp stays the one file.
      return {
        mimeType: `image/${format}`,
        buffer: await this.storage.resizeImage(
          blurred.buffer ?? (await this.storage.readFile(blurred.filePath!)),
          undefined,
          undefined,
          format,
          BLUR_QUALITY,
        ),
      };
    }

    if (thumb) {
      const thumbPath = this.storage.getImageFilePath(
        domain,
        image.id,
        'thumb',
      );
      if (await this.storage.fileExists(thumbPath)) {
        return fromDisk(thumbPath, 'image/webp');
      }
    }

    const originalPath = this.storage.getImageFilePath(
      domain,
      image.id,
      'original',
    );
    if (thumb || (!width && !height && format === 'webp')) {
      return fromDisk(originalPath, 'image/webp');
    }

    const mimeType = `image/${format}`;
    const variantsDir = this.storage.getImageVariantsPath(domain, image.id);
    const variantPath = `${variantsDir}/${width ?? ''}x${height ?? ''}-q${quality}.${format}`;
    if (await this.storage.fileExists(variantPath)) {
      return fromDisk(variantPath, mimeType);
    }

    const buffer = await this.storage.resizeImage(
      await this.storage.readFile(originalPath),
      width,
      height,
      format,
      quality,
    );
    if ((await this.storage.countEntries(variantsDir)) < MAX_CACHED_VARIANTS) {
      this.storage
        .saveFile(variantPath, buffer)
        .catch((e) =>
          this.logger.warn(`[getImageFile] Variant not cached: ${e.message}`),
        );
    }
    return { mimeType, buffer };
  }

  /**
   * `blurred.webp`, built from the thumb (the original only if the thumb is gone)
   * and stored when missing. A closed branch: every failure throws (422, or 503
   * from a full render queue) and the original is never served in its place.
   */
  private async getBlurredFile(
    domain: string,
    imageId: string,
    fromDisk: (
      filePath: string,
      mimeType: string,
    ) => Promise<{ mimeType: string; filePath: string; buffer?: Buffer }>,
  ): Promise<{ mimeType: string; filePath?: string; buffer?: Buffer }> {
    const blurredPath = this.storage.getImageFilePath(
      domain,
      imageId,
      'blurred',
    );
    if (await this.storage.fileExists(blurredPath)) {
      return fromDisk(blurredPath, 'image/webp');
    }
    return {
      mimeType: 'image/webp',
      buffer: await this.buildBlurred(domain, imageId, blurredPath),
    };
  }

  /**
   * Builds a missing `blurred.webp` after a PATCH made it reachable (private or
   * blurPublic), off the request: fire-and-forget, a failure only warns and
   * leaves it to the next ?blur=1.
   */
  private warmBlurred(image: {
    id: string;
    clientId: string;
    isPrivate: boolean;
    blurPublic: boolean;
    client?: { domain: string | null } | null;
  }): void {
    if (!image.isPrivate && !image.blurPublic) return;
    const domain = image.client?.domain || image.clientId;
    const blurredPath = this.storage.getImageFilePath(
      domain,
      image.id,
      'blurred',
    );
    void (async () => {
      if (!(await this.storage.fileExists(blurredPath)))
        await this.buildBlurred(domain, image.id, blurredPath);
    })().catch((e: unknown) =>
      this.logger.warn(
        `[warmBlurred] ${image.id}: ${e instanceof Error ? e.message : e}`,
      ),
    );
  }

  private async buildBlurred(
    domain: string,
    imageId: string,
    blurredPath: string,
  ): Promise<Buffer> {
    const thumbPath = this.storage.getImageFilePath(domain, imageId, 'thumb');
    const sourcePath = (await this.storage.fileExists(thumbPath))
      ? thumbPath
      : this.storage.getImageFilePath(domain, imageId, 'original');
    const source = await this.storage.readFile(sourcePath).catch(() => {
      throw new UnprocessableEntityException('Image file is not readable');
    });
    // Two concurrent misses both write: saveFile renames, the content is the same.
    const buffer = await this.storage.blurImage(source);
    this.storage
      .saveFile(blurredPath, buffer)
      .catch((e) =>
        this.logger.warn(`[getImageFile] Blurred not cached: ${e.message}`),
      );
    return buffer;
  }

  /**
   * List images with filtering
   */
  async listImages(
    filters: {
      clientId?: string;
      creatorId?: string;
      albumId?: string;
    },
    params: PageParams,
  ): Promise<PaginatedResult<ImageResponseDto>> {
    const where: any = {};
    if (filters.clientId) {
      where.clientId = filters.clientId;
    }
    if (filters.creatorId) {
      where.creatorId = filters.creatorId;
    }
    if (filters.albumId) {
      where.albumItems = {
        some: {
          albumId: filters.albumId,
          resourceType: 'IMAGE',
        },
      };
    }

    const [images, total] = await Promise.all([
      this.prisma.image.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip: params.skip,
        take: params.limit,
        include: {
          imageTags: {
            include: {
              tag: {
                select: {
                  name: true,
                },
              },
            },
          },
          creator: {
            select: {
              id: true,
              externalId: true,
              username: true,
            },
          },
          client: {
            select: {
              id: true,
              name: true,
              domain: true,
            },
          },
        },
      }),
      this.prisma.image.count({ where }),
    ]);

    return paginate(
      images.map((img) => this.formatImageResponse(img)),
      total,
      params,
    );
  }

  /**
   * Delete image
   */
  /** `id → clientId` for the given images; ids that don't exist are absent. */
  async findImageClients(ids: string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.image.findMany({
      where: { id: { in: ids } },
      select: { id: true, clientId: true },
    });
    return new Map(rows.map((r) => [r.id, r.clientId]));
  }

  async deleteImage(
    imageId: string,
    clientId: string,
  ): Promise<DeleteResponseDto> {
    this.logger.debug(
      `[deleteImage] Start - ID: ${imageId}, Client: ${clientId}`,
    );

    const image = await this.prisma.image.findFirst({
      where: {
        id: imageId,
        clientId,
      },
    });

    if (!image) {
      this.logger.warn(
        `[deleteImage] Image not found - ID: ${imageId}, Client: ${clientId}`,
      );
      throw new NotFoundException('Image not found');
    }

    try {
      // Get client to retrieve domain
      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
      });
      const domain = client?.domain || clientId;

      // Row first: a failed file delete leaves a stray dir for the orphan
      // sweep, never a row pointing at missing files.
      this.logger.debug(
        `[deleteImage] Deleting from database - ID: ${imageId}`,
      );
      await this.prisma.image.delete({
        where: { id: imageId },
      });

      const imagePath = this.storage.getImagePath(domain, imageId);
      this.logger.debug(
        `[deleteImage] Deleting files - ID: ${imageId}, Path: ${imagePath}`,
      );
      try {
        await this.storage.deleteDirectory(imagePath);
      } catch (error) {
        this.logger.warn(
          `[deleteImage] Files left for the orphan sweep - ID: ${imageId}: ${error.message}`,
        );
      }

      this.logger.log(
        `[deleteImage] Success - ID: ${imageId}, Client: ${clientId}, Size: ${image.size} bytes`,
      );
      return this.formatDeleteResponse('Image deleted successfully');
    } catch (error) {
      this.logger.error(
        `[deleteImage] Failed - ID: ${imageId}, Error: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Add image to album
   */
  async addImageToAlbum(imageId: string, albumId: string, clientId: string) {
    // Verify image and album belong to same client
    await this.getImageById(imageId, clientId); // Only for validation, no need to assign
    const album = await this.prisma.album.findFirst({
      where: { id: albumId, clientId },
    });

    if (!album) {
      throw new NotFoundException('Album not found');
    }

    const maxOrder = await this.prisma.albumItem.findFirst({
      where: { albumId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    return this.prisma.albumItem.create({
      data: {
        albumId,
        imageId,
        resourceType: 'IMAGE',
        order: (maxOrder?.order || 0) + 1,
      },
    });
  }

  /**
   * Get images not optimized, oldest first. Rows that already failed
   * MAX_OPTIMIZE_ATTEMPTS times are skipped, so a batch of broken files can't
   * starve the rest of the queue.
   */
  async getUnoptimizedImages() {
    return this.prisma.image.findMany({
      where: OPTIMIZE_RETRYABLE_WHERE,
      orderBy: { createdAt: 'asc' },
      take: 50, // Process in batches
    });
  }

  /**
   * Count a failed optimization attempt. Returns true once the image has used
   * up its attempts and will no longer be picked up.
   */
  async recordOptimizeFailure(imageId: string): Promise<boolean> {
    // updateMany: the row may have been deleted mid-batch
    const [image] = await this.prisma.image.updateManyAndReturn({
      where: { id: imageId },
      data: { optimizeAttempts: { increment: 1 } },
      select: { optimizeAttempts: true },
    });
    return !!image && image.optimizeAttempts >= MAX_OPTIMIZE_ATTEMPTS;
  }

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

  /**
   * Mark image as optimized
   */
  async markAsOptimized(imageId: string, size: number) {
    return this.prisma.image.update({
      where: { id: imageId },
      data: {
        isOptimized: true,
        optimizedAt: new Date(),
        // The original was re-encoded: the upload-time size no longer holds
        size,
      },
    });
  }

  /**
   * Update image metadata
   */
  async updateImageMetadata(
    imageId: string,
    clientId: string,
    creatorId: string,
    tags?: string[],
    description?: string,
    isPrivate?: boolean,
    blurPublic?: boolean,
  ) {
    this.logger.debug(
      `[updateImageMetadata] Start - ID: ${imageId}, Client: ${clientId}, Creator: ${creatorId}, Tags: ${tags?.length || 0}`,
    );

    const image = await this.findOwnedImage(imageId, clientId, creatorId);

    if (!image) {
      this.logger.warn(
        `[updateImageMetadata] Image not found - ID: ${imageId}, Client: ${clientId}, Creator: ${creatorId}`,
      );
      throw new NotFoundException('Image not found');
    }

    const imageTagsInput =
      tags !== undefined ? buildImageTagCreateInput(clientId, tags) : undefined;
    const updatedImage = await this.prisma.image.update({
      where: { id: imageId },
      data: {
        ...(description !== undefined && { description }),
        ...(isPrivate !== undefined && { isPrivate }),
        ...(blurPublic !== undefined && { blurPublic }),
        ...(imageTagsInput !== undefined && {
          imageTags: {
            deleteMany: {},
            ...(imageTagsInput.length > 0 && { create: imageTagsInput }),
          },
        }),
      },
      include: {
        imageTags: {
          include: {
            tag: {
              select: {
                name: true,
              },
            },
          },
        },
        client: { select: { domain: true } },
      },
    });
    // warmBlurred reads the updated row: an already-blurPublic image PATCHed
    // to isPrivate=false still needs its preview.
    if (isPrivate !== undefined || blurPublic !== undefined)
      this.warmBlurred(updatedImage);

    this.logger.log(
      `[updateImageMetadata] Success - ID: ${imageId}, Client: ${clientId}`,
    );
    return this.formatImageResponse(updatedImage);
  }

  /**
   * Count a view. Buffered and written in one statement every few seconds:
   * one UPDATE per view was a write on the hottest read path.
   */
  async incrementViews(imageId: string) {
    this.pendingViews.set(imageId, (this.pendingViews.get(imageId) ?? 0) + 1);
  }

  @Interval(10_000)
  async flushViews() {
    if (this.pendingViews.size === 0) return;
    const batch = this.pendingViews;
    this.pendingViews = new Map();
    // Raw SQL on purpose: Prisma would bump updatedAt, which feeds the ETag
    await this.prisma.$executeRaw`
      UPDATE images AS i SET views = i.views + v.n
      FROM unnest(${[...batch.keys()]}::text[], ${[...batch.values()]}::int[]) AS v(id, n)
      WHERE i.id = v.id`.catch((e) =>
      this.logger.warn(
        `[flushViews] Dropped ${batch.size} counts: ${e.message}`,
      ),
    );
  }

  async onModuleDestroy() {
    await this.flushViews();
  }

  /**
   * Increment downloads counter (raw SQL so updatedAt, and the ETag, stay put)
   */
  async incrementDownloads(imageId: string, clientId: string) {
    await this.prisma.$executeRaw`
      UPDATE images SET downloads = downloads + 1
      WHERE id = ${imageId} AND "clientId" = ${clientId}`;
  }

  /**
   * The internal Creator id behind an X-User-Id: `image.creatorId` holds the
   * internal one, so an owner check never compares it with the external id.
   */
  private async ownerCreatorId(
    clientId: string,
    externalId: string,
  ): Promise<string | null> {
    const creator = await this.prisma.creator.findUnique({
      where: { clientId_externalId: { clientId, externalId } },
      select: { id: true },
    });
    return creator?.id ?? null;
  }

  /** The image if X-User-Id owns it within the client, else null. */
  private async findOwnedImage(
    imageId: string,
    clientId: string,
    externalId: string,
  ) {
    const creatorId = await this.ownerCreatorId(clientId, externalId);
    if (!creatorId) return null;
    return this.prisma.image.findFirst({
      where: { id: imageId, clientId, creatorId },
    });
  }

  /**
   * Create share link for image
   */
  async createShareLink(
    imageId: string,
    clientId: string,
    creatorId: string,
    expiresAt?: Date,
  ): Promise<ShareLinkResponseDto> {
    this.logger.debug(
      `[createShareLink] Start - ID: ${imageId}, Client: ${clientId}, Creator: ${creatorId}, Expires: ${expiresAt?.toISOString() || 'never'}`,
    );

    const image = await this.findOwnedImage(imageId, clientId, creatorId);

    if (!image) {
      this.logger.warn(
        `[createShareLink] Image not found - ID: ${imageId}, Client: ${clientId}, Creator: ${creatorId}`,
      );
      throw new NotFoundException('Image not found');
    }

    const shareLink = await this.createShareLinkFor(imageId, expiresAt);

    this.logger.log(
      `[createShareLink] Success - ID: ${imageId}, Link: ${shareLink.id}, Expires: ${expiresAt?.toISOString() || 'never'}`,
    );
    return this.formatShareLinkResponse(shareLink);
  }

  /**
   * Create the link row, no ownership check: callers authorize first
   * (`findOwnedImage` on the client path, client scope on the admin one).
   */
  createShareLinkFor(imageId: string, expiresAt?: Date) {
    return this.prisma.imageShareLink.create({
      data: { imageId, readToken: randomUUID(), expiresAt: expiresAt || null },
    });
  }

  /**
   * Get share links for an image
   */
  async getShareLinks(
    imageId: string,
    clientId: string,
    creatorId: string,
  ): Promise<ShareLinkResponseDto[]> {
    const image = await this.findOwnedImage(imageId, clientId, creatorId);

    if (!image) {
      throw new NotFoundException('Image not found');
    }

    const shareLinks = await this.prisma.imageShareLink.findMany({
      where: { imageId },
      orderBy: { createdAt: 'desc' },
    });

    return shareLinks.map((link) => this.formatShareLinkResponse(link));
  }

  /**
   * Delete share link
   */
  async deleteShareLink(
    shareLinkId: string,
    clientId: string,
    creatorId: string,
  ): Promise<DeleteResponseDto> {
    this.logger.debug(
      `[deleteShareLink] Start - LinkID: ${shareLinkId}, Client: ${clientId}, Creator: ${creatorId}`,
    );

    const shareLink = await this.prisma.imageShareLink.findUnique({
      where: { id: shareLinkId },
      include: { image: true },
    });

    if (!shareLink) {
      this.logger.warn(
        `[deleteShareLink] Share link not found - LinkID: ${shareLinkId}, Client: ${clientId}`,
      );
      throw new NotFoundException('Share link not found');
    }

    if (
      shareLink.image.clientId !== clientId ||
      shareLink.image.creatorId !==
        (await this.ownerCreatorId(clientId, creatorId))
    ) {
      this.logger.warn(
        `[deleteShareLink] Access denied - LinkID: ${shareLinkId}, Client: ${clientId}, Creator: ${creatorId}, ImageClient: ${shareLink.image.clientId}`,
      );
      throw new NotFoundException('Share link not found');
    }

    await this.prisma.imageShareLink.delete({
      where: { id: shareLinkId },
    });

    this.logger.log(
      `[deleteShareLink] Success - LinkID: ${shareLinkId}, ImageID: ${shareLink.imageId}`,
    );
    return this.formatDeleteResponse('Share link deleted successfully');
  }

  /**
   * Get image by share token
   */
  async getImageByShareToken(readToken: string) {
    const shareLink = await this.prisma.imageShareLink.findUnique({
      where: { readToken },
      include: {
        image: {
          include: {
            client: { select: { domain: true } },
            imageTags: {
              include: {
                tag: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!shareLink) {
      throw new NotFoundException('Share link not found');
    }

    // Check if link has expired
    if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
      throw new BadRequestException('Share link has expired');
    }

    return shareLink.image;
  }

  /**
   * Check if creator has access to image (for private images)
   */
  async checkImageAccess(
    image: {
      id: string;
      clientId: string;
      creatorId: string;
      isPrivate: boolean;
    },
    clientId: string,
    externalCreatorId?: string,
    shareToken?: string,
  ): Promise<boolean> {
    // If image is not private, everyone has access
    if (!image.isPrivate) {
      return true;
    }

    // The owner, identified by X-User-Id within the image's own client.
    // image.creatorId is the internal Creator id, so resolve the external one.
    if (externalCreatorId && image.clientId === clientId) {
      const creator = await this.prisma.creator.findUnique({
        where: {
          clientId_externalId: { clientId, externalId: externalCreatorId },
        },
        select: { id: true },
      });
      if (creator?.id === image.creatorId) {
        return true;
      }
    }

    // Check if valid share token is provided
    if (shareToken) {
      const shareLink = await this.prisma.imageShareLink.findUnique({
        where: { readToken: shareToken },
      });

      if (shareLink && shareLink.imageId === image.id) {
        // Check if link has not expired
        if (!shareLink.expiresAt || shareLink.expiresAt > new Date()) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Validate that creatorId is present
   * @throws BadRequestException if creatorId is missing
   */
  validateCreatorExternalId(creatorId: string | undefined): string {
    if (!creatorId) {
      throw new BadRequestException(
        'Creator ID is required (X-User-Id header)',
      );
    }
    return creatorId;
  }

  /**
   * Validate image access for private images
   * @throws ForbiddenException if access is denied
   */
  async validateImageAccess(
    image: any,
    imageId: string,
    clientId: string | undefined,
    externalCreatorId: string | undefined,
    token?: string,
  ): Promise<void> {
    if (!image.isPrivate) {
      return;
    }

    if (!clientId) {
      throw new ForbiddenException(
        'This image is private. Authentication required.',
      );
    }

    const hasAccess = await this.checkImageAccess(
      image,
      clientId,
      externalCreatorId,
      token,
    );

    if (!hasAccess) {
      throw new ForbiddenException(
        token
          ? 'Invalid token or access denied.'
          : 'You do not have access to this private image.',
      );
    }
  }

  /**
   * Get image metadata for info endpoint
   */
  async getImageMetadata(image: any): Promise<ImageResponseDto> {
    return this.formatImageResponse(image);
  }

  /**
   * Format image response using class-transformer
   */
  private formatImageResponse(image: any): ImageResponseDto {
    const url = this.route.path('images', image.id);
    const thumbnailUrl = this.route.path('images', image.id) + '?thumb=true';
    const fullPath = this.route.fullUrl('images', image.id);

    return plainToInstance(
      ImageResponseDto,
      {
        ...image,
        tags: extractTagNames(image),
        url,
        thumbnailUrl,
        fullPath,
        // Private images need a header or token, which `<img srcset>` can't send.
        srcset: image.isPrivate
          ? undefined
          : buildSrcset(fullPath, image.width),
      },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Format share link response using class-transformer
   */
  private formatShareLinkResponse(shareLink: any): ShareLinkResponseDto {
    return plainToInstance(
      ShareLinkResponseDto,
      {
        ...shareLink,
        // GET /images/:id resolves `?token=` as a share link first.
        shareUrl: `${this.route.path('images', shareLink.imageId)}?token=${shareLink.readToken}`,
      },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Format delete response using class-transformer
   */
  private formatDeleteResponse(message: string): DeleteResponseDto {
    return plainToInstance(
      DeleteResponseDto,
      { success: true, message },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Admin paginated image listing — accepts a pre-built Prisma where clause
   * and adds admin-specific includes (creator, client join).
   */
  async findAdminImages(
    where: any,
    params: PageParams,
    sort?: { field: string; order: 'asc' | 'desc' },
    actorId?: string,
  ) {
    const orderBy: any = sort
      ? { [sort.field]: sort.order }
      : { createdAt: 'desc' };

    const [images, total] = await Promise.all([
      this.prisma.image.findMany({
        where,
        orderBy,
        skip: params.skip,
        take: params.limit,
        include: {
          imageTags: { include: { tag: { select: { name: true } } } },
          creator: { select: { externalId: true, username: true } },
          client: { select: { name: true, domain: true } },
        },
      }),
      this.prisma.image.count({ where }),
    ]);

    let bookmarkedIds = new Set<string>();
    if (actorId && images.length > 0) {
      const bookmarks = await this.prisma.adminImageBookmark.findMany({
        where: { actorId, imageId: { in: images.map((i) => i.id) } },
        select: { imageId: true },
      });
      bookmarkedIds = new Set(bookmarks.map((b) => b.imageId));
    }

    const data = images.map((image) => ({
      ...image,
      tags: extractTagNames(image),
      fullPath: this.route.fullUrl('images', image.id),
      isBookmarked: bookmarkedIds.has(image.id),
    }));

    return paginate(data, total, params);
  }

  /**
   * Admin full image fetch — includes albums, active share-link count, creator.
   * Returns null if not found.
   */
  async findAdminImageById(imageId: string, actorId?: string) {
    const now = new Date();
    const image = await this.prisma.image.findUnique({
      where: { id: imageId },
      include: {
        imageTags: { include: { tag: { select: { name: true } } } },
        client: { select: { id: true, name: true, domain: true } },
        // `id` too: the console links the creator to its record by it.
        creator: { select: { id: true, externalId: true, username: true } },
        albumItems: {
          where: { resourceType: 'IMAGE' },
          include: {
            album: {
              select: {
                id: true,
                name: true,
                externalAlbumId: true,
                isPublic: true,
              },
            },
          },
        },
        _count: {
          select: {
            shareLinks: {
              where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            },
          },
        },
      },
    });

    if (!image) return null;

    let isBookmarked = false;
    if (actorId) {
      const bookmark = await this.prisma.adminImageBookmark.findUnique({
        where: { actorId_imageId: { actorId, imageId } },
        select: { imageId: true },
      });
      isBookmarked = !!bookmark;
    }

    return { ...image, isBookmarked };
  }

  /**
   * Images sharing `dHash` with this one in `clientIds`, itself excluded.
   * 0 for an unhashed or flat image (flat ones "match" every other flat one).
   */
  async countDuplicates(
    image: { id: string; dHash: string | null },
    clientIds: string[],
  ): Promise<number> {
    if (!image.dHash || image.dHash === FLAT_DHASH) return 0;
    return this.prisma.image.count({
      where: {
        dHash: image.dHash,
        clientId: { in: clientIds },
        id: { not: image.id },
      },
    });
  }

  /**
   * Groups of images with the same dHash inside `clientIds`, biggest first.
   * Key `(clientId, dHash)`, or `dHash` alone with `crossClient` (the caller
   * checks who may ask for that). Nothing outside `clientIds` is ever read, so
   * neither a group nor a count can reveal a copy the admin does not see.
   */
  async findDuplicateGroups(
    clientIds: string[],
    filter: { creatorId?: string; crossClient: boolean },
    page: { page: number; limit: number; skip: number },
  ): Promise<PaginatedResult<DuplicateGroup>> {
    const scope = Prisma.sql`"clientId" = ANY(${clientIds}::text[]) AND "dHash" IS NOT NULL AND "dHash" <> ${FLAT_DHASH}${
      filter.creatorId
        ? Prisma.sql` AND "creatorId" = ${filter.creatorId}`
        : Prisma.empty
    }`;
    const key = filter.crossClient
      ? Prisma.sql`"dHash"`
      : Prisma.sql`"clientId", "dHash"`;

    const [groups, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<
        Omit<DuplicateGroup, 'images'>[]
      >`SELECT ${filter.crossClient ? Prisma.sql`NULL::text` : Prisma.sql`"clientId"`} AS "clientId",
          "dHash", count(*)::int AS count, sum(size)::float8 AS "totalBytes"
        FROM images WHERE ${scope}
        GROUP BY ${key} HAVING count(*) > 1
        ORDER BY count DESC, "totalBytes" DESC, "dHash"
        LIMIT ${page.limit} OFFSET ${page.skip}`,
      this.prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total
        FROM (SELECT 1 FROM images WHERE ${scope} GROUP BY ${key} HAVING count(*) > 1) g`,
    ]);

    // ponytail: loads every member of the page's groups to keep 6 each; fine for
    // tens of copies, a ROW_NUMBER() window if a group ever runs into thousands.
    const members = groups.length
      ? await this.prisma.image.findMany({
          where: {
            dHash: { in: groups.map((g) => g.dHash) },
            clientId: { in: clientIds },
            ...(filter.creatorId && { creatorId: filter.creatorId }),
          },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            clientId: true,
            dHash: true,
            originalName: true,
            width: true,
            height: true,
            size: true,
            createdAt: true,
            isPrivate: true,
            creator: { select: { externalId: true } },
          },
        })
      : [];

    const groupKey = (clientId: string | null, dHash: string | null) =>
      filter.crossClient ? `${dHash}` : `${clientId}:${dHash}`;
    const previews = new Map<string, DuplicateImage[]>();
    for (const { dHash, creator, ...image } of members) {
      const k = groupKey(image.clientId, dHash);
      const list = previews.get(k) ?? [];
      if (list.length < DUPLICATE_PREVIEWS) {
        list.push({ ...image, creatorExternalId: creator.externalId });
      }
      previews.set(k, list);
    }

    return paginate(
      groups.map((g) => ({
        ...g,
        images: previews.get(groupKey(g.clientId, g.dHash)) ?? [],
      })),
      total,
      page,
    );
  }

  /**
   * Admin image update — accepts a fully-formed Prisma data object
   * (supports originalName, isPrivate, description, imageTags).
   * Returns the updated image with tags and creator for DTO mapping.
   */
  async adminUpdateImage(imageId: string, data: Record<string, any>) {
    const image = await this.prisma.image.update({
      where: { id: imageId },
      data,
      include: {
        imageTags: { include: { tag: { select: { name: true } } } },
        client: { select: { id: true, name: true, domain: true } },
        creator: { select: { id: true, externalId: true, username: true } },
      },
    });
    if (data.isPrivate) this.warmBlurred(image);
    return image;
  }

  /**
   * Delete expired share links
   */
  async deleteExpiredShareLinks(): Promise<number> {
    const result = await this.prisma.imageShareLink.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    return result.count;
  }

  /**
   * Rebuild the thumbnail from the stored original and drop cached variants,
   * keeping id and original. `updatedAt` moves last: it is in the ETag, and moving
   * it first would let a GET in between pin the old thumb under the new tag.
   */
  async regenerateRenditions(image: {
    id: string;
    clientId: string;
    client?: { domain: string | null } | null;
  }): Promise<{ id: string; updatedAt: Date }> {
    const domain = image.client?.domain || image.clientId;
    const originalPath = this.storage.getImageFilePath(
      domain,
      image.id,
      'original',
    );
    if (!(await this.storage.fileExists(originalPath))) {
      throw new NotFoundException('Original file missing');
    }
    // 422 on an unreadable original, 500 on a failed thumb write (StorageService)
    await this.storage.regenerateImageThumb(
      domain,
      image.id,
      this.thumbnailSize,
      this.thumbnailQuality,
    );
    return this.prisma.image.update({
      where: { id: image.id },
      data: { updatedAt: new Date() },
      select: { id: true, updatedAt: true },
    });
  }

  /**
   * Compress image with Tinify (TinyPNG) API
   * Replaces the original image and regenerates thumbnail
   */
  async compressImageWithTinify(
    imageId: string,
  ): Promise<TinifyCompressionResponseDto> {
    this.logger.debug(`[compressImageWithTinify] Start - ID: ${imageId}`);

    // Get image from database
    const image = await this.prisma.image.findUnique({
      where: { id: imageId },
      include: {
        imageTags: {
          include: {
            tag: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!image) {
      this.logger.warn(
        `[compressImageWithTinify] Image not found - ID: ${imageId}`,
      );
      throw new NotFoundException('Image not found');
    }

    // Check if image was already compressed with Tinify to avoid reprocessing
    if (image.tinifyOptimized) {
      this.logger.warn(
        `[compressImageWithTinify] Image already compressed with Tinify - ID: ${imageId}`,
      );
      throw new BadRequestException(
        'This image has already been compressed with Tinify',
      );
    }

    // The hourly optimize job would re-encode Tinify's output at OPTIMIZE_QUALITY,
    // throwing away a compression we paid for
    if (!image.isOptimized) {
      throw new BadRequestException(
        'This image has not been optimized yet, retry after the next optimize run',
      );
    }

    // ponytail: no per-image claim, so a manual call racing TinifyAutoJob on the same
    // image can pay Tinify twice. Rare (one console click vs. one hourly pick); accepted.

    // Get client to retrieve Tinify configuration
    const client = await this.prisma.client.findUnique({
      where: { id: image.clientId },
    });

    if (!client) {
      this.logger.error(
        `[compressImageWithTinify] Client not found - ID: ${image.clientId}`,
      );
      throw new NotFoundException('Client not found');
    }

    // Check if Tinify is enabled for this client
    if (!client.tinifyActive) {
      this.logger.error(
        `[compressImageWithTinify] Tinify not enabled for client - ID: ${client.id}`,
      );
      throw new BadRequestException(
        'Tinify compression is not enabled for this client',
      );
    }

    // Get API key from client
    const tinifyKey = client.tinifyApiKey;
    if (!tinifyKey || !tinifyKey.trim()) {
      this.logger.error(
        `[compressImageWithTinify] Tinify API key not configured for client - ID: ${client.id}`,
      );
      throw new BadRequestException(
        'Tinify API key not configured for this client',
      );
    }

    // Quota slot taken (and not yet spent at Tinify): released if we fail before Tinify bills it
    let reserved = false;
    let billed = false;

    try {
      const domain = client.domain || image.clientId;

      // Read the current original file
      const originalPath = this.storage.getImageFilePath(
        domain,
        imageId,
        'original',
      );
      const originalBuffer = await this.storage.readFile(originalPath);
      const originalSize = originalBuffer.length;

      // Tinify would hand back a single frame and overwrite the original
      if (await this.storage.isAnimated(originalBuffer)) {
        throw new BadRequestException(
          'Tinify compression is not supported for animated images',
        );
      }

      this.logger.debug(
        `[compressImageWithTinify] Original size: ${originalSize} bytes - ID: ${imageId}`,
      );

      // Reserve a slot of the monthly limit (configurable per client, default 500) in one
      // conditional UPDATE: a read-then-increment would let parallel requests (a whole
      // console page selected at once) all pass the check and overshoot the limit.
      const { count } = await this.prisma.client.updateMany({
        where: {
          id: client.id,
          currentTinifyUsage: {
            lt: this.prisma.client.fields.currentTinifyLimit,
          },
        },
        data: { currentTinifyUsage: { increment: 1 } },
      });
      if (count === 0) {
        this.logger.warn(
          `[compressImageWithTinify] Monthly Tinify limit reached for client - ID: ${client.id}, Limit: ${client.currentTinifyLimit}`,
        );
        throw new BadRequestException({
          code: TINIFY_LIMIT_REACHED,
          message: `Monthly Tinify compression limit reached (${client.currentTinifyLimit}). Limit will reset next month.`,
        });
      }
      reserved = true;

      // Prepare Basic Auth header (api:YOUR_API_KEY)
      const authString = Buffer.from(`api:${tinifyKey.trim()}`).toString(
        'base64',
      );
      const headers = {
        Authorization: `Basic ${authString}`,
        'Content-Type': 'application/octet-stream',
      };

      // Step 1: Upload image to Tinify API
      this.logger.debug(
        `[compressImageWithTinify] Uploading to Tinify API - ID: ${imageId}`,
      );
      const uploadResponse = await lastValueFrom(
        this.httpService.post('https://api.tinify.com/shrink', originalBuffer, {
          headers,
          responseType: 'json',
        }),
      );
      // Any 2xx means Tinify counted it, even with a body we can't use: no refund from here
      billed = true;
      await this.syncTinifyUsage(client.id, uploadResponse.headers);

      // Check for successful upload
      if (
        !uploadResponse.data ||
        !uploadResponse.data.output ||
        !uploadResponse.data.output.url
      ) {
        this.logger.error(
          `[compressImageWithTinify] Invalid response from Tinify API - ID: ${imageId}`,
        );
        throw new BadRequestException('Failed to compress image with Tinify');
      }

      const compressedUrl = uploadResponse.data.output.url;
      // No gain: keep our file. Still marked compressed (and counted): Tinify billed it.
      const kept = uploadResponse.data.output.size >= originalSize;
      const compressedSize = kept
        ? originalSize
        : uploadResponse.data.output.size;
      const savedBytes = originalSize - compressedSize;
      const savedPercentage = ((savedBytes / originalSize) * 100).toFixed(2);

      this.logger.debug(
        `[compressImageWithTinify] Compressed size: ${compressedSize} bytes (saved ${savedBytes} bytes, ${savedPercentage}%) - ID: ${imageId}`,
      );

      if (kept) {
        this.logger.debug(
          `[compressImageWithTinify] No gain, original kept - ID: ${imageId}`,
        );
      } else {
        // Step 2: Download compressed image
        this.logger.debug(
          `[compressImageWithTinify] Downloading compressed image - ID: ${imageId}`,
        );
        const downloadResponse = await lastValueFrom(
          this.httpService.get(compressedUrl, {
            headers: {
              Authorization: `Basic ${authString}`,
            },
            responseType: 'arraybuffer',
          }),
        );

        const compressedBuffer = Buffer.from(downloadResponse.data);

        // Save compressed file, replacing the original
        await this.storage.saveFile(originalPath, compressedBuffer);
        await this.storage.clearImageVariants(domain, imageId);
        this.logger.debug(
          `[compressImageWithTinify] Compressed file saved - ID: ${imageId}`,
        );

        // Regenerate thumbnail from compressed image
        this.logger.debug(
          `[compressImageWithTinify] Regenerating thumbnail - ID: ${imageId}`,
        );
        const thumbBuffer = await this.storage.createThumbnail(
          compressedBuffer,
          this.thumbnailSize,
          this.thumbnailQuality,
        );
        const thumbnailPath = this.storage.getImageFilePath(
          domain,
          imageId,
          'thumb',
        );
        await this.storage.saveFile(thumbnailPath, thumbBuffer);
        this.logger.debug(
          `[compressImageWithTinify] Thumbnail regenerated - ID: ${imageId}`,
        );
      }

      // Update database with new size and mark as Tinify-optimized (usage counted at reservation)
      const updatedImage = await this.prisma.image.update({
        where: { id: imageId },
        data: {
          size: compressedSize,
          tinifyOptimized: true,
        },
        include: {
          imageTags: {
            include: {
              tag: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      this.logger.log(
        `[compressImageWithTinify] Success - ID: ${imageId}, Saved: ${savedBytes} bytes (${savedPercentage}%)`,
      );

      const imageResponse = this.formatImageResponse(updatedImage);

      return plainToInstance(
        TinifyCompressionResponseDto,
        {
          image: imageResponse,
          compressionStats: {
            originalSize,
            compressedSize,
            savedBytes,
            savedPercentage: `${savedPercentage}%`,
          },
        },
        { excludeExtraneousValues: true },
      );
    } catch (error) {
      // Log detailed error information
      if (error.response) {
        this.logger.error(
          `[compressImageWithTinify] Tinify API error - ID: ${imageId}, Status: ${error.response.status}, Message: ${JSON.stringify(error.response.data)}`,
        );
      } else {
        this.logger.error(
          `[compressImageWithTinify] Failed - ID: ${imageId}, Error: ${error.message}`,
        );
      }
      // Tinify never compressed it: give the slot back. Once billed, it stays spent.
      if (reserved && !billed) {
        await this.prisma.client
          .updateMany({
            where: { id: client.id, currentTinifyUsage: { gt: 0 } },
            data: { currentTinifyUsage: { decrement: 1 } },
          })
          .catch((releaseError) =>
            this.logger.warn(
              `[compressImageWithTinify] Failed to release Tinify slot for client ${client.id}: ${releaseError.message}`,
            ),
          );
      }
      if (error.response?.status === 429) {
        // The key's account is out of compressions: nothing retries until the monthly reset
        await this.prisma.client
          .update({
            where: { id: client.id },
            data: { currentTinifyUsage: client.currentTinifyLimit },
          })
          .catch((syncError) =>
            this.logger.warn(
              `[compressImageWithTinify] Failed to exhaust Tinify usage for client ${client.id}: ${syncError.message}`,
            ),
          );
      } else {
        await this.syncTinifyUsage(client.id, error.response?.headers);
      }
      throw error;
    }
  }

  /**
   * Raise the local counter to Tinify's `Compression-Count` (the key's real count this
   * calendar month): covers compressions made outside FileHarbor with the same key and a
   * monthly reset out of step with theirs. Never lowers it.
   */
  private async syncTinifyUsage(
    clientId: string,
    headers?: Record<string, unknown>,
  ): Promise<void> {
    const count = Number(headers?.['compression-count']);
    if (!Number.isInteger(count)) return;
    await this.prisma.client
      .updateMany({
        where: { id: clientId, currentTinifyUsage: { lt: count } },
        data: { currentTinifyUsage: count },
      })
      .catch((error) =>
        this.logger.warn(
          `[compressImageWithTinify] Failed to sync Tinify usage for client ${clientId}: ${error.message}`,
        ),
      );
  }
}
