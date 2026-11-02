import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { BastionAuditService, Public } from '@heyatom/bastion-client/nest';
import {
  ApiCreatedData,
  ApiOkData,
  ApiPaginatedResponse,
  NoTransform,
  PaginatedResult,
} from '@heyatom/nest-common';
import { ClientInterceptor } from '@/modules/client/interceptors/client.interceptor';
import {
  ClientId,
  CreatorExternalId,
} from '@/modules/client/decorators/client.decorator';
import { auditClientWrite } from '@/common/client-audit';
import { removeVideoTempFile, sendVideo } from '@/modules/video/video-delivery';
import { DeleteResponseDto } from '@/modules/image/dto/delete-response.dto';
import { FileService } from './file.service';
import { fileMulterOptions } from './file-types';
import {
  FileLinkResponseDto,
  FileResponseDto,
  ListFilesDto,
  UploadFileDto,
} from './dto/file.dto';

@ApiTags('Files')
@ApiSecurity('api-key')
@Controller('files')
@UseInterceptors(ClientInterceptor)
export class FileController {
  private readonly logger = new Logger(FileController.name);

  constructor(
    private readonly fileService: FileService,
    private readonly audit: BastionAuditService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Upload a downloadable file (.zip or .pdf)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        isPrivate: { type: 'boolean', default: false },
      },
    },
  })
  @ApiCreatedData(FileResponseDto)
  @ApiResponse({ status: 400, description: 'UNSUPPORTED_FILE_TYPE' })
  @ApiResponse({ status: 413, description: 'Over MAX_DOWNLOAD_FILE_SIZE' })
  @UseInterceptors(
    removeVideoTempFile,
    FileInterceptor('file', fileMulterOptions),
  )
  async uploadFile(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string | undefined,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFileDto,
  ): Promise<FileResponseDto> {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.fileService.uploadFile(
      clientId,
      creatorId,
      file,
      dto.isPrivate,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List files (paginated, newest first)' })
  @ApiPaginatedResponse(FileResponseDto)
  async listFiles(
    @ClientId() clientId: string,
    @Query() query: ListFilesDto,
  ): Promise<PaginatedResult<FileResponseDto>> {
    return this.fileService.listFiles(
      {
        clientId,
        ...(query.creatorId && { creator: { externalId: query.creatorId } }),
      },
      query,
    );
  }

  @Public()
  // Every Range chunk is a request: the IP bucket would cut a download manager
  // or an office NAT halfway through a 76 MB file. Ids are uuids.
  @SkipThrottle()
  @NoTransform()
  @Get(':id/download')
  @ApiOperation({
    summary: 'Download a file (attachment, Range support)',
    description:
      'Public for public files. A private file needs the X-API-Key of its client or a ?token from POST /files/:id/link; otherwise 404.',
  })
  @ApiParam({ name: 'id', description: 'File UUID' })
  @ApiQuery({ name: 'token', required: false, type: String })
  @ApiResponse({
    status: 200,
    content: { 'application/zip': {}, 'application/pdf': {} },
  })
  @ApiResponse({
    status: 404,
    description: 'Not found, or private without access',
  })
  async download(
    @Param('id') id: string,
    @Query('token') token: string | undefined,
    @Headers('range') range: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const file = await this.fileService.getFile(id);
    if (
      file.isPrivate &&
      req['clientId'] !== file.clientId &&
      !this.fileService.canDownloadPrivate(id, token)
    ) {
      // Not 403: a private file's existence is not confirmed
      throw new NotFoundException('File not found');
    }
    const { filePath, contentType } = this.fileService.resolveDelivery(file);
    // One download per transfer, not per Range chunk
    const counts = !range || /^bytes=0-/.test(range);
    sendVideo(
      res,
      {
        storagePath: file.storagePath,
        filePath,
        originalName: file.originalName,
      },
      {
        download: true,
        xAccelRedirect: false,
        contentType,
        cacheControl: file.isPrivate
          ? 'private, no-store'
          : 'public, max-age=31536000, immutable',
        onSent: counts
          ? () =>
              void this.fileService
                .incrementDownloads(id, file.clientId)
                .catch((e) =>
                  this.logger.warn(
                    `[download] Count lost for ${id}: ${e.message}`,
                  ),
                )
          : undefined,
      },
    );
  }

  @Post(':id/link')
  @ApiOperation({
    summary: 'Signed download link, valid 10 minutes',
    description:
      'For private files: the caller checks its own user, then redirects them to `url`. The bytes go from FileHarbor to the user.',
  })
  @ApiParam({ name: 'id', description: 'File UUID' })
  @ApiCreatedData(FileLinkResponseDto)
  async createLink(
    @Param('id') id: string,
    @ClientId() clientId: string,
  ): Promise<FileLinkResponseDto> {
    return this.fileService.createLink(id, clientId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a file' })
  @ApiParam({ name: 'id', description: 'File UUID' })
  @ApiOkData(DeleteResponseDto)
  async deleteFile(
    @Param('id') id: string,
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string | undefined,
  ): Promise<DeleteResponseDto> {
    await this.fileService.deleteFile(id, clientId);
    auditClientWrite(this.audit, 'fh_file.deleted', clientId, creatorId, {
      fileId: id,
    });
    return { success: true, message: 'File deleted successfully' };
  }
}
