import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  OnModuleInit,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TaraService, TaraRequestRejectedError } from '../tara/tara.service';
import {
  UpdateMonetizationConfigDto,
  CreateGiftCatalogDto,
  UpdateGiftCatalogDto,
  InitiatePurchaseDto,
  SendGiftDto,
  SubscribeAcademicDto,
  CreateWithdrawalRequestDto,
  ReviewWithdrawalDto,
} from './dto/monetization.dto';

@Injectable()
export class MonetizationService implements OnModuleInit {
  private readonly logger = new Logger(MonetizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly taraService: TaraService,
  ) {}

  async onModuleInit() {
    try {
      const count = await this.prisma.giftCatalog.count();
      if (count === 0) {
        const defaults = [
          {
            name: 'LION',
            label: 'Lion Royal',
            amount: 100000,
            iconUrl: '/gifts/lion.png',
            description: 'Symbole de puissance, royauté et fierté ancestrale',
            order: 1,
          },
          {
            name: 'BAOBAB',
            label: 'Baobab Sacré',
            amount: 25000,
            iconUrl: '/gifts/baobab.png',
            description: 'Symbole de longévité, sagesse et ancrage',
            order: 2,
          },
          {
            name: 'MASQUE',
            label: 'Masque Cérémoniel',
            amount: 10000,
            iconUrl: '/gifts/mask.png',
            description: 'Symbole des ancêtres et de transmission',
            order: 3,
          },
          {
            name: 'DJEMBE',
            label: 'Djembé Rythmique',
            amount: 5000,
            iconUrl: '/gifts/djembe.png',
            description: 'Symbole du battement de cœur de l’Afrique',
            order: 4,
          },
          {
            name: 'TORTUE',
            label: 'Tortue de la Sagesse',
            amount: 2000,
            iconUrl: '/gifts/turtle.png',
            description: 'Symbole de patience, protection et persévérance',
            order: 5,
          },
          {
            name: 'CAURIS',
            label: 'Cauris Sacré',
            amount: 500,
            iconUrl: '/gifts/cowrie.png',
            description: 'Symbole de prospérité, divination et bénédiction',
            order: 6,
          },
        ];
        for (const item of defaults) {
          await this.prisma.giftCatalog.create({ data: item });
        }
        this.logger.log('Default African cosmogony gifts seeded successfully');
      }
    } catch (err) {
      this.logger.warn(
        'Could not seed default gifts: ' + (err as any)?.message,
      );
    }
  }

  async getConfig() {
    return this.taraService.getConfig();
  }

  async getAdminConfig() {
    const { taraApiKey, taraWebhookSecret, ...config } = await this.getConfig();
    return {
      ...config,
      taraApiKeyConfigured: Boolean(taraApiKey),
      taraWebhookSecretConfigured: Boolean(taraWebhookSecret),
    };
  }

  async isAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    return Boolean(
      user &&
      [user.role?.name, ...(user.systemRoles || [])].some((role) =>
        ['ADMIN', 'SUPER_ADMIN'].includes(role),
      ),
    );
  }

  async updateConfig(dto: UpdateMonetizationConfigDto) {
    const update = { ...dto };
    if (!update.taraApiKey) delete update.taraApiKey;
    if (!update.taraWebhookSecret) delete update.taraWebhookSecret;
    await this.prisma.monetizationConfig.upsert({
      where: { id: 'default' },
      update,
      create: {
        id: 'default',
        ...update,
      },
    });
    return this.getAdminConfig();
  }

  async getGiftCatalog(onlyActive = true) {
    return this.prisma.giftCatalog.findMany({
      where: onlyActive ? { isActive: true } : {},
      orderBy: [{ order: 'asc' }, { amount: 'asc' }],
    });
  }

  async createGiftItem(dto: CreateGiftCatalogDto) {
    const existing = await this.prisma.giftCatalog.findUnique({
      where: { name: dto.name.toUpperCase().trim() },
    });
    if (existing) {
      throw new BadRequestException('Un cadeau avec ce nom existe déjà.');
    }

    return this.prisma.giftCatalog.create({
      data: {
        name: dto.name.toUpperCase().trim(),
        label: dto.label,
        amount: Math.round(dto.amount),
        iconUrl: dto.iconUrl,
        description: dto.description,
        order: dto.order ?? 0,
        isActive: true,
      },
    });
  }

  async updateGiftItem(id: string, dto: UpdateGiftCatalogDto) {
    return this.prisma.giftCatalog.update({
      where: { id },
      data: dto,
    });
  }

  async deleteGiftItem(id: string) {
    return this.prisma.giftCatalog.delete({
      where: { id },
    });
  }

  async seedDefaultAfricanGifts() {
    const count = await this.prisma.giftCatalog.count();
    if (count === 0) {
      const defaultGifts = [
        {
          name: 'CAURIS',
          label: 'Cauris Sacré',
          amount: 500,
          iconUrl: '/assets/gifts/cauris.svg',
          description:
            'Symbole ancestral de prospérité et bénédiction en Afrique.',
          order: 1,
        },
        {
          name: 'TORTUE',
          label: 'Tortue de la Sagesse',
          amount: 2500,
          iconUrl: '/assets/gifts/tortue.svg',
          description: 'Symbole de longévité, persévérance et respect.',
          order: 2,
        },
        {
          name: 'BAOBAB',
          label: 'Baobab Millénaire',
          amount: 10000,
          iconUrl: '/assets/gifts/baobab.svg',
          description: 'Arbre de vie, force vitale et enracinement.',
          order: 3,
        },
        {
          name: 'PANTHERE',
          label: 'Panthère Noire',
          amount: 25000,
          iconUrl: '/assets/gifts/panthere.svg',
          description: 'Noblesse, agilité et distinction royale.',
          order: 4,
        },
        {
          name: 'ELEPHANT',
          label: 'Éléphant Majestueux',
          amount: 50000,
          iconUrl: '/assets/gifts/elephant.svg',
          description: 'Puissance immuable et grandeur continentale.',
          order: 5,
        },
        {
          name: 'LION',
          label: 'Lion Royal Indomptable',
          amount: 100000,
          iconUrl: '/assets/gifts/lion.svg',
          description: 'Hommage suprême de souveraineté et courage.',
          order: 6,
        },
      ];

      for (const gift of defaultGifts) {
        await this.prisma.giftCatalog.create({ data: gift });
      }
    }
  }

  async initiatePurchase(
    userId: string,
    dto: InitiatePurchaseDto,
    hostBaseUrl: string,
  ) {
    const requestProductId = dto.requestId
      ? 'PUR-' +
        createHash('sha256')
          .update(userId + ':' + dto.requestId)
          .digest('hex')
      : undefined;
    if (requestProductId) {
      const existing = await this.prisma.transaction.findFirst({
        where: { productId: requestProductId, userId },
      });
      if (existing) {
        if (
          existing.contentId !== dto.contentId ||
          existing.contentType !== dto.contentType
        )
          throw new BadRequestException('Identifiant de demande déjà utilisé.');
        return {
          transactionId: existing.id,
          productId: existing.productId,
          amount: existing.amount,
          status: existing.status,
          reused: true,
          providerStatus: (existing.metadata as any)?.providerStatus || 'UNKNOWN',
          ussdCode: (existing.metadata as any)?.ussdCode,
          authUrl: (existing.metadata as any)?.authUrl,
        };
      }
    }
    let contentTitle = '';
    let contentPrice = 0;
    let beneficiaryArtistId: string | null = null;
    let beneficiaryUserId: string | null = null;

    if (dto.contentType === 'SONG') {
      const song = await this.prisma.song.findUnique({
        where: { id: dto.contentId },
        include: { artists: true },
      });
      if (!song) throw new NotFoundException('Morceau introuvable.');
      if (!song.isMonetized || song.price <= 0) {
        throw new BadRequestException('Ce contenu est gratuit.');
      }
      contentTitle = song.title;
      contentPrice = this.purchasePrice(song.price, song.discountPrice);
      beneficiaryArtistId = song.artists[0]?.id || null;
      beneficiaryUserId = song.artists[0]?.userId || null;
    } else if (dto.contentType === 'ALBUM') {
      const album = await this.prisma.album.findUnique({
        where: { id: dto.contentId },
      });
      if (!album) throw new NotFoundException('Album introuvable.');
      if (!album.isMonetized || album.price <= 0) {
        throw new BadRequestException('Cet album est gratuit.');
      }
      contentTitle = album.title;
      contentPrice = this.purchasePrice(album.price, album.discountPrice);
      beneficiaryArtistId = album.artistId;
    } else if (dto.contentType === 'VIDEO') {
      const video = await this.prisma.video.findUnique({
        where: { id: dto.contentId },
        include: { artists: true },
      });
      if (!video) throw new NotFoundException('Vidéo introuvable.');
      if (!video.isMonetized || video.price <= 0) {
        throw new BadRequestException('Cette vidéo est gratuite.');
      }
      contentTitle = video.title;
      contentPrice = this.purchasePrice(video.price, video.discountPrice);
      beneficiaryArtistId = video.artists[0]?.id || null;
      beneficiaryUserId = video.userId || video.artists[0]?.userId || null;
    } else if (dto.contentType === 'AUDIOBOOK') {
      const book = await this.prisma.audiobook.findUnique({
        where: { id: dto.contentId },
        include: { authorUser: { include: { artistProfile: true } } },
      });
      if (!book) throw new NotFoundException('Livre audio introuvable.');
      if (!book.isMonetized || book.price <= 0) {
        throw new BadRequestException('Ce livre audio est gratuit.');
      }
      contentTitle = book.title;
      contentPrice = this.purchasePrice(book.price, book.discountPrice);
      beneficiaryArtistId = book.authorUser?.artistProfile?.id || null;
      beneficiaryUserId = book.authorUser?.id || null;
    } else if (dto.contentType === 'COURSE') {
      const course = await this.prisma.academicCourse.findUnique({
        where: { id: dto.contentId },
      });
      if (!course || !course.isPublished)
        throw new NotFoundException('Formation introuvable.');
      if (!course.isMonetized || course.price <= 0)
        throw new BadRequestException('Cette formation est gratuite.');
      contentTitle = course.title;
      contentPrice = this.purchasePrice(course.price, course.discountPrice);
      beneficiaryUserId = course.instructorId;
    } else {
      throw new BadRequestException('Type de contenu invalide.');
    }

    if (!beneficiaryUserId && beneficiaryArtistId) {
      beneficiaryUserId =
        (
          await this.prisma.artist.findUnique({
            where: { id: beneficiaryArtistId },
          })
        )?.userId || null;
    }
    if (!beneficiaryUserId)
      throw new BadRequestException('Compte bénéficiaire non défini.');
    if (!Number.isSafeInteger(contentPrice) || contentPrice <= 0)
      throw new BadRequestException('Prix invalide.');

    const alreadyBought = await this.prisma.userPurchasedContent.findUnique({
      where: {
        userId_contentId_contentType: {
          userId,
          contentId: dto.contentId,
          contentType: dto.contentType,
        },
      },
    });
    if (alreadyBought) {
      throw new BadRequestException('Vous avez déjà acheté ce contenu.');
    }

    const config = await this.getConfig();
    const platformFee = Math.round(
      (contentPrice * config.platformFeePercent) / 100,
    );
    const creatorShare = contentPrice - platformFee;
    const productId = requestProductId || 'PUR-' + randomUUID();

    let transaction;
    try {
      transaction = await this.prisma.transaction.create({
        data: {
          productId,
          userId,
          type: 'CONTENT_PURCHASE',
          amount: contentPrice,
          platformFee,
          creatorShare,
          status: 'PENDING',
          phoneNumber: this.taraService.normalizePhoneNumber(dto.phoneNumber),
          beneficiaryArtistId,
          beneficiaryUserId,
          contentId: dto.contentId,
          contentType: dto.contentType,
          metadata: {
            contentTitle,
          },
        },
      });
    } catch (error) {
      if ((error as any)?.code !== 'P2002' || !requestProductId) throw error;
      const existing = await this.prisma.transaction.findFirst({
        where: { productId: requestProductId, userId },
      });
      if (!existing) throw error;
      return {
        transactionId: existing.id,
        productId: existing.productId,
        amount: existing.amount,
        status: existing.status,
        reused: true,
          providerStatus: (existing.metadata as any)?.providerStatus || 'UNKNOWN',
          ussdCode: (existing.metadata as any)?.ussdCode,
          authUrl: (existing.metadata as any)?.authUrl,
      };
    }

    const webHookUrl = hostBaseUrl + '/monetization/webhook/tara';
    const taraRes = await this.taraService
      .initiateMobilePay({
        productId,
        productName: 'PyramidPlay - ' + contentTitle,
        productPrice: contentPrice,
        phoneNumber: dto.phoneNumber,
        webHookUrl,
      })
      .catch(
        (error) =>
          ({
            status:
              error instanceof TaraRequestRejectedError ? 'FAILURE' : 'UNKNOWN',
            message:
              error instanceof TaraRequestRejectedError
                ? 'Demande de paiement refusée.'
                : 'Résultat de la demande incertain. Conservez la référence et vérifiez son statut sans relancer le paiement.',
          }) as any,
      );

    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        paymentId: taraRes.paymentId ? String(taraRes.paymentId) : undefined,
        vendor: taraRes.vendor,
        metadata: { ...(transaction.metadata as any || {}), providerStatus: taraRes.status || 'UNKNOWN',
          ussdCode: typeof taraRes.ussdCode === 'string' ? taraRes.ussdCode : null,
          authUrl: typeof taraRes.authUrl === 'string' ? taraRes.authUrl : null },
        ...(taraRes.status === 'FAILURE' ? { status: 'FAILURE' } : {}),
      },
    });

    return {
      transactionId: transaction.id,
      productId,
      amount: contentPrice,
      ussdCode: taraRes.ussdCode,
      vendor: taraRes.vendor,
      status: taraRes.status === 'FAILURE' ? 'FAILURE' : 'PENDING',
      providerStatus: taraRes.status,
      authUrl: taraRes.authUrl,
      simulated: false,
      message: taraRes.message || 'Validation USSD envoyée sur le mobile.',
    };
  }

  async sendGift(userId: string | null, dto: SendGiftDto, hostBaseUrl: string) {
    if (!userId)
      throw new ForbiddenException('Connectez-vous pour envoyer un cadeau.');
    const productId = dto.requestId
      ? 'GIFT-' +
        createHash('sha256')
          .update(userId + ':' + dto.requestId)
          .digest('hex')
      : 'GIFT-' + randomUUID();
    const reuse = (existing: any) => {
      const metadata = existing.metadata || {};
      if (
        metadata.giftCatalogId !== dto.giftCatalogId ||
        metadata.recipientArtistId !== dto.recipientArtistId
      )
        throw new BadRequestException(
          'Demande déjà utilisée pour un autre cadeau.',
        );
      return {
        transactionId: existing.id,
        productId: existing.productId,
        amount: existing.amount,
        status: existing.status,
        reused: true,
          providerStatus: (existing.metadata as any)?.providerStatus || 'UNKNOWN',
          ussdCode: (existing.metadata as any)?.ussdCode,
          authUrl: (existing.metadata as any)?.authUrl,
      };
    };
    const existing = await this.prisma.transaction.findFirst({
      where: { productId, userId },
    });
    if (existing) return reuse(existing);
    const gift = await this.prisma.giftCatalog.findUnique({
      where: { id: dto.giftCatalogId },
    });
    if (!gift || !gift.isActive) {
      throw new NotFoundException('Cadeau introuvable ou inactif.');
    }

    const artist = await this.prisma.artist.findUnique({
      where: { id: dto.recipientArtistId },
    });
    if (!artist) {
      throw new NotFoundException('Artiste bénéficiaire introuvable.');
    }

    if (!artist.userId)
      throw new BadRequestException('Compte bénéficiaire non défini.');
    const config = await this.getConfig();
    const platformFee = Math.round(
      (gift.amount * config.platformFeePercent) / 100,
    );
    const creatorShare = gift.amount - platformFee;
    let transaction;
    try {
      transaction = await this.prisma.transaction.create({
        data: {
          productId,
          userId,
          type: 'GIFT',
          amount: gift.amount,
          platformFee,
          creatorShare,
          status: 'PENDING',
          phoneNumber: this.taraService.normalizePhoneNumber(dto.phoneNumber),
          beneficiaryArtistId: artist.id,
          beneficiaryUserId: artist.userId,
          metadata: {
            giftName: gift.name,
            giftLabel: gift.label,
            giftCatalogId: gift.id,
            recipientArtistId: artist.id,
            message: dto.message,
          },
        },
      });
    } catch (error) {
      if ((error as any)?.code !== 'P2002') throw error;
      const duplicate = await this.prisma.transaction.findFirst({
        where: { productId, userId },
      });
      if (!duplicate) throw error;
      return reuse(duplicate);
    }

    await this.prisma.giftTransaction.create({
      data: {
        transactionId: transaction.id,
        giftCatalogId: gift.id,
        senderUserId: userId,
        recipientArtistId: artist.id,
        message: dto.message,
      },
    });

    const webHookUrl = hostBaseUrl + '/monetization/webhook/tara';
    const taraRes = await this.taraService
      .initiateMobilePay({
        productId,
        productName:
          'Cadeau PyramidPlay - ' + gift.label + ' pour ' + artist.name,
        productPrice: gift.amount,
        phoneNumber: dto.phoneNumber,
        webHookUrl,
      })
      .catch(
        (error) =>
          ({
            status:
              error instanceof TaraRequestRejectedError ? 'FAILURE' : 'UNKNOWN',
            message:
              error instanceof TaraRequestRejectedError
                ? 'Demande de paiement refusée.'
                : 'Résultat de la demande incertain. Conservez la référence et vérifiez son statut sans relancer le paiement.',
          }) as any,
      );

    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        paymentId: taraRes.paymentId ? String(taraRes.paymentId) : undefined,
        vendor: taraRes.vendor,
        metadata: { ...(transaction.metadata as any || {}), providerStatus: taraRes.status || 'UNKNOWN',
          ussdCode: typeof taraRes.ussdCode === 'string' ? taraRes.ussdCode : null,
          authUrl: typeof taraRes.authUrl === 'string' ? taraRes.authUrl : null },
        ...(taraRes.status === 'FAILURE' ? { status: 'FAILURE' } : {}),
      },
    });

    return {
      transactionId: transaction.id,
      productId,
      amount: gift.amount,
      ussdCode: taraRes.ussdCode,
      vendor: taraRes.vendor,
      status: taraRes.status === 'FAILURE' ? 'FAILURE' : 'PENDING',
      providerStatus: taraRes.status,
      authUrl: taraRes.authUrl,
      simulated: false,
      message: taraRes.message || 'Validation USSD envoyée sur le mobile.',
    };
  }

  async subscribeAcademic(
    userId: string,
    dto: SubscribeAcademicDto,
    hostBaseUrl: string,
  ) {
    const productId = dto.requestId
      ? 'SUB-' +
        createHash('sha256')
          .update(userId + ':' + dto.requestId)
          .digest('hex')
      : 'SUB-' + randomUUID();
    const existing = await this.prisma.transaction.findFirst({
      where: { productId, userId },
    });
    if (existing)
      return {
        transactionId: existing.id,
        productId,
        amount: existing.amount,
        status: existing.status,
        reused: true,
          providerStatus: (existing.metadata as any)?.providerStatus || 'UNKNOWN',
          ussdCode: (existing.metadata as any)?.ussdCode,
          authUrl: (existing.metadata as any)?.authUrl,
      };
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    let plan = await this.prisma.subscriptionPlan.findUnique({
      where: { code: 'ACADEMIC_MONTHLY' },
    });
    if (!plan) {
      plan = await this.prisma.subscriptionPlan.create({
        data: {
          code: 'ACADEMIC_MONTHLY',
          name: 'Plan Créateur & Formateur Académique',
          targetRole: 'ACADEMIC',
          price: 5000,
          durationDays: 30,
          description:
            'Accès exclusif à la publication de formations, cours et contenus académiques sur PyramidPlay.',
          features: [
            'Publication de cours et vidéos académiques',
            'Publication de singles et livres audios académiques',
            'Acces a la publication academique',
            'Dashboard statistiques apprenants',
          ],
        },
      });
    }

    let transaction;
    try {
      transaction = await this.prisma.transaction.create({
        data: {
          productId,
          userId,
          type: 'ACADEMIC_SUBSCRIPTION',
          amount: plan.price,
          platformFee: plan.price,
          creatorShare: 0,
          status: 'PENDING',
          phoneNumber: this.taraService.normalizePhoneNumber(dto.phoneNumber),
          metadata: {
            planCode: plan.code,
            planName: plan.name,
          },
        },
      });
    } catch (error) {
      if ((error as any)?.code !== 'P2002') throw error;
      const duplicate = await this.prisma.transaction.findFirst({
        where: { productId, userId },
      });
      if (!duplicate) throw error;
      return {
        transactionId: duplicate.id,
        productId,
        amount: duplicate.amount,
        status: duplicate.status,
        reused: true,
        providerStatus: (duplicate.metadata as any)?.providerStatus || 'UNKNOWN',
        ussdCode: (duplicate.metadata as any)?.ussdCode,
        authUrl: (duplicate.metadata as any)?.authUrl,
      };
    }

    const webHookUrl = hostBaseUrl + '/monetization/webhook/tara';
    const taraRes = await this.taraService
      .initiateMobilePay({
        productId,
        productName: 'Abonnement PyramidPlay - ' + plan.name,
        productPrice: plan.price,
        phoneNumber: dto.phoneNumber,
        webHookUrl,
      })
      .catch(
        (error) =>
          ({
            status:
              error instanceof TaraRequestRejectedError ? 'FAILURE' : 'UNKNOWN',
            message:
              error instanceof TaraRequestRejectedError
                ? 'Demande de paiement refusée.'
                : 'Résultat de la demande incertain. Conservez la référence et vérifiez son statut sans relancer le paiement.',
          }) as any,
      );

    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        paymentId: taraRes.paymentId ? String(taraRes.paymentId) : undefined,
        vendor: taraRes.vendor,
        metadata: { ...(transaction.metadata as any || {}), providerStatus: taraRes.status || 'UNKNOWN',
          ussdCode: typeof taraRes.ussdCode === 'string' ? taraRes.ussdCode : null,
          authUrl: typeof taraRes.authUrl === 'string' ? taraRes.authUrl : null },
        ...(taraRes.status === 'FAILURE' ? { status: 'FAILURE' } : {}),
      },
    });

    return {
      transactionId: transaction.id,
      productId,
      amount: plan.price,
      ussdCode: taraRes.ussdCode,
      vendor: taraRes.vendor,
      status: taraRes.status === 'FAILURE' ? 'FAILURE' : 'PENDING',
      providerStatus: taraRes.status,
      authUrl: taraRes.authUrl,
      simulated: false,
      message: taraRes.message || 'Validation USSD envoyée sur le mobile.',
    };
  }

  private purchasePrice(price: number, discount?: number | null) {
    if (
      !Number.isSafeInteger(price) ||
      price <= 0 ||
      (discount != null &&
        (!Number.isSafeInteger(discount) || discount <= 0 || discount >= price))
    ) {
      throw new BadRequestException('Prix ou remise invalide.');
    }
    return discount ?? price;
  }

  async completeTransaction(
    productId: string,
    rawStatus: string,
    paymentId?: string,
    vendor?: string,
  ) {
    const status = (rawStatus || '').toUpperCase();
    if (!['SUCCESS', 'PAID', 'FAILURE', 'FAILED', 'CANCELLED'].includes(status))
      return;
    return this.prisma.$transaction(async (db) => {
      const transaction = await db.transaction.findFirst({
        where: { productId },
      });
      if (!transaction || transaction.status === 'SUCCESS') return;
      const success = ['SUCCESS', 'PAID'].includes(status);
      // Compare and swap makes grant and status one atomic idempotent operation.
      const claimed = await db.transaction.updateMany({
        where: { id: transaction.id, status: 'PENDING' },
        data: {
          status: success ? 'SUCCESS' : 'FAILURE',
          paymentId: paymentId || transaction.paymentId,
          vendor: vendor || transaction.vendor,
        },
      });
      if (!claimed.count || !success) return;
      if (
        transaction.type === 'CONTENT_PURCHASE' &&
        transaction.userId &&
        transaction.contentId &&
        transaction.contentType
      ) {
        await db.userPurchasedContent.upsert({
          where: {
            userId_contentId_contentType: {
              userId: transaction.userId,
              contentId: transaction.contentId,
              contentType: transaction.contentType,
            },
          },
          update: {},
          create: {
            userId: transaction.userId,
            contentId: transaction.contentId,
            contentType: transaction.contentType,
            pricePaid: transaction.amount,
            paymentId: paymentId || transaction.paymentId,
            title: (transaction.metadata as any)?.contentTitle || '',
          },
        });
      } else if (
        transaction.type === 'ACADEMIC_SUBSCRIPTION' &&
        transaction.userId
      ) {
        // Serialize concurrent renewals for this account before reading its expiry.
        await db.$queryRaw`SELECT id FROM "User" WHERE id = ${transaction.userId} FOR UPDATE`;
        const plan = await db.subscriptionPlan.findUnique({
          where: { code: 'ACADEMIC_MONTHLY' },
        });
        if (!plan) throw new BadRequestException('Plan introuvable.');
        const previous = await db.userSubscription.findFirst({
          where: {
            userId: transaction.userId,
            planId: plan.id,
            status: 'ACTIVE',
          },
          orderBy: { endDate: 'desc' },
        });
        const startDate = new Date(
          Math.max(Date.now(), previous?.endDate?.getTime() || 0),
        );
        await db.userSubscription.create({
          data: {
            userId: transaction.userId,
            planId: plan.id,
            transactionId: transaction.id,
            status: 'ACTIVE',
            startDate,
            endDate: new Date(
              startDate.getTime() + plan.durationDays * 86400000,
            ),
            paymentId: paymentId || transaction.paymentId,
          },
        });
        const user = await db.user.findUnique({
          where: { id: transaction.userId },
        });
        if (user && !user.systemRoles.includes('ACADEMIC'))
          await db.user.update({
            where: { id: user.id },
            data: { systemRoles: { push: 'ACADEMIC' } },
          });
      }
    });
  }

  private async reconcileTransaction(transaction: any) {
    if (transaction.status !== 'PENDING') return;
    const verified = await this.taraService.getTransactionStatus(
      transaction.productId,
    );
    if (verified.productId !== transaction.productId)
      throw new BadRequestException('Référence Tara non vérifiée.');
    const config = await this.getConfig();
    let evidence = verified;
    if (
      verified.amount == null &&
      ['SUCCESS', 'PAID'].includes((verified.status || '').toUpperCase())
    ) {
      evidence =
        (await this.taraService.findTransactionEvidence(
          transaction.productId,
          transaction.paymentId,
        )) || verified;
    }
    if (['SUCCESS', 'PAID'].includes((verified.status || '').toUpperCase())) {
      if (
        evidence.amount == null ||
        !Number.isSafeInteger(Number(evidence.amount)) ||
        Number(evidence.amount) !== transaction.amount
      )
        throw new BadRequestException('Montant Tara non vérifié.');
      if (
        (evidence.businessId &&
          evidence.businessId !== config.taraBusinessId) ||
        (evidence.currency &&
          evidence.currency !== (transaction.currency || 'XAF'))
      )
        throw new BadRequestException('Business ou devise Tara incorrect.');
      if (
        transaction.paymentId &&
        evidence.paymentId &&
        transaction.paymentId !== String(evidence.paymentId)
      )
        throw new BadRequestException('Paiement Tara incorrect.');
    }
    await this.completeTransaction(
      transaction.productId,
      verified.status || 'PENDING',
      evidence.paymentId ? String(evidence.paymentId) : transaction.paymentId,
      evidence.vendor,
    );
  }

  async handleTaraWebhook(body: any) {
    // Correlate only by server-issued product ID or an already stored provider reference.
    const productId =
      typeof body?.productId === 'string' ? body.productId : undefined;
    const paymentId = body?.paymentId ? String(body.paymentId) : undefined;
    if (!productId && !paymentId) return { received: true, matched: false };
    const transaction = await this.prisma.transaction.findFirst({
      where: productId ? { productId } : { paymentId },
    });
    if (transaction) await this.reconcileTransaction(transaction);
    return { received: true, matched: Boolean(transaction) };
  }

  async getCreatorMonetizationSummary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { artistProfile: true },
    });
    if (!user) {
      throw new ForbiddenException(
        'Compte créateur ou profil artiste non trouvé.',
      );
    }

    const artistId = user.artistProfile?.id || null;
    const config = await this.getConfig();

    const successfulTx = await this.prisma.transaction.findMany({
      where: {
        OR: [
          { beneficiaryUserId: userId },
          ...(artistId
            ? [{ beneficiaryUserId: null, beneficiaryArtistId: artistId }]
            : []),
        ],
        status: 'SUCCESS',
      },
    });

    const totalEarnedGross = successfulTx.reduce(
      (sum, tx) => sum + tx.amount,
      0,
    );
    const totalCreatorShare = successfulTx.reduce(
      (sum, tx) => sum + tx.creatorShare,
      0,
    );

    const withdrawals = await this.prisma.withdrawalRequest.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
    });

    const totalWithdrawnOrPending = withdrawals
      .filter((w) =>
        ['PAID', 'APPROVED', 'PROCESSING', 'INDETERMINATE', 'PENDING'].includes(
          w.status,
        ),
      )
      .reduce((sum, w) => sum + w.amountRequested, 0);

    const availableBalance = Math.max(
      0,
      totalCreatorShare - totalWithdrawnOrPending,
    );

    const [academicSubscription, academicPlan] = await Promise.all([
      this.prisma.userSubscription.findFirst({ where: { userId, plan: { code: 'ACADEMIC_MONTHLY' } }, orderBy: { endDate: 'desc' } }),
      this.prisma.subscriptionPlan.findUnique({ where: { code: 'ACADEMIC_MONTHLY' } }),
    ]);

    return {
      artistId,
      artistName: user.artistProfile?.name || user.name,
      userId,
      totalEarnedGross,
      totalCreatorShare,
      availableBalance,
      minWithdrawalAmount: config.minWithdrawalAmount,
      operatorOmFeePercent: config.operatorOmFeePercent,
      operatorMomoFeePercent: config.operatorMomoFeePercent,
      withdrawals,
      isAcademic: user.systemRoles?.includes('ACADEMIC') || false,
      academicSubscription,
      academicPrice: academicPlan?.price ?? 5000,
    };
  }

  async requestWithdrawal(userId: string, dto: CreateWithdrawalRequestDto) {
    if (
      !Number.isSafeInteger(dto.amountRequested) ||
      dto.amountRequested <= 0 ||
      !['ORANGE_MONEY', 'MTN_MOBILE_MONEY'].includes(dto.paymentMethod)
    )
      throw new BadRequestException('Retrait invalide.');
    if (
      !/^237[62]\d{8}$/.test(
        this.taraService.normalizePhoneNumber(dto.phoneNumber),
      )
    )
      throw new BadRequestException('Numéro invalide.');
    return this.prisma.$transaction(async (db) => {
      // All requests for the same creator share this row lock, including across API replicas.
      await db.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await db.user.findUnique({
        where: { id: userId },
        include: { artistProfile: true },
      });
      if (!user) throw new ForbiddenException('Compte introuvable.');
      const artistId = user.artistProfile?.id || null;
      const earnings = await db.transaction.findMany({
        where: {
          status: 'SUCCESS',
          OR: [
            { beneficiaryUserId: userId },
            ...(artistId
              ? [{ beneficiaryUserId: null, beneficiaryArtistId: artistId }]
              : []),
          ],
        },
      });
      const reserved = await db.withdrawalRequest.findMany({
        where: {
          userId,
          status: {
            in: ['PENDING', 'APPROVED', 'PROCESSING', 'INDETERMINATE', 'PAID'],
          },
        },
      });
      const balance =
        earnings.reduce((sum, t) => sum + t.creatorShare, 0) -
        reserved.reduce((sum, w) => sum + w.amountRequested, 0);
      const config = await this.getConfig();
      if (
        dto.amountRequested > balance ||
        dto.amountRequested < config.minWithdrawalAmount
      )
        throw new BadRequestException('Solde ou montant minimum insuffisant.');
      const fee =
        dto.paymentMethod === 'ORANGE_MONEY'
          ? config.operatorOmFeePercent
          : config.operatorMomoFeePercent;
      const operatorFees = Math.round((dto.amountRequested * fee) / 100);
      return db.withdrawalRequest.create({
        data: {
          userId,
          artistId,
          amountRequested: dto.amountRequested,
          operatorFees,
          netAmount: dto.amountRequested - operatorFees,
          paymentMethod: dto.paymentMethod,
          phoneNumber: this.taraService.normalizePhoneNumber(dto.phoneNumber),
          status: 'PENDING',
        },
      });
    });
  }

  async getAllWithdrawalRequests(status?: string) {
    return this.prisma.withdrawalRequest.findMany({
      where: status ? { status } : {},
      include: {
        artist: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async reviewWithdrawal(
    id: string,
    adminUserId: string,
    dto: ReviewWithdrawalDto,
  ) {
    const request = await this.prisma.withdrawalRequest.findUnique({
      where: { id },
      include: { artist: true, user: true },
    });
    if (!request) throw new NotFoundException('Demande introuvable.');
    const next = {
      REJECT: 'REJECTED',
      APPROVE: 'APPROVED',
      PAY_NOW: 'PROCESSING',
    }[dto.action];
    if (!next) throw new BadRequestException('Action invalide.');
    const allowed =
      dto.action === 'APPROVE' ? ['PENDING'] : ['PENDING', 'APPROVED'];
    const claimed = await this.prisma.withdrawalRequest.updateMany({
      where: { id, status: { in: allowed } },
      data: {
        status: next,
        processedById: adminUserId,
        processedAt: new Date(),
        ...(dto.action === 'REJECT'
          ? { rejectionReason: dto.rejectionReason || 'Refus administratif.' }
          : {}),
      },
    });
    if (!claimed.count)
      throw new BadRequestException(
        'Retrait déjà traité ou en attente de rapprochement.',
      );
    if (dto.action !== 'PAY_NOW')
      return this.prisma.withdrawalRequest.findUnique({ where: { id } });
    try {
      const payout = await this.taraService.initiatePayout({
        receiverName: request.user.name || request.artist?.name || 'Créateur',
        paymentMethod: request.paymentMethod,
        receiverPhoneNumber: request.phoneNumber,
        receiverId: request.phoneNumber,
        amount: request.netAmount,
      });
      // /payout/create SUCCESS documents initiation only. Keep the balance reserved until settlement is independently confirmed.
      return this.prisma.withdrawalRequest.update({
        where: { id },
        data: {
          status: 'PROCESSING',
          payoutId: payout.payoutId ? String(payout.payoutId) : undefined,
        },
      });
    } catch (error) {
      if (error instanceof TaraRequestRejectedError)
        return this.prisma.withdrawalRequest.update({
          where: { id },
          data: {
            status: 'REJECTED',
            rejectionReason: 'Refus du prestataire.',
          },
        });
      // A timeout or transport error may have occurred after money was sent: never automatically resend.
      return this.prisma.withdrawalRequest.update({
        where: { id },
        data: { status: 'INDETERMINATE' },
      });
    }
  }

  async getAdminStats() {
    const transactions = await this.prisma.transaction.findMany({
      where: { status: 'SUCCESS' },
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });

    const totalVolume = transactions.reduce((acc, t) => acc + t.amount, 0);
    const totalPlatformRevenue = transactions.reduce(
      (acc, t) => acc + t.platformFee,
      0,
    );
    const totalCreatorPayouts = transactions.reduce(
      (acc, t) => acc + t.creatorShare,
      0,
    );

    const byType = transactions.reduce((acc: any, t) => {
      acc[t.type] = (acc[t.type] || 0) + t.amount;
      return acc;
    }, {});

    const byOperator = transactions.reduce((acc: any, t) => {
      const op = t.vendor || 'AUTRE';
      acc[op] = (acc[op] || 0) + t.amount;
      return acc;
    }, {});

    const byArtistMap: Record<string, number> = {};
    transactions.forEach((t) => {
      if (t.beneficiaryArtistId) {
        byArtistMap[t.beneficiaryArtistId] =
          (byArtistMap[t.beneficiaryArtistId] || 0) + t.creatorShare;
      }
    });

    const topArtists = Object.entries(byArtistMap)
      .map(([artistId, revenue]) => ({ artistId, revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const enrichedTopArtists = await Promise.all(
      topArtists.map(async (entry) => {
        const artist = await this.prisma.artist.findUnique({
          where: { id: entry.artistId },
          select: { id: true, name: true, imageUrl: true, country: true },
        });
        return {
          ...entry,
          artist,
        };
      }),
    );

    const withdrawals = await this.prisma.withdrawalRequest.findMany();
    const totalPendingWithdrawals = withdrawals
      .filter((w) => w.status === 'PENDING')
      .reduce((sum, w) => sum + w.netAmount, 0);

    const totalPaidWithdrawals = withdrawals
      .filter((w) => w.status === 'PAID')
      .reduce((sum, w) => sum + w.netAmount, 0);

    return {
      totalVolume,
      totalPlatformRevenue,
      totalCreatorPayouts,
      totalPendingWithdrawals,
      totalPaidWithdrawals,
      byType,
      byOperator,
      topArtists: enrichedTopArtists,
      transactionCount: transactions.length,
      recentTransactions: transactions.slice(0, 15),
    };
  }

  async getUserPurchasedContents(userId: string) {
    const purchases = await this.prisma.userPurchasedContent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const enriched = await Promise.all(
      purchases.map(async (p) => {
        let details: any = null;
        if (p.contentType === 'SONG') {
          details = await this.prisma.song.findUnique({
            where: { id: p.contentId },
            include: { artists: true, album: true },
          });
        } else if (p.contentType === 'ALBUM') {
          details = await this.prisma.album.findUnique({
            where: { id: p.contentId },
            include: { artist: true, songs: true },
          });
        } else if (p.contentType === 'VIDEO') {
          details = await this.prisma.video.findUnique({
            where: { id: p.contentId },
            include: { artists: true },
          });
        } else if (p.contentType === 'AUDIOBOOK') {
          details = await this.prisma.audiobook.findUnique({
            where: { id: p.contentId },
            include: { chapters: true },
          });
        } else if (p.contentType === 'COURSE') {
          details = await this.prisma.academicCourse.findUnique({
            where: { id: p.contentId },
          });
        }
        return {
          ...p,
          details,
        };
      }),
    );

    return enriched;
  }

  private async reconcilePendingBounded(tx: any) {
    if (tx.status !== 'PENDING') return;
    // Persist the throttle and attempt count, avoiding an unbounded provider call on every poll.
    await this.prisma.$transaction(async (db) => {
      const rows = await db.$queryRaw<
        any[]
      >`SELECT id FROM "Transaction" WHERE id = ${tx.id} FOR UPDATE`;
      if (!rows.length) return;
      const fresh = await db.transaction.findFirst({ where: { id: tx.id } });
      const metadata: any = fresh?.metadata || {};
      if (
        !fresh ||
        fresh.status !== 'PENDING' ||
        Date.now() - (metadata.reconciledAt || 0) < 30000
      )
        return;
      await db.transaction.update({
        where: { id: tx.id },
        data: {
          metadata: {
            ...metadata,
            reconciledAt: Date.now(),
            reconcileAttempts: (metadata.reconcileAttempts || 0) + 1,
          },
        },
      });
      tx.reconcileClaimed = true;
    });
    if (tx.reconcileClaimed) {
      try {
        await this.reconcileTransaction(tx);
        const fresh = await this.prisma.transaction.findFirst({ where: { id: tx.id } });
        await this.prisma.transaction.update({ where: { id: tx.id }, data: { metadata: { ...(fresh?.metadata as any || {}), verificationError: null } } });
      } catch (error) {
        this.logger.warn('Rapprochement Tara différé.');
        const code = error instanceof Error && error.message === 'TRANSACTION_NOT_FOUND' ? 'TRANSACTION_NOT_FOUND' : 'PROVIDER_UNAVAILABLE';
        const fresh = await this.prisma.transaction.findFirst({ where: { id: tx.id } });
        await this.prisma.transaction.update({ where: { id: tx.id }, data: { metadata: { ...(fresh?.metadata as any || {}), verificationError: code } } });
      }
    }
  }

  async getTransactionStatus(id: string, userId: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: {
        OR: [{ id }, { productId: id }],
      },
    });
    if (!tx) throw new NotFoundException('Transaction introuvable.');
    if (tx.userId !== userId && !(await this.isAdmin(userId)))
      throw new ForbiddenException('Transaction privée.');
    await this.reconcilePendingBounded(tx);
    const current =
      (await this.prisma.transaction.findFirst({ where: { id: tx.id } })) || tx;
    return {
      id: tx.id,
      productId: tx.productId,
      status: current.status,
      verificationError: current.status === 'PENDING' ? (current.metadata as any)?.verificationError || null : null,
      amount: tx.amount,
      type: tx.type,
    };
  }
}
