# 📋 FileHarbor - External Album API Guide

Guida completa per integrare la gestione album con FileHarbor usando `externalAlbumId`.

---

## 🎯 Cosa è cambiato?

Ora potete referenziare i vostri album interni usando un `externalAlbumId` quando create album in FileHarbor. Questo vi permette di:

- ✅ **Mantenere i vostri ID album interni** - Non dovete memorizzare UUID lunghi
- ✅ **Non dover mappare/memorizzare gli UUID interni di FileHarbor** - Usate sempre il vostro ID
- ✅ **Aggiungere/rimuovere immagini facilmente** - Usando il vostro ID album noto
- ✅ **Sincronizzazione bidirezionale** - Tutto sincronizzato tra le due piattaforme

---

## 🔑 Autenticazione

Tutti gli endpoint richiedono:

```
Headers:
  X-API-Key: your-api-key          (REQUIRED)
  X-User-Id: your-user-id          (REQUIRED per la maggior parte degli endpoint)
```

---

## 📌 Endpoint Disponibili

### 1️⃣ Creare un Album con External ID

Quando create un album nella vostra app, passate il vostro ID album a FileHarbor.

```bash
POST /albums
Content-Type: application/json
X-API-Key: your-api-key
X-User-Id: user-123

{
  "externalAlbumId": "your-album-456",  // 🔑 Il VOSTRO ID album
  "name": "Vacanze Estate 2025",
  "description": "Foto dalle ferie in Italia",
  "isPublic": false
}
```

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",  // ID interno FileHarbor
  "externalAlbumId": "your-album-456",            // 🔑 Il vostro ID (ritornato)
  "clientId": "client-123",
  "userId": "user-123",
  "name": "Vacanze Estate 2025",
  "description": "Foto dalle ferie in Italia",
  "isPublic": false,
  "createdAt": "2025-01-15T20:30:00.000Z"
}
```

**Codice di Esempio (JavaScript/TypeScript):**
```typescript
const createAlbum = async (externalAlbumId: string, name: string) => {
  const response = await fetch('https://fileharbor.com/albums', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.FILEHARBOR_API_KEY,
      'X-User-Id': getCurrentUserId(),
    },
    body: JSON.stringify({
      externalAlbumId,
      name,
      isPublic: false,
    }),
  });
  return response.json();
};
```

---

### 2️⃣ Aggiungere Immagini all'Album

Aggiungete immagini al album usando il vostro `externalAlbumId`.

```bash
POST /albums/external/your-album-456/images
Content-Type: application/json
X-API-Key: your-api-key
X-User-Id: user-123

{
  "imageIds": [
    "image-id-1",
    "image-id-2",
    "image-id-3"
  ]
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Added 3 image(s) to album",
  "added": 3
}
```

**Codice di Esempio:**
```typescript
const addImagesToAlbum = async (externalAlbumId: string, imageIds: string[]) => {
  const response = await fetch(
    `https://fileharbor.com/albums/external/${externalAlbumId}/images`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.FILEHARBOR_API_KEY,
        'X-User-Id': getCurrentUserId(),
      },
      body: JSON.stringify({ imageIds }),
    }
  );
  return response.json();
};
```

---

### 3️⃣ Ottenere Album e Immagini

Recuperate l'album con tutte le immagini associate.

```bash
GET /albums/external/your-album-456
X-API-Key: your-api-key
X-User-Id: user-123
```

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "externalAlbumId": "your-album-456",
  "clientId": "client-123",
  "userId": "user-123",
  "name": "Vacanze Estate 2025",
  "description": "Foto dalle ferie in Italia",
  "isPublic": false,
  "createdAt": "2025-01-15T20:30:00.000Z",
  "imageCount": 3,
  "images": [
    {
      "id": "image-id-1",
      "originalName": "foto-spiaggia.jpg",
      "format": "webp",
      "width": 1920,
      "height": 1080,
      "size": 524288,
      "createdAt": "2025-01-15T20:31:00.000Z",
      "url": "/images/image-id-1",
      "thumbnailUrl": "/images/image-id-1/thumb",
      "order": 1
    },
    {
      "id": "image-id-2",
      "originalName": "foto-tramonto.jpg",
      "format": "webp",
      "width": 2048,
      "height": 1536,
      "size": 786432,
      "createdAt": "2025-01-15T20:32:00.000Z",
      "url": "/images/image-id-2",
      "thumbnailUrl": "/images/image-id-2/thumb",
      "order": 2
    },
    {
      "id": "image-id-3",
      "originalName": "foto-amici.jpg",
      "format": "webp",
      "width": 1600,
      "height": 1200,
      "size": 458752,
      "createdAt": "2025-01-15T20:33:00.000Z",
      "url": "/images/image-id-3",
      "thumbnailUrl": "/images/image-id-3/thumb",
      "order": 3
    }
  ]
}
```

**Codice di Esempio:**
```typescript
const getAlbumWithImages = async (externalAlbumId: string) => {
  const response = await fetch(
    `https://fileharbor.com/albums/external/${externalAlbumId}`,
    {
      headers: {
        'X-API-Key': process.env.FILEHARBOR_API_KEY,
        'X-User-Id': getCurrentUserId(),
      },
    }
  );
  return response.json();
};
```

---

### 4️⃣ Aggiornare Album Metadata

Aggiornate il nome, descrizione, o accesso pubblico dell'album.

```bash
PATCH /albums/external/your-album-456
Content-Type: application/json
X-API-Key: your-api-key
X-User-Id: user-123

{
  "name": "Vacanze Estate 2025 - UPDATED",
  "description": "Foto aggiornate dalle ferie",
  "isPublic": true
}
```

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "externalAlbumId": "your-album-456",
  "clientId": "client-123",
  "userId": "user-123",
  "name": "Vacanze Estate 2025 - UPDATED",
  "description": "Foto aggiornate dalle ferie",
  "isPublic": true,
  "createdAt": "2025-01-15T20:30:00.000Z"
}
```

**Nota:** Il campo `externalAlbumId` è opzionale - potete omitterlo senza problemi.

**Codice di Esempio:**
```typescript
const updateAlbum = async (externalAlbumId: string, updates: Partial<Album>) => {
  const response = await fetch(
    `https://fileharbor.com/albums/external/${externalAlbumId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.FILEHARBOR_API_KEY,
        'X-User-Id': getCurrentUserId(),
      },
      body: JSON.stringify(updates),
    }
  );
  return response.json();
};
```

---

### 5️⃣ Rimuovere Immagini dall'Album

Rimuovete specifiche immagini dall'album senza cancellarle da FileHarbor.

```bash
DELETE /albums/external/your-album-456/images
Content-Type: application/json
X-API-Key: your-api-key
X-User-Id: user-123

{
  "imageIds": [
    "image-id-1",
    "image-id-2"
  ]
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Removed 2 image(s) from album",
  "removed": 2
}
```

**Codice di Esempio:**
```typescript
const removeImagesFromAlbum = async (
  externalAlbumId: string,
  imageIds: string[]
) => {
  const response = await fetch(
    `https://fileharbor.com/albums/external/${externalAlbumId}/images`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.FILEHARBOR_API_KEY,
        'X-User-Id': getCurrentUserId(),
      },
      body: JSON.stringify({ imageIds }),
    }
  );
  return response.json();
};
```

---

## 🔄 Flusso Consigliato

```
┌─────────────────────────┐
│  Vostra App Interna     │
└────────────┬────────────┘
             │
             ├─ Utente crea album: "my-album-123"
             │
             ▼
    ┌────────────────────────────────┐
    │ POST /albums                │
    │ {                              │
    │   externalAlbumId: "my-album-  │
    │   123",                        │
    │   name: "..."                  │
    │ }                              │
    └────────────┬───────────────────┘
                 │
                 ▼
    ┌────────────────────────────────┐
    │  FileHarbor                    │
    │  (Salva album associato)       │
    └────────────┬───────────────────┘
                 │
                 ▼ Respone con ID interno
    
    ┌─────────────────────────┐
    │  Vostra App Interna     │
    │  (Può salvare o ignorare│
    │   l'ID interno)         │
    └─────────────────────────┘
             │
             ├─ Utente aggiunge immagini
             │
             ▼
    ┌────────────────────────────────┐
    │ POST /albums/external/          │
    │       my-album-123/images       │
    │ {                              │
    │   imageIds: [...]              │
    │ }                              │
    └────────────┬───────────────────┘
                 │
                 ▼ Immagini aggiunte
    
    ┌────────────────────────────────┐
    │  FileHarbor                    │
    │  (Associa immagini)            │
    └────────────┬───────────────────┘
                 │
                 ▼
    ┌─────────────────────────┐
    │  Vostra App Interna     │
    │  (Sincronizzato!)       │
    └─────────────────────────┘
```

---

## 🛡️ Sicurezza & Autorizzazione

### Multi-Tenancy
- Ogni album è scoped al vostro client tramite `X-API-Key`
- Non potete accedere agli album di altri client

### Autorizzazione Utente
- Solo l'utente che crea l'album (`userId`) può modificarlo
- Tentare di modificare album di altri utenti restituisce `403 Forbidden`

### Accesso agli Album
- **Album Privati** (`isPublic: false`): Solo owner può accedere
- **Album Pubblici** (`isPublic: true`): Chiunque con l'API key può accedere
- Per album privati, considerate di usare token di condivisione

---

## ⚠️ Codici di Errore

| Codice | Significato | Esempio |
|--------|-------------|---------|
| `200` | OK - Operazione riuscita | GET album |
| `201` | Created - Risorsa creata | POST album |
| `400` | Bad Request - Dati non validi | Manca X-User-Id |
| `403` | Forbidden - Non autorizzato | Cerchi di modificare album di altri |
| `404` | Not Found - Album non esiste | externalAlbumId inesistente |
| `409` | Conflict - Album già esiste | externalAlbumId duplicato |
| `500` | Server Error - Errore interno | Contattate il supporto |

---

## 📝 Esempi Completi

### Creare Album e Aggiungere Immagini

```typescript
async function createAndPopulateAlbum() {
  try {
    // 1. Creare l'album
    const albumRes = await fetch('https://fileharbor.com/albums', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.FILEHARBOR_API_KEY,
        'X-User-Id': 'user-123',
      },
      body: JSON.stringify({
        externalAlbumId: 'summer-2025',
        name: 'Summer 2025',
        description: 'Vacation photos',
        isPublic: false,
      }),
    });

    if (!albumRes.ok) {
      throw new Error(`Failed to create album: ${albumRes.statusText}`);
    }

    const album = await albumRes.json();
    console.log(`✅ Album created:`, album.externalAlbumId);

    // 2. Aggiungere immagini
    const imagesRes = await fetch(
      `https://fileharbor.com/albums/external/${album.externalAlbumId}/images`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.FILEHARBOR_API_KEY,
          'X-User-Id': 'user-123',
        },
        body: JSON.stringify({
          imageIds: ['img-1', 'img-2', 'img-3'],
        }),
      }
    );

    if (!imagesRes.ok) {
      throw new Error(`Failed to add images: ${imagesRes.statusText}`);
    }

    const result = await imagesRes.json();
    console.log(`✅ Images added:`, result.added);

    // 3. Recuperare l'album con immagini
    const getRes = await fetch(
      `https://fileharbor.com/albums/external/${album.externalAlbumId}`,
      {
        headers: {
          'X-API-Key': process.env.FILEHARBOR_API_KEY,
          'X-User-Id': 'user-123',
        },
      }
    );

    const fullAlbum = await getRes.json();
    console.log(`✅ Album with images:`, {
      name: fullAlbum.name,
      imageCount: fullAlbum.imageCount,
      images: fullAlbum.images,
    });

    return fullAlbum;
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}
```

### Sincronizzare Album al Cambio

```typescript
async function syncAlbumChanges(externalAlbumId: string, changes: object) {
  const response = await fetch(
    `https://fileharbor.com/albums/external/${externalAlbumId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.FILEHARBOR_API_KEY,
        'X-User-Id': getCurrentUserId(),
      },
      body: JSON.stringify(changes),
    }
  );

  if (!response.ok) {
    throw new Error(`Sync failed: ${response.statusText}`);
  }

  return response.json();
}

// Uso
await syncAlbumChanges('summer-2025', {
  name: 'Summer 2025 - Updated',
  isPublic: true,
});
```

---

## 🔄 Sincronizzazione Consigliata

### Scenario 1: Album Creato nella Vostra App
1. Create l'album internamente
2. Create l'album in FileHarbor con `externalAlbumId`
3. Utente aggiunge immagini internamente
4. Sincronizzate in FileHarbor tramite external ID

### Scenario 2: Aggiornamento Album
1. Utente modifica nome/descrizione
2. Fate PATCH a `/albums/external/{externalAlbumId}`
3. FileHarbor aggiorna i metadata

### Scenario 3: Gestione Immagini
1. Aggiungete immagini usando POST `/albums/external/{externalAlbumId}/images`
2. Rimovetele usando DELETE `/albums/external/{externalAlbumId}/images`
3. Non dovete preoccuparvi degli ID interni

---

## 📞 Support & Notes

- **Backward Compatible**: I vecchi endpoint con ID interno continuano a funzionare
- **Rate Limiting**: Applicato globalmente a tutte le API
- **Webhook**: FileHarbor invia notifiche per ogni operazione
- **Timezone**: Tutti i timestamp sono in UTC (ISO 8601)

---

## ❓ FAQ

**D: Posso creare album senza `externalAlbumId`?**
R: Sì, è opzionale. Se non lo passate, potete sempre accedere via ID interno.

**D: Posso cambiare `externalAlbumId` di un album esistente?**
R: Sì, tramite PATCH, ma assicuratevi che il nuovo valore sia unico per il client.

**D: Che succede se cancello un album dalla vostra app?**
R: Dovete cancellarlo anche in FileHarbor tramite l'endpoint DELETE (non implementato per external ID, usate l'ID interno).

**D: Posso avere album pubblici?**
R: Sì, impostare `isPublic: true` quando create o aggiornate l'album.

**D: Le immagini vengono cancellate quando rimuovo da un album?**
R: No, le immagini rimangono in FileHarbor. Vengono solo rimosse dall'associazione album.

---

**Versione:** 1.0  
**Data:** 15 Gennaio 2026  
**Ultimo aggiornamento:** 15 Gennaio 2026
