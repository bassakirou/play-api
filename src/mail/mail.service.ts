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

  async sendResetPasswordEmail(to: string, token: string, customAppUrl?: string) {
    const defaultUrl =
      this.configService.get<string>('APP_WEB_URL') || 'http://localhost:5173';
    const appUrl = customAppUrl || defaultUrl;
    const from = this.getFromAddress();
    const cleanUrl = appUrl.replace(/\/+$/, '');
    const resetLink = `${cleanUrl}/reset-password?token=${token}`;

    console.log(`[MailService] Sending password reset link to ${to}: ${resetLink}`);

    try {
      await this.transporter.sendMail({
        from,
        to,
        subject: 'Réinitialisation de votre mot de passe - PyramidPlay',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1e293b; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0;">
            <div style="margin-bottom: 20px; text-align: center;">
              <h1 style="color: #0f172a; font-size: 22px; font-weight: 700; margin: 0 0 8px 0;">Réinitialisation de votre mot de passe</h1>
              <p style="color: #64748b; font-size: 14px; margin: 0;">Vous avez demandé à réinitialiser le mot de passe de votre compte PyramidPlay.</p>
            </div>
            <div style="background-color: #f8fafc; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 20px;">
              <p style="font-size: 14px; color: #334155; margin: 0 0 16px 0;">Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe :</p>
              <a href="${resetLink}" style="display: inline-block; background-color: #f59e0b; color: #0b1326; font-weight: 700; font-size: 14px; text-decoration: none; padding: 12px 28px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">Réinitialiser mon mot de passe</a>
              <p style="font-size: 12px; color: #94a3b8; margin: 16px 0 0 0;">Ce lien expirera automatiquement dans 1 heure.</p>
            </div>
            <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; font-size: 12px; color: #94a3b8; line-height: 1.5;">
              <p style="margin: 0 0 8px 0;">Si le bouton ne fonctionne pas, vous pouvez copier-coller ce lien directement dans votre navigateur :</p>
              <p style="margin: 0; word-break: break-all;"><a href="${resetLink}" style="color: #d97706; text-decoration: underline;">${resetLink}</a></p>
              <p style="margin: 16px 0 0 0; color: #cbd5e1;">Si vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet e-mail en toute sécurité.</p>
            </div>
          </div>
        `,
      });
      console.log(`[MailService] Password reset email sent successfully to ${to}`);
    } catch (err: any) {
      console.error(`[MailService] Failed to deliver email to ${to}:`, err?.message || err);
      // In local development, don't crash if SMTP is unreachable, but log link
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[MailService] [DEV NOTICE] Reset link available: ${resetLink}`);
        return;
      }
      throw err;
    }
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
