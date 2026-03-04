import { ConfigService } from '@nestjs/config';
export declare class MailService {
    private configService;
    private transporter;
    constructor(configService: ConfigService);
    sendResetPasswordEmail(to: string, token: string): Promise<void>;
}
