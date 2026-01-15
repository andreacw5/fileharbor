import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, catchError, of } from 'rxjs';
import { PrismaService } from '@/modules/prisma/prisma.service';

export interface WebhookPayload {
  event: string;
  clientId: string;
  timestamp: string;
  data: Record<string, any>;
}

export enum WebhookEvent {
  IMAGE_UPLOADED = 'image.uploaded',
  IMAGE_DELETED = 'image.deleted',
  AVATAR_UPLOADED = 'avatar.uploaded',
  AVATAR_DELETED = 'avatar.deleted',
  ALBUM_CREATED = 'album.created',
  ALBUM_UPDATED = 'album.updated',
  ALBUM_DELETED = 'album.deleted',
  IMAGE_ADDED_TO_ALBUM = 'album.image_added',
  IMAGE_REMOVED_FROM_ALBUM = 'album.image_removed',
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly baseUrl: string;

  constructor(
    private httpService: HttpService,
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.baseUrl = this.config.get('BASE_URL') || 'http://localhost:3000';
  }

  /**
   * Sends a webhook notification to a client's configured Discord webhook
   * @param clientId The client ID
   * @param event The webhook event type
   * @param data The event payload data
   */
  async sendWebhook(
    clientId: string,
    event: WebhookEvent,
    data: Record<string, any>,
  ): Promise<void> {
    try {
      // Get client webhook configuration
      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
      });

      // Check if webhooks are enabled for this client
      if (!client || !client.webhookEnabled || !client.webhookUrl) {
        this.logger.debug(
          `[sendWebhook] Webhooks disabled for client ${clientId} or URL not configured`
        );
        return;
      }

      // Build webhook payload
      const payload: WebhookPayload = {
        event,
        clientId,
        timestamp: new Date().toISOString(),
        data,
      };

      // Send to Discord webhook
      await this.sendDiscordWebhook(client.webhookUrl, event, payload);
      this.logger.log(`[sendWebhook] Notification sent for event ${event} to client ${clientId}`);
    } catch (error) {
      this.logger.error(
        `[sendWebhook] Error sending webhook for event ${event} to client ${clientId}:`,
        error instanceof Error ? error.message : error
      );
      // Don't throw - webhook failures shouldn't break the main operation
    }
  }

  /**
   * Sends a Discord embed message to the webhook URL
   * @param webhookUrl The Discord webhook URL
   * @param event The event type
   * @param payload The webhook payload
   */
  private async sendDiscordWebhook(
    webhookUrl: string,
    event: WebhookEvent,
    payload: WebhookPayload,
  ): Promise<void> {
    const embed = this.buildDiscordEmbed(event, payload);
    const message = {
      embeds: [embed],
      timestamp: new Date().toISOString(),
    };

    try {
      await firstValueFrom(
        this.httpService.post(webhookUrl, message).pipe(
          catchError((error) => {
            this.logger.error(
              `[sendDiscordWebhook] Failed to post to Discord webhook:`,
              error instanceof Error ? error.message : error
            );
            return of(null);
          })
        )
      );
    } catch (error) {
      this.logger.error(
        `[sendDiscordWebhook] Error:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  /**
   * Builds a Discord embed based on the event type
   */
  private buildDiscordEmbed(event: WebhookEvent, payload: WebhookPayload): Record<string, any> {
    const eventConfig = this.getEventConfig(event);

    const embed: Record<string, any> = {
      title: eventConfig.title,
      description: eventConfig.description,
      color: eventConfig.color,
      fields: this.buildEmbedFields(event, payload.data),
      timestamp: payload.timestamp,
      footer: {
        text: 'FileHarbor Monitoring Sender',
      },
    };

    // Add image thumbnail for image upload events
    if (event === WebhookEvent.IMAGE_UPLOADED && payload.data.imageId) {
      const thumbnailUrl = `${this.baseUrl}/images/${payload.data.imageId}`;

      embed.thumbnail = {
        url: thumbnailUrl,
      };
      embed.footer.icon_url = thumbnailUrl;
    }

    // Add avatar thumbnail for avatar upload events
    if (event === WebhookEvent.AVATAR_UPLOADED && payload.data.userId) {
      const avatarUrl = `${this.baseUrl}/avatars/${payload.data.userId}`;

      embed.thumbnail = {
        url: avatarUrl,
      };
      embed.footer.icon_url = avatarUrl;
    }

    return embed;
  }

  /**
   * Gets configuration for an event type
   */
  private getEventConfig(
    event: WebhookEvent
  ): { title: string; description: string; color: number } {
    const configs: Record<WebhookEvent, { title: string; description: string; color: number }> = {
      [WebhookEvent.IMAGE_UPLOADED]: {
        title: 'Nuova immagine caricata!',
        description: 'Una nuova immagine è stata correttamente caricata.',
        color: 0xFFAD58, // Orange color from your example
      },
      [WebhookEvent.IMAGE_DELETED]: {
        title: 'Immagine eliminata',
        description: 'Un\'immagine è stata eliminata.',
        color: 0xe74c3c,
      },
      [WebhookEvent.AVATAR_UPLOADED]: {
        title: 'Nuovo avatar caricato!',
        description: 'Un nuovo avatar è stato correttamente caricato.',
        color: 0xFFAD58,
      },
      [WebhookEvent.AVATAR_DELETED]: {
        title: 'Avatar eliminato',
        description: 'Un avatar è stato eliminato.',
        color: 0xe74c3c,
      },
      [WebhookEvent.ALBUM_CREATED]: {
        title: 'Nuovo album creato!',
        description: 'Un nuovo album è stato creato.',
        color: 0x2ecc71,
      },
      [WebhookEvent.ALBUM_UPDATED]: {
        title: 'Album aggiornato',
        description: 'Un album è stato aggiornato.',
        color: 0xf39c12,
      },
      [WebhookEvent.ALBUM_DELETED]: {
        title: 'Album eliminato',
        description: 'Un album è stato eliminato.',
        color: 0xe74c3c,
      },
      [WebhookEvent.IMAGE_ADDED_TO_ALBUM]: {
        title: 'Immagine aggiunta all\'album',
        description: 'Una immagine è stata aggiunta a un album.',
        color: 0x3498db,
      },
      [WebhookEvent.IMAGE_REMOVED_FROM_ALBUM]: {
        title: 'Immagine rimossa dall\'album',
        description: 'Una immagine è stata rimossa da un album.',
        color: 0xe74c3c,
      },
    };

    return configs[event];
  }

  /**
   * Builds embed fields based on event data
   */
  private buildEmbedFields(event: WebhookEvent, data: Record<string, any>): Array<Record<string, any>> {
    const fields: Array<Record<string, any>> = [];

    switch (event) {
      case WebhookEvent.IMAGE_UPLOADED:
        fields.push(
          { name: 'Identificativo', value: data.imageId || 'N/A' },
          { name: 'Dimensioni', value: `${(data.size / 1024).toFixed(2)} KB`, inline: true },
          { name: 'Utente', value: data.userId || 'System', inline: true }
        );
        break;

      case WebhookEvent.AVATAR_UPLOADED:
        fields.push(
          { name: 'Identificativo', value: data.avatarId || 'N/A' },
          { name: 'Dimensioni', value: `${(data.size / 1024).toFixed(2)} KB`, inline: true },
          { name: 'Utente', value: data.userId || 'System', inline: true }
        );
        break;

      case WebhookEvent.ALBUM_CREATED:
      case WebhookEvent.ALBUM_UPDATED:
        fields.push(
          { name: 'Identificativo', value: data.albumId || 'N/A' },
          { name: 'Nome', value: data.name || 'N/A' },
          { name: 'Pubblico', value: data.isPublic ? 'Sì' : 'No', inline: true },
          { name: 'Utente', value: data.userId || 'System', inline: true }
        );
        if (data.description) {
          fields.push({ name: 'Descrizione', value: data.description });
        }
        break;

      case WebhookEvent.IMAGE_ADDED_TO_ALBUM:
        fields.push(
          { name: 'Album', value: data.albumName || 'N/A' },
          { name: 'Immagine', value: data.imageId || 'N/A' }
        );
        break;

      case WebhookEvent.IMAGE_DELETED:
      case WebhookEvent.AVATAR_DELETED:
      case WebhookEvent.ALBUM_DELETED:
      case WebhookEvent.IMAGE_REMOVED_FROM_ALBUM:
        fields.push(
          { name: 'Identificativo', value: data.id || 'N/A' },
          { name: 'Timestamp', value: new Date(data.timestamp || Date.now()).toLocaleString('it-IT') }
        );
        break;
    }

    return fields;
  }
}
