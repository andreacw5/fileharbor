import { UsersService } from './users.service';
import {
    BadRequestException,
    Controller,
    Logger,
    Post,
    Req,
    UploadedFile,
    UseInterceptors
} from '@nestjs/common';
import { Express } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { v4 as uuidv4 } from "uuid";
import LocalFilesInterceptor from "../localFiles/localFiles.interceptor";

@Controller()
export class UsersController {
    constructor(
        private readonly usersService: UsersService,
    ) {}
    private readonly logger = new Logger(UsersController.name);

    @Post('avatar')
    @UseInterceptors(LocalFilesInterceptor({
        fieldName: 'file',
        path: './uploads/avatars/' + new Date().getFullYear() + '/' + (new Date().getMonth() + 1),
        fileFilter: (request, file, callback) => {
            if (!file.mimetype.includes('image')) {
                return callback(new BadRequestException('Image type not allowed, chose another file'), false);
            }
            callback(null, true);
        },
        limits: {
            fileSize: Math.pow(1024, 2) // 1MB
        }
    }))
    async addAvatar(@Req() request, @UploadedFile() file: Express.Multer.File) {
        this.logger.log(`Received new avatar file: ${file.originalname}`);
        const uuid = uuidv4();
        return this.usersService.addAvatar({
            id: uuid,
            path: file.path,
            filename: file.originalname,
            mimetype: file.mimetype
        });
    }
}
