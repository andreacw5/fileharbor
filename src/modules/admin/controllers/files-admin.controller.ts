import { SkipThrottle } from '@nestjs/throttler';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Audit, AuditRequest } from '@heyatom/bastion-client/nest';
import {
  ApiCreatedData,
  ApiOkData,
  ApiPaginatedResponse,
  NoTransform,
} from '@heyatom/nest-common';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { CurrentAdminUser } from '@/modules/bastion/decorators/current-admin-user.decorator';
import { RequirePermission } from '@/modules/bastion/decorators/require-permission.decorator';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import {
  assertClientAccess,
  buildClientWhere,
} from '../helpers/admin-access.helper';
import { FileService } from '@/modules/file/file.service';
import { fileMulterOptions } from '@/modules/file/file-types';
import { FileResponseDto } from '@/modules/file/dto/file.dto';
import { removeVideoTempFile, sendVideo } from '@/modules/video/video-delivery';
import { AdminScopedListQuery } from '../dto/admin-list-query.dto';
import { AdminDeleteResponseDto } from '../dto/admin-response.dto';

// Audit metadata: ids, type and size, never the file name.
const fileAuditMetadata = (r: FileResponseDto | undefined) => ({
  fileId: r?.id,
  clientId: r?.clientId,
  mimeType: r?.mimeType,
  size: r?.size,
});

@ApiTags('Admin - Files')
// Meridian's BFF is one IP for every admin: Bastion auth + permissions gate it.
@SkipThrottle()
@Controller('admin/files')
@UseGuards(BastionUserGuard)
@ApiBearerAuth()
@RequirePermission('fileharbor-library.manage')
export class FilesAdminController {
  constructor(private readonly fileService: FileService) {}

  @Post()
  @ApiOperation({ summary: 'Upload a .zip or .pdf on behalf of a client' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'clientId'],
      properties: {
        file: { type: 'string', format: 'binary' },
        clientId: { type: 'string', format: 'uuid' },
        isPrivate: { type: 'boolean', default: false },
      },
    },
  })
  @ApiCreatedData(FileResponseDto)
  @UseInterceptors(
    removeVideoTempFile,
    FileInterceptor('file', fileMulterOptions),
  )
  @Audit('fh_file.uploaded', { metadata: fileAuditMetadata })
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('clientId') clientId: string,
    @Body('isPrivate') isPrivateRaw: string | undefined,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<FileResponseDto> {
    if (!file) throw new BadRequestException('No file provided');
    if (!clientId) throw new BadRequestException('clientId is required');
    assertClientAccess(adminUser, clientId);
    return this.fileService.uploadFile(
      clientId,
      undefined,
      file,
      isPrivateRaw === 'true' || isPrivateRaw === '1',
    );
  }

  @Get()
  @ApiOperation({ summary: 'List files (scoped to accessible clients)' })
  @ApiPaginatedResponse(FileResponseDto)
  async listFiles(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query() query: AdminScopedListQuery,
  ) {
    return this.fileService.listFiles(
      buildClientWhere(adminUser, query.clientId),
      query,
    );
  }

  @NoTransform()
  @Get(':id/download')
  @ApiOperation({
    summary: 'Download a file (admin, JWT auth)',
    description:
      'For private files: public ones are downloaded from their downloadUrl.',
  })
  async download(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Res() res: Response,
  ) {
    const file = await this.fileService.getFile(id);
    assertClientAccess(adminUser, file.clientId);
    const { filePath, contentType } = this.fileService.resolveDelivery(file);
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
        cacheControl: 'private, no-store',
      },
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a file (admin)' })
  @ApiOkData(AdminDeleteResponseDto)
  @Audit('fh_file.deleted', {
    metadata: (_r: unknown, req: AuditRequest) => ({ fileId: req.params.id }),
  })
  async deleteFile(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminDeleteResponseDto> {
    const file = await this.fileService.getFile(id);
    assertClientAccess(adminUser, file.clientId);
    await this.fileService.deleteFile(id, file.clientId);
    return { success: true, message: 'File deleted successfully' };
  }
}
