import { plainToInstance } from 'class-transformer';
import { ImageService } from './image.service';
import { AdminImageResponseDto } from '@/modules/admin/dto/admin-response.dto';

describe('ImageService admin reads', () => {
  const prisma = {
    image: { findUnique: jest.fn(), update: jest.fn() },
    adminImageBookmark: { findUnique: jest.fn() },
  };
  const config = { get: jest.fn() };
  const service = new ImageService(
    prisma as any,
    {} as any,
    config as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const creator = { id: 'creator-uuid', externalId: 'ext-1', username: 'wood' };

  beforeEach(() => jest.clearAllMocks());

  it('selects the creator id on the detail, so the console can link it', async () => {
    prisma.image.findUnique.mockResolvedValue({ id: 'img-1', creator });
    await service.findAdminImageById('img-1');
    const args = prisma.image.findUnique.mock.calls[0][0];
    expect(args.include.creator.select).toMatchObject({ id: true });
  });

  it('selects the creator id on update, which answers with the same DTO', async () => {
    prisma.image.update.mockResolvedValue({ id: 'img-1', creator });
    await service.adminUpdateImage('img-1', {});
    const args = prisma.image.update.mock.calls[0][0];
    expect(args.include.creator.select).toMatchObject({ id: true });
  });

  it('keeps the creator id through the response DTO', () => {
    const dto = plainToInstance(
      AdminImageResponseDto,
      { id: 'img-1', creator },
      { excludeExtraneousValues: true },
    );
    expect(dto.creator?.id).toBe('creator-uuid');
  });
});
