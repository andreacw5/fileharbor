import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create a demo client
  const client = await prisma.client.upsert({
    where: { apiKey: 'demo-api-key-12345' },
    update: {},
    create: {
      id: uuidv4(),
      name: 'Demo Client',
      apiKey: 'demo-api-key-12345',
      active: true,
      domain: 'demo.fileharbor.local',
    },
  });
  console.log(`Created client: ${client.name} (${client.id})`);

  // Create admin user
  const adminUser = await prisma.user.upsert({
    where: {
      clientId_externalUserId: {
        clientId: client.id,
        externalUserId: 'system',
      },
    },
    update: {},
    create: {
      clientId: client.id,
      externalUserId: 'system',
      email: 'system@auto.local',
      username: 'System Admin',
    },
  });
  console.log(`Created admin user: ${adminUser.username}`);

  // Create demo album
  const album1 = await prisma.album.upsert({
    where: { id: 'demo-album-1' },
    update: {},
    create: {
      id: 'demo-album-1',
      clientId: client.id,
      userId: adminUser.id,
      name: 'Demo Album 1',
      description: 'Album di test per admin',
      isPublic: true,
    },
  });
  console.log(`Created album: ${album1.name}`);

  // Create demo image
  const image1 = await prisma.image.upsert({
    where: { id: 'demo-image-1' },
    update: {},
    create: {
      id: 'demo-image-1',
      clientId: client.id,
      userId: adminUser.id,
      originalName: 'demo1.webp',
      storagePath: '/storage/demo.fileharbor.local/images/demo-image-1/original.webp',
      thumbnailPath: '/storage/demo.fileharbor.local/images/demo-image-1/thumb.webp',
      format: 'webp',
      width: 800,
      height: 600,
      size: 123456,
      mimeType: 'image/webp',
      isOptimized: false,
    },
  });
  console.log(`Created image: ${image1.originalName}`);

  // Link image to album
  await prisma.albumImage.upsert({
    where: { albumId_imageId: { albumId: album1.id, imageId: image1.id } },
    update: {},
    create: {
      albumId: album1.id,
      imageId: image1.id,
      order: 1,
    },
  });
  console.log('Linked image to album.');

  // Create demo avatar
  await prisma.avatar.upsert({
    where: { id: 'demo-avatar-1' },
    update: {},
    create: {
      id: 'demo-avatar-1',
      clientId: client.id,
      userId: adminUser.id,
      storagePath: `/storage/demo.fileharbor.local/avatars/${adminUser.id}/avatar.webp`,
      thumbnailPath: `/storage/demo.fileharbor.local/avatars/${adminUser.id}/thumb.webp`,
      format: 'webp',
      width: 256,
      height: 256,
      size: 12345,
      mimeType: 'image/webp',
      isOptimized: true,
      optimizedAt: new Date(),
    },
  });
  console.log('Created demo avatar for admin.');

  console.log('Seeding completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
