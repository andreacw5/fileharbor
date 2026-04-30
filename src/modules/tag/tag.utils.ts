type TagRelation = {
  tag?: {
    name?: string | null;
  } | null;
} | null;

type TagContainer = {
  imageTags?: TagRelation[] | null;
};

export function normalizeTagNames(tags?: string[] | null): string[] {
  if (!tags?.length) {
    return [];
  }

  return [...new Set(tags.map((tag) => tag?.trim()).filter((tag): tag is string => Boolean(tag)))];
}

export function buildImageTagCreateInput(clientId: string, tags?: string[] | null) {
  return normalizeTagNames(tags).map((name) => ({
    tag: {
      connectOrCreate: {
        where: {
          clientId_name: {
            clientId,
            name,
          },
        },
        create: {
          clientId,
          name,
        },
      },
    },
  }));
}

export function extractTagNames(entity: TagContainer): string[] {
  return normalizeTagNames(
    (entity.imageTags ?? [])
      .map((imageTag) => imageTag?.tag?.name ?? null)
      .filter((name): name is string => Boolean(name)),
  );
}


