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

export class TaraRequestRejectedError extends Error {
  constructor(message: string, public readonly code = 'TARA_REQUEST_REJECTED') {
    super(message);
    this.name = 'TaraRequestRejectedError';
  }
}
export class TaraLookupUnavailableError extends Error {
  constructor(public readonly code: 'TRANSACTION_NOT_FOUND' | 'PROVIDER_UNAVAILABLE') {
    super(code);
  }
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
    if (
      clean.length === 9 &&
      (clean.startsWith('6') || clean.startsWith('2'))
    ) {
      return '237' + clean;
    }
    return clean;
  }

  private async taraPost<T>(
    path: string,
    payload: Record<string, any>,
    rejectBusinessFailure = true,
  ): Promise<T> {
    const config = await this.getConfig();
    const apiKey = config.taraApiKey;
    const businessId = config.taraBusinessId;
    const baseUrl = config.taraBaseUrl?.trim() || this.defaultBaseUrl;

    const reference = typeof payload.productId === 'string' ? payload.productId : undefined;
    if (!apiKey?.trim() || !businessId?.trim()) {
      this.logger.warn({ event: 'tara.config_missing', path, reference });
      throw new TaraRequestRejectedError(
        'Paiement indisponible : la configuration Tara du marchand est incomplète.',
        'TARA_NOT_CONFIGURED',
      );
    }
    // Credentials may only be sent to the trusted provider origin.
    if (new URL(baseUrl).origin !== 'https://www.dklo.co') {
      throw new TaraRequestRejectedError('Origine Tara non autorisée.');
    }

    const url = baseUrl.replace(/\/+$/, '') + path;
    const body = {
      apiKey,
      businessId,
      ...payload,
    };
    const startedAt = Date.now();
    this.logger.log({ event: 'tara.request', path, reference });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(path === '/mobilepay' ? 60_000 : 15_000),
        redirect: 'error',
      });

      const data = (await response.json()) as any;
      this.logger.log({
        event: 'tara.response', path, reference,
        httpStatus: response.status,
        providerStatus: typeof data?.status === 'string' ? data.status.slice(0, 40) : 'UNKNOWN',
        providerCode: typeof data?.message === 'string' && /^[A-Z_]{1,60}$/.test(data.message) ? data.message : undefined,
        elapsedMs: Date.now() - startedAt,
      });

      if (!response.ok) throw new Error('Réponse HTTP Tara indéterminée.');
      if (path === '/mobilepay' && rejectBusinessFailure && !['SUCCESS', 'PENDING', 'FAILURE', 'FAILED'].includes(String(data.status).toUpperCase())) {
        throw new Error('Résultat Tara indéterminé.');
      }
      if (
        rejectBusinessFailure &&
        ['FAILURE', 'FAILED'].includes(String(data.status).toUpperCase())
      ) {
        throw new TaraRequestRejectedError('Tara a refusé la requête.');
      }

      return data as T;
    } catch (error: any) {
      this.logger.error({ event: 'tara.error', path, reference,
        elapsedMs: Date.now() - startedAt,
        errorType: error instanceof Error ? error.name : 'UnknownError' });
      throw error;
    }
  }

  async initiateMobilePay(
    request: TaraMobilePayRequest,
  ): Promise<TaraMobilePayResponse> {
    const config = await this.getConfig();
    const formattedPhone = this.normalizePhoneNumber(request.phoneNumber);
    const localWebhook =
      process.env.NODE_ENV !== 'production'
        ? process.env.TARA_LOCAL_WEBHOOK_URL?.trim()
        : undefined;
    const finalWebhookUrl =
      localWebhook || config.taraWebhookUrl?.trim() || request.webHookUrl;
    const finalReturnUrl = config.taraReturnUrl?.trim() || request.returnUrl;

    if (!/^237[62]\d{8}$/.test(formattedPhone))
      throw new TaraRequestRejectedError('Numéro camerounais invalide.');
    if (
      !Number.isSafeInteger(request.productPrice) ||
      request.productPrice <= 0
    )
      throw new TaraRequestRejectedError('Montant invalide.');
    if (!finalWebhookUrl?.startsWith('https://'))
      throw new TaraRequestRejectedError('Webhook HTTPS requis.');
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

  async getTransactionStatus(
    productId: string,
  ): Promise<TaraTransactionStatusResponse> {
    const response = await this.taraPost<TaraTransactionStatusResponse>(
      '/transactions/status',
      {
        productId,
      },
      false,
    );
    if (String(response.status).toUpperCase() === 'ERROR') {
      throw new TaraLookupUnavailableError(response.message === 'TRANSACTION_NOT_FOUND' ? 'TRANSACTION_NOT_FOUND' : 'PROVIDER_UNAVAILABLE');
    }
    const object = (value: unknown): Record<string, any> | undefined => {
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {
          return undefined;
        }
      }
      return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, any>)
        : undefined;
    };
    // The live API wraps payment evidence in JSON strings; envelope SUCCESS is
    // lookup success, whereas payload/paymentData contain the collection state.
    const payload = object(response.payload);
    const data = object(response.paymentData);
    if (!payload && !data) return response;
    if (
      payload?.productId &&
      data?.productId &&
      payload.productId !== data.productId
    )
      throw new Error('Inconsistent Tara payment references');
    return {
      productId: payload?.productId || data?.productId,
      paymentId: payload?.paymentId
        ? String(payload.paymentId)
        : response.paymentId,
      status:
        String(response.status).toUpperCase() === 'SUCCESS'
          ? String(
              payload?.paymentStatus ||
                payload?.status ||
                data?.paymentStatus ||
                'PENDING',
            ).toUpperCase()
          : String(response.status || 'PENDING').toUpperCase(),
      // Original amount is the order price; amount can be net of operator fees.
      amount:
        payload?.originalAmount ??
        data?.originalAmount ??
        payload?.amount ??
        data?.amount,
      businessId: payload?.businessId || data?.businessId,
      currency: payload?.currency || data?.currency || response.currency,
      vendor: payload?.mobileOperator || data?.mobileOperator,
    };
  }

  async findTransactionEvidence(
    productId: string,
    paymentId?: string,
  ): Promise<TaraTransactionStatusResponse | undefined> {
    // Bounded lookup; fail closed when Tara does not expose correlatable amount evidence.
    const rows = await this.taraPost<any>('/transactionlist', {
      start: 0,
      size: 100,
    });
    const transactions = Array.isArray(rows)
      ? rows
      : Array.isArray(rows?.transactionList)
        ? rows.transactionList
        : [];
    // Collection aggregates (totalAmount/realAmount) are not payment evidence.
    return transactions.find(
      (row) =>
        row.amount != null &&
        (row.productId === productId ||
          (paymentId && String(row.paymentId) === paymentId)),
    );
  }

  async initiatePayout(
    request: TaraPayoutRequest,
  ): Promise<TaraPayoutResponse> {
    const formattedPhone = this.normalizePhoneNumber(
      request.receiverPhoneNumber,
    );
    return this.taraPost<TaraPayoutResponse>('/payout/create', {
      receiverName: request.receiverName,
      paymentMethod: request.paymentMethod,
      receiverPhoneNumber: formattedPhone,
      receiverId: formattedPhone,
      amount: Math.round(request.amount),
    });
  }
}
