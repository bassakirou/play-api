import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface TaraMobilePayRequest {
  productId: string;
  productName: string;
  productPrice: number;
  phoneNumber: string;
  webHookUrl?: string;
  returnUrl?: string;
  network?: string;
}

export interface TaraMobilePayResponse {
  message?: string;
  status?: string;
  vendor?: string;
  ussdCode?: string;
  authUrl?: string;
  simulated?: boolean;
  [key: string]: any;
}

export interface TaraPayoutRequest {
  receiverName: string;
  paymentMethod: 'MTN_MOBILE_MONEY' | 'ORANGE_MONEY' | string;
  receiverPhoneNumber: string;
  receiverId: string;
  amount: number;
}

export interface TaraPayoutResponse {
  status?: string;
  payoutId?: string;
  message?: string;
  [key: string]: any;
}

export interface TaraTransactionStatusResponse {
  status?: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'PAID' | string;
  amount?: string | number;
  productId?: string;
  paymentId?: string;
  [key: string]: any;
}

@Injectable()
export class TaraService {
  private readonly logger = new Logger(TaraService.name);
  private readonly defaultBaseUrl = 'https://www.dklo.co/api/tara';

  constructor(private readonly prisma: PrismaService) {}

  async getConfig() {
    let config = await this.prisma.monetizationConfig.findUnique({
      where: { id: 'default' },
    });
    if (!config) {
      config = await this.prisma.monetizationConfig.create({
        data: {
          id: 'default',
          taraApiKey: process.env.TARA_API_KEY || '',
          taraBusinessId: process.env.TARA_BUSINESS_ID || '',
          taraWebhookSecret: process.env.TARA_WEBHOOK_SECRET || '',
          taraBaseUrl: process.env.TARAMONEY_BASE_URL || this.defaultBaseUrl,
          taraReturnUrl: process.env.TARAMONEY_RETURN_URL || '',
          taraWebhookUrl: process.env.TARAMONEY_WEBHOOK_URL || '',
          isLiveMode: false,
          platformFeePercent: 30.0,
          creatorSharePercent: 70.0,
          minWithdrawalAmount: 5000,
          operatorOmFeePercent: 1.5,
          operatorMomoFeePercent: 1.5,
        },
      });
    }
    return config;
  }

  normalizePhoneNumber(phone: string): string {
    let clean = (phone || '').replace(/\D/g, '');
    if (clean.startsWith('00237')) clean = clean.substring(2);
    if (clean.startsWith('237') && clean.length === 12) return clean;
    if (clean.length === 9 && (clean.startsWith('6') || clean.startsWith('2'))) {
      return '237' + clean;
    }
    return clean;
  }

  private async taraPost<T>(path: string, payload: Record<string, any>): Promise<T> {
    const config = await this.getConfig();
    const apiKey = config.taraApiKey;
    const businessId = config.taraBusinessId;
    const baseUrl = config.taraBaseUrl?.trim() || this.defaultBaseUrl;

    if (!apiKey || !businessId) {
      this.logger.warn('Clés API Tara non configurées. Requête simulée en mode Sandbox pour ' + path);
      return {
        status: 'SUCCESS',
        message: 'SIMULATED_TEST_MODE',
        vendor: 'SIMULATED_LOCAL',
        simulated: true,
      } as any;
    }

    const url = baseUrl.replace(/\/+$/, '') + path;
    const body = {
      apiKey,
      businessId,
      ...payload,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });

      const data = (await response.json()) as any;

      if (!response.ok || (data.status && data.status.toUpperCase() === 'FAILURE')) {
        this.logger.error('Erreur Tara ' + path + ': ' + (data.message || response.statusText));
      }

      return data as T;
    } catch (error: any) {
      this.logger.error('Exception appel Tara ' + path + ': ' + error.message);
      throw error;
    }
  }

  async initiateMobilePay(request: TaraMobilePayRequest): Promise<TaraMobilePayResponse> {
    const config = await this.getConfig();
    const formattedPhone = this.normalizePhoneNumber(request.phoneNumber);
    const finalWebhookUrl = config.taraWebhookUrl?.trim() || request.webHookUrl;
    const finalReturnUrl = config.taraReturnUrl?.trim() || request.returnUrl;

    return this.taraPost<TaraMobilePayResponse>('/mobilepay', {
      productId: request.productId,
      productName: request.productName,
      productPrice: Math.round(request.productPrice),
      phoneNumber: formattedPhone,
      webHookUrl: finalWebhookUrl,
      ...(finalReturnUrl ? { returnUrl: finalReturnUrl } : {}),
      ...(request.network ? { network: request.network } : {}),
    });
  }

  async getTransactionStatus(productId: string): Promise<TaraTransactionStatusResponse> {
    return this.taraPost<TaraTransactionStatusResponse>('/transactions/status', {
      productId,
    });
  }

  async initiatePayout(request: TaraPayoutRequest): Promise<TaraPayoutResponse> {
    const formattedPhone = this.normalizePhoneNumber(request.receiverPhoneNumber);
    return this.taraPost<TaraPayoutResponse>('/payout/create', {
      receiverName: request.receiverName,
      paymentMethod: request.paymentMethod,
      receiverPhoneNumber: formattedPhone,
      receiverId: formattedPhone,
      amount: Math.round(request.amount),
    });
  }
}
