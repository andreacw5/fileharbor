import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class UploadAvatarDto {
    @ApiProperty({
        type: 'string',
        format: 'binary',
        description: 'Avatar image file (JPEG, PNG, WebP, or GIF)',
    })
    file: any;

    @ApiProperty({
        type: 'string',
        description: 'External user ID from your system',
        example: 'user-123',
    })
    @IsString()
    externalUserId: string;
}
