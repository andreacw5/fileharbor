import { plainToInstance } from 'class-transformer';
import { AdminClientResponseDto } from '@/modules/admin/dto/admin-response.dto';
import { DISCORD_WEBHOOK_URL } from './webhook.service';

describe('DISCORD_WEBHOOK_URL', () => {
  it.each([
    'https://discord.com/api/webhooks/123456/abc-DEF_9',
    'https://discordapp.com/api/webhooks/123456/abc',
    'https://canary.discord.com/api/v10/webhooks/1/t?thread_id=42',
  ])('accepts %s', (url) => expect(DISCORD_WEBHOOK_URL.test(url)).toBe(true));

  it.each([
    'http://discord.com/api/webhooks/1/t',
    'https://discord.com.evil.io/api/webhooks/1/t',
    'https://evil.io/?https://discord.com/api/webhooks/1/t',
    'https://discord.com@169.254.169.254/api/webhooks/1/t',
    'https://localhost/api/webhooks/1/t',
    'https://discord.com/api/webhooks/1/t/../../x',
  ])('rejects %s', (url) => expect(DISCORD_WEBHOOK_URL.test(url)).toBe(false));
});

describe('AdminClientResponseDto.webhookUrl', () => {
  it('masks the webhook token', () => {
    const dto = plainToInstance(
      AdminClientResponseDto,
      { webhookUrl: 'https://discord.com/api/webhooks/123/secret-token' },
      { excludeExtraneousValues: true },
    );
    expect(dto.webhookUrl).toBe('https://discord.com/api/webhooks/123/****');
  });
});
