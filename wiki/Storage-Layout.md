# Storage Layout

FileHarbor organises all files on disk under a configurable root directory (`STORAGE_PATH`, default `./storage`).

---

## Directory Structure

```
storage/
├── defaults.fileharbor/              ← Built-in fallback images (shipped with repo)
│   ├── fileharbor_not_found.webp
│   ├── fileharbor_permission_denided.webp
│   ├── fileharbor_blocked.webp
│   ├── fileharbor_logo.webp
│   └── fileharbor_name_banner.webp
│
└── {client.domain | clientId}/       ← One directory per tenant
    ├── images/
    │   └── {imageId}/
    │       ├── original.webp         ← Full-quality image
    │       └── thumb.webp            ← Thumbnail
    └── avatars/
        └── {externalUserId}/
            ├── original.webp         ← Full-quality avatar
            └── thumb.webp            ← Thumbnail
```

### Tenant Directory

The tenant directory name is:
- `client.domain` if the client has a domain configured (e.g. `example.com`)
- `client.id` (UUID) as fallback

This allows human-readable paths when a domain is set.

---

## Path Safety

`StorageService` enforces path safety on all operations:

- **`validatePath()`** – Ensures the resolved path is inside `STORAGE_PATH`. Blocks directory traversal attacks.
- **`sanitizePathComponent()`** – Strips `..`, `/`, `\`, and null bytes from path components. Dots (`.`) are allowed to support domain names like `example.com`.

> Never construct storage paths manually — always use `StorageService` helpers.

---

## Fallback Images

The `storage/defaults.fileharbor/` directory contains images that are returned when an image cannot be served:

| File | When Served |
|------|------------|
| `fileharbor_not_found.webp` | Image ID does not exist |
| `fileharbor_permission_denided.webp` | Image is private and requester lacks access |

These files are included in the repository and must be present at startup.

---

## Docker Volume Mapping

In production, mount the storage directory as a persistent volume:

```yaml
volumes:
  - fileharbor_storage:/data/storage

environment:
  STORAGE_PATH: /data/storage
```

The container runs as UID/GID `1001`. Ensure host directory permissions match:

```bash
sudo chown -R 1001:1001 /host/storage/path
```

