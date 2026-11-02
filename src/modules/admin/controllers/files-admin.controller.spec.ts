import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { AUDIT_EVENT_KEY } from '@heyatom/bastion-client/nest';
import type { FileService } from '@/modules/file/file.service';
import { FilesAdminController } from './files-admin.controller';

describe('FilesAdminController client scope', () => {
  const admin = { allowedClientIds: ['c1'] } as any;
  const fileService = {
    getFile: jest.fn(),
    deleteFile: jest.fn(),
    uploadFile: jest.fn(),
    listFiles: jest.fn(),
    resolveDelivery: jest.fn(),
  };
  const controller = new FilesAdminController(
    fileService as unknown as FileService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('refuses a file of another client with 403, before touching it', async () => {
    fileService.getFile.mockResolvedValue({ id: 'f', clientId: 'c2' });
    await expect(controller.deleteFile('f', admin)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      controller.download('f', admin, {} as Response),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(fileService.deleteFile).not.toHaveBeenCalled();
    expect(fileService.resolveDelivery).not.toHaveBeenCalled();
  });

  it('passes a missing file through as 404', async () => {
    fileService.getFile.mockRejectedValue(new NotFoundException());
    await expect(controller.deleteFile('f', admin)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('refuses an upload to another client, lists only the scope', async () => {
    await expect(
      controller.uploadFile({} as Express.Multer.File, 'c2', undefined, admin),
    ).rejects.toMatchObject({ status: 403 });
    expect(fileService.uploadFile).not.toHaveBeenCalled();

    await controller.listFiles(admin, { page: 1, limit: 20, skip: 0 } as any);
    expect(fileService.listFiles.mock.calls[0][0]).toEqual({
      clientId: { in: ['c1'] },
    });
  });

  it('audits an upload with ids, type and size, never the name', () => {
    const { event, options } = Reflect.getMetadata(
      AUDIT_EVENT_KEY,
      FilesAdminController.prototype.uploadFile,
    );
    expect(event).toBe('fh_file.uploaded');
    expect(
      options.metadata({
        id: 'f',
        clientId: 'c1',
        mimeType: 'application/zip',
        size: 9,
        originalName: 'secret.zip',
      }),
    ).toEqual({
      fileId: 'f',
      clientId: 'c1',
      mimeType: 'application/zip',
      size: 9,
    });
  });
});
