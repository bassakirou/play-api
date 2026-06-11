import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST') || 'localhost';
    const port = Number(this.configService.get<string>('SMTP_PORT') || '1025');
    const secure =
      (this.configService.get<string>('SMTP_SECURE') || 'false') === 'true';
    const ignoreTLS =
      (this.configService.get<string>('SMTP_IGNORE_TLS') || 'false') === 'true';
    
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      ignoreTLS,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });
  }

  async sendResetPasswordEmail(to: string, token: string) {
    const appUrl =
      this.configService.get<string>('APP_WEB_URL') || 'http://localhost:5173';
    const from =
      this.configService.get<string>('SMTP_FROM') ||
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

  async sendPlatformAvailableEmail(to: string, platformUrl: string) {
    const from =
      this.configService.get<string>('SMTP_FROM') ||
      '"PyramidPlay Support" <support@pyramidplay.com>';

    await this.transporter.sendMail({
      from,
      to,
      subject: 'Pyramid Play est de nouveau disponible',
      html: `
        <h1>Pyramid Play est de retour</h1>
        <p>Bonne nouvelle, la plateforme est de nouveau disponible.</p>
        <p>Vous pouvez y acceder des maintenant en cliquant sur le lien ci-dessous :</p>
        <p><a href="${platformUrl}">Acceder a Pyramid Play</a></p>
        <p>Merci pour votre patience.</p>
      `,
    });
  }
}
