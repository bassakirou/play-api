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

    const ignoreTLSEffective = secure ? false : ignoreTLS;

    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      ignoreTLS: ignoreTLSEffective,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });
  }

  private getFromAddress() {
    return (
      this.configService.get<string>('SMTP_FROM') ||
      '"PyramidPlay Support" <support@pyramidplay.com>'
    );
  }

  private getMaintenanceAlertRecipients() {
    const configured =
      this.configService.get<string>('MAINTENANCE_ALERT_EMAILS') ||
      this.configService.get<string>('SMTP_USER') ||
      '';

    return configured
      .split(',')
      .map((email) => email.trim())
      .filter(Boolean);
  }

  async sendResetPasswordEmail(to: string, token: string) {
    const appUrl =
      this.configService.get<string>('APP_WEB_URL') || 'http://localhost:5173';
    const from = this.getFromAddress();
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

  async sendVerificationEmail(to: string, code: string) {
    const from = this.getFromAddress();
    
    await this.transporter.sendMail({
      from,
      to,
      subject: 'Code de validation Pyramid Play',
      html: `
        <h1>Validation de votre compte</h1>
        <p>Merci de vous être inscrit sur Pyramid Play !</p>
        <p>Voici votre code de validation à 6 chiffres :</p>
        <h2 style="font-size: 24px; padding: 10px; background: #f4f4f4; border-radius: 5px; display: inline-block;">${code}</h2>
        <p>Ce code expire dans 1 heure.</p>
        <p>Si vous n'avez pas créé de compte, vous pouvez ignorer cet email.</p>
      `,
    });
  }

  async sendPlatformAvailableEmail(to: string, platformUrl: string) {
    const from = this.getFromAddress();

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

  async sendMaintenanceSubscriptionAdminAlert(params: {
    subscriberEmail: string;
    total: number;
    pending: number;
    notified: number;
    subscribedAt: Date;
  }) {
    const recipients = this.getMaintenanceAlertRecipients();

    if (recipients.length === 0) {
      return { skipped: true };
    }

    await this.transporter.sendMail({
      from: this.getFromAddress(),
      to: recipients.join(', '),
      subject: `Nouvelle inscription maintenance: ${params.subscriberEmail}`,
      html: `
        <h1>Nouvelle inscription maintenance</h1>
        <p>Un nouvel utilisateur s est inscrit pour recevoir l alerte de disponibilite.</p>
        <ul>
          <li><strong>E-mail inscrit:</strong> ${params.subscriberEmail}</li>
          <li><strong>Date d inscription:</strong> ${params.subscribedAt.toISOString()}</li>
        </ul>
        <h2>Statistiques actuelles</h2>
        <ul>
          <li><strong>Total inscrits:</strong> ${params.total}</li>
          <li><strong>Alertes en attente:</strong> ${params.pending}</li>
          <li><strong>Alertes envoyees:</strong> ${params.notified}</li>
        </ul>
      `,
    });

    return { skipped: false, recipients };
  }

  async sendMaintenanceNotificationBatchAdminAlert(params: {
    sent: number;
    failed: number;
    failures: string[];
    total: number;
    pending: number;
    notified: number;
  }) {
    const recipients = this.getMaintenanceAlertRecipients();

    if (recipients.length === 0) {
      return { skipped: true };
    }

    const failureList =
      params.failures.length > 0
        ? `<p><strong>E-mails en echec:</strong> ${params.failures.join(', ')}</p>`
        : '';

    await this.transporter.sendMail({
      from: this.getFromAddress(),
      to: recipients.join(', '),
      subject: `Recap alertes maintenance: ${params.sent} e-mail(s) notifie(s)`,
      html: `
        <h1>Recapitulatif d envoi des alertes maintenance</h1>
        <p>La campagne d envoi des alertes de disponibilite vient de se terminer.</p>
        <ul>
          <li><strong>E-mails effectivement notifies:</strong> ${params.sent}</li>
          <li><strong>E-mails en echec:</strong> ${params.failed}</li>
        </ul>
        ${failureList}
        <h2>Statistiques apres envoi</h2>
        <ul>
          <li><strong>Total inscrits:</strong> ${params.total}</li>
          <li><strong>Alertes en attente:</strong> ${params.pending}</li>
          <li><strong>Alertes envoyees:</strong> ${params.notified}</li>
        </ul>
      `,
    });

    return { skipped: false, recipients };
  }
}
