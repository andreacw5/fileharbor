import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import { paginate, PageParams, PaginatedResult } from '@heyatom/nest-common';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { StorageService } from '@/modules/storage/storage.service';
import { CreatorService } from '@/modules/creator/creator.service';
import { RouteHelperService } from '@/utils/route.utils';
import {
  detectFileType,
  FileExt,
  FILE_TYPES,
  MAGIC_BYTES,
  unsupportedFileType,
} from './file-types';
import { signFileLink, verifyFileLink } from './file-link';
import { FileLinkResponseDto, FileResponseDto } from './dto/file.dto';

const WITH_CREATOR = {
  creator: { select: { externalId: true } },
} satisfies Prisma.StoredFileInclude;

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly creatorService: CreatorService,
    private readonly route: RouteHelperService,
    private readonly config: ConfigService,
  ) {}

  async uploadFile(
    clientId: string,
    externalId: string | undefined,
    file: Express.Multer.File,
    isPrivate = false,
  ): Promise<FileResponseDto> {
    try {
      const head = Buffer.alloc(MAGIC_BYTES);
      const fd = await fs.open(file.path, 'r');
      await fd.read(head, 0, MAGIC_BYTES, 0).finally(() => fd.close());
      const ext = detectFileType(file.originalname, head);
      if (!ext) throw unsupportedFileType();

      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
        select: { domain: true },
      });
      if (!client) throw new BadRequestException('Client not found');
      const domain = client.domain || clientId;
      const creator = await this.creatorService.resolveCreator(
        clientId,
        externalId || 'system',
      );

      const id = randomUUID();
      // Files before the row: a failed insert leaves a dir for the orphan sweep
      await this.storage.copyFromTemp(
        file.path,
        this.storage.getFilePath(domain, id, ext),
      );
      const row = await this.prisma.storedFile.create({
        data: {
          id,
          clientId,
          creatorId: creator.id,
          originalName: file.originalname,
          storagePath: `${domain}/files/${id}`,
          mimeType: FILE_TYPES[ext].mimeType,
          size: file.size,
          isPrivate,
        },
        include: WITH_CREATOR,
      });
      this.logger.log(`[uploadFile] Success - ID: ${id}, Client: ${clientId}`);
      return this.format(row);
    } finally {
      await fs.unlink(file.path).catch(() => {});
    }
  }

  /** Shared by the client list (where = clientId + creator) and the admin one. */
  async listFiles(
    where: Prisma.StoredFileWhereInput,
    params: PageParams,
  ): Promise<PaginatedResult<FileResponseDto>> {
    const [rows, total] = await Promise.all([
      this.prisma.storedFile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.limit,
        include: WITH_CREATOR,
      }),
      this.prisma.storedFile.count({ where }),
    ]);
    return paginate(
      rows.map((r) => this.format(r)),
      total,
      params,
    );
  }

  /** `clientId` undefined: any client (download route, admin). */
  async getFile(id: string, clientId?: string, ownerExternalId?: string) {
    const file = await this.prisma.storedFile.findFirst({
      where: {
        id,
        ...(clientId && { clientId }),
        ...(ownerExternalId && { creator: { externalId: ownerExternalId } }),
      },
      include: { client: { select: { domain: true } } },
    });
    if (!file) throw new NotFoundException('File not found');
    return file;
  }

  /** Disk path and canonical type, both from the type table, never from the raw row. */
  resolveDelivery(file: {
    id: string;
    clientId: string;
    mimeType: string;
    client: { domain: string | null };
  }) {
    const ext = (Object.keys(FILE_TYPES) as FileExt[]).find(
      (e) => FILE_TYPES[e].mimeType === file.mimeType,
    );
    if (!ext) throw new NotFoundException('File not found');
    const domain = file.client.domain || file.clientId;
    return {
      filePath: this.storage.getFilePath(domain, file.id, ext),
      contentType: FILE_TYPES[ext].mimeType,
    };
  }

  canDownloadPrivate(fileId: string, token: string | undefined): boolean {
    return verifyFileLink(
      fileId,
      token,
      this.config.get<string>('FILE_LINK_SECRET'),
    );
  }

  /** Raw SQL so updatedAt stays put. */
  async incrementDownloads(id: string, clientId: string) {
    await this.prisma.$executeRaw`
      UPDATE files SET downloads = downloads + 1
      WHERE id = ${id} AND "clientId" = ${clientId}`;
  }

  async createLink(id: string, clientId: string): Promise<FileLinkResponseDto> {
    await this.getFile(id, clientId);
    const { token, expiresAt } = signFileLink(
      id,
      this.config.get<string>('FILE_LINK_SECRET'),
    );
    this.logger.debug(`[createLink] File: ${id}, Client: ${clientId}`);
    return {
      url: `${this.route.fullUrl('files', id, 'download')}?token=${token}`,
      expiresAt,
    };
  }

  /** Returns the deleted row, for the caller's audit. */
  /** `ownerExternalId`: only that creator's file, else 404 (see ImageService.deleteImage). */
  async deleteFile(id: string, clientId: string, ownerExternalId?: string) {
    const file = await this.getFile(id, clientId, ownerExternalId);
    // Row first: a failed file delete leaves a stray dir for the orphan
    // sweep, never a row pointing at missing files.
    await this.prisma.storedFile.delete({ where: { id } });
    try {
      await this.storage.deleteDirectory(
        this.storage.getFileDir(file.client.domain || clientId, id),
      );
    } catch (err) {
      this.logger.warn(
        `[deleteFile] Files left for the orphan sweep - ID: ${id}: ${err instanceof Error ? err.message : err}`,
      );
    }
    return file;
  }

  private format(row: object & { id: string }): FileResponseDto {
    return plainToInstance(
      FileResponseDto,
      { ...row, downloadUrl: this.route.fullUrl('files', row.id, 'download') },
      { excludeExtraneousValues: true },
    );
  }
}
