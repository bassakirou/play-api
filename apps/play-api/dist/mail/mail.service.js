"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MailService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const nodemailer = require("nodemailer");
let MailService = class MailService {
    configService;
    transporter;
    constructor(configService) {
        this.configService = configService;
        const host = this.configService.get('SMTP_HOST') || 'localhost';
        const port = Number(this.configService.get('SMTP_PORT') || '1025');
        const secure = (this.configService.get('SMTP_SECURE') || 'false') === 'true';
        const ignoreTLS = (this.configService.get('SMTP_IGNORE_TLS') || 'true') === 'true';
        this.transporter = nodemailer.createTransport({
            host,
            port,
            secure,
            ignoreTLS,
        });
    }
    async sendResetPasswordEmail(to, token) {
        const appUrl = this.configService.get('APP_WEB_URL') || 'http://localhost:5173';
        const from = this.configService.get('SMTP_FROM') ||
            '"PyramidPlay Support" <support@pyramidplay.com>';
        const resetLink = `${appUrl.replace(/\/+$/, '')}/reset-password?token=${token}`;
        await this.transporter.sendMail({
            from,
            to,
            subject: 'Réinitialisation de votre mot de passe',
            html: `
        <h1>Réinitialisation de mot de passe</h1>
        <p>Vous avez demandé une réinitialisation de mot de passe.</p>
        <p>Cliquez sur le lien ci-dessous pour définir un nouveau mot de passe :</p>
        <a href="${resetLink}">Réinitialiser mon mot de passe</a>
        <p>Ce lien est valide pour 1 heure.</p>
        <p>Si vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet email.</p>
      `,
        });
    }
};
exports.MailService = MailService;
exports.MailService = MailService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], MailService);
//# sourceMappingURL=mail.service.js.map