import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TaraService } from '../tara/tara.service';
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
          { name: 'LION', label: 'Lion Royal', amount: 100000, iconUrl: '/gifts/lion.png', description: 'Symbole de puissance, royauté et fierté ancestrale', order: 1 },
          { name: 'BAOBAB', label: 'Baobab Sacré', amount: 25000, iconUrl: '/gifts/baobab.png', description: 'Symbole de longévité, sagesse et ancrage', order: 2 },
          { name: 'MASQUE', label: 'Masque Cérémoniel', amount: 10000, iconUrl: '/gifts/mask.png', description: 'Symbole des ancêtres et de transmission', order: 3 },
          { name: 'DJEMBE', label: 'Djembé Rythmique', amount: 5000, iconUrl: '/gifts/djembe.png', description: 'Symbole du battement de cœur de l’Afrique', order: 4 },
          { name: 'TORTUE', label: 'Tortue de la Sagesse', amount: 2000, iconUrl: '/gifts/turtle.png', description: 'Symbole de patience, protection et persévérance', order: 5 },
          { name: 'CAURIS', label: 'Cauris Sacré', amount: 500, iconUrl: '/gifts/cowrie.png', description: 'Symbole de prospérité, divination et bénédiction', order: 6 },
        ];
        for (const item of defaults) {
          await this.prisma.giftCatalog.create({ data: item });
        }
        this.logger.log('Default African cosmogony gifts seeded successfully');
      }
    } catch (err) {
      this.logger.warn('Could not seed default gifts: ' + (err as any)?.message);
    }
  }

  async getConfig() {
    return this.taraService.getConfig();
  }

  async updateConfig(dto: UpdateMonetizationConfigDto) {
    return this.prisma.monetizationConfig.upsert({
      where: { id: 'default' },
      update: dto,
      create: {
        id: 'default',
        ...dto,
      },
    });
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
          description: "Symbole ancestral de prospérité et bénédiction en Afrique.",
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

  async initiatePurchase(userId: string, dto: InitiatePurchaseDto, hostBaseUrl: string) {
    let contentTitle = '';
    let contentPrice = 0;
    let beneficiaryArtistId: string | null = null;

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
      contentPrice = song.discountPrice && song.discountPrice > 0 ? song.discountPrice : song.price;
      beneficiaryArtistId = song.artists[0]?.id || null;
    } else if (dto.contentType === 'ALBUM') {
      const album = await this.prisma.album.findUnique({
        where: { id: dto.contentId },
      });
      if (!album) throw new NotFoundException('Album introuvable.');
      if (!album.isMonetized || album.price <= 0) {
        throw new BadRequestException('Cet album est gratuit.');
      }
      contentTitle = album.title;
      contentPrice = album.discountPrice && album.discountPrice > 0 ? album.discountPrice : album.price;
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
      contentPrice = video.discountPrice && video.discountPrice > 0 ? video.discountPrice : video.price;
      beneficiaryArtistId = video.artists[0]?.id || null;
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
      contentPrice = book.discountPrice && book.discountPrice > 0 ? book.discountPrice : book.price;
      beneficiaryArtistId = book.authorUser?.artistProfile?.id || null;
    } else {
      throw new BadRequestException('Type de contenu invalide.');
    }

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
    const platformFee = Math.round((contentPrice * config.platformFeePercent) / 100);
    const creatorShare = contentPrice - platformFee;
    const productId = 'PUR-' + Date.now() + '-' + Math.floor(Math.random() * 10000);

    const transaction = await this.prisma.transaction.create({
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
        contentId: dto.contentId,
        contentType: dto.contentType,
        metadata: {
          contentTitle,
        },
      },
    });

    const webHookUrl = hostBaseUrl + '/monetization/webhook/tara';
    const taraRes = await this.taraService.initiateMobilePay({
      productId,
      productName: 'PyramidPlay - ' + contentTitle,
      productPrice: contentPrice,
      phoneNumber: dto.phoneNumber,
      webHookUrl,
    });

    if (taraRes.simulated) {
      await this.completeTransaction(productId, taraRes.status || 'SUCCESS', 'SIM_PAYMENT_ID');
    }

    return {
      transactionId: transaction.id,
      productId,
      amount: contentPrice,
      ussdCode: taraRes.ussdCode,
      vendor: taraRes.vendor,
      status: taraRes.status || 'PENDING',
      message: taraRes.message || 'Validation USSD envoyée sur le mobile.',
    };
  }

  async sendGift(userId: string | null, dto: SendGiftDto, hostBaseUrl: string) {
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

    const config = await this.getConfig();
    const platformFee = Math.round((gift.amount * config.platformFeePercent) / 100);
    const creatorShare = gift.amount - platformFee;
    const productId = 'GIFT-' + Date.now() + '-' + Math.floor(Math.random() * 10000);

    const transaction = await this.prisma.transaction.create({
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
        metadata: {
          giftName: gift.name,
          giftLabel: gift.label,
          message: dto.message,
        },
      },
    });

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
    const taraRes = await this.taraService.initiateMobilePay({
      productId,
      productName: 'Cadeau PyramidPlay - ' + gift.label + ' pour ' + artist.name,
      productPrice: gift.amount,
      phoneNumber: dto.phoneNumber,
      webHookUrl,
    });

    if (taraRes.simulated) {
      await this.completeTransaction(productId, taraRes.status || 'SUCCESS', 'SIM_GIFT_PAYMENT_ID');
    }

    return {
      transactionId: transaction.id,
      productId,
      amount: gift.amount,
      ussdCode: taraRes.ussdCode,
      vendor: taraRes.vendor,
      status: taraRes.status || 'PENDING',
      message: taraRes.message || 'Validation USSD envoyée sur le mobile.',
    };
  }

  async subscribeAcademic(userId: string, dto: SubscribeAcademicDto, hostBaseUrl: string) {
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
          description: 'Accès exclusif à la publication de formations, cours et contenus académiques sur PyramidPlay.',
          features: [
            'Publication de cours et vidéos académiques',
            'Publication de singles et livres audios académiques',
            'Badge Créateur Académique Certifié',
            'Dashboard statistiques apprenants',
          ],
        },
      });
    }

    const productId = 'SUB-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
    const transaction = await this.prisma.transaction.create({
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

    const webHookUrl = hostBaseUrl + '/monetization/webhook/tara';
    const taraRes = await this.taraService.initiateMobilePay({
      productId,
      productName: 'Abonnement PyramidPlay - ' + plan.name,
      productPrice: plan.price,
      phoneNumber: dto.phoneNumber,
      webHookUrl,
    });

    if (taraRes.simulated) {
      await this.completeTransaction(productId, taraRes.status || 'SUCCESS', 'SIM_SUB_PAYMENT_ID');
    }

    return {
      transactionId: transaction.id,
      productId,
      amount: plan.price,
      ussdCode: taraRes.ussdCode,
      vendor: taraRes.vendor,
      status: taraRes.status || 'PENDING',
      message: taraRes.message || 'Validation USSD envoyée sur le mobile.',
    };
  }

  async completeTransaction(productId: string, rawStatus: string, paymentId?: string, vendor?: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: { productId },
      include: { giftTransaction: true },
    });
    if (!transaction) {
      this.logger.warn('Transaction introuvable pour productId: ' + productId);
      return;
    }

    if (transaction.status === 'SUCCESS') {
      return;
    }

    const isSuccess = ['SUCCESS', 'PAID', 'API_ORDER_SUCESSFULL'].includes((rawStatus || '').toUpperCase());
    const finalStatus = isSuccess ? 'SUCCESS' : 'FAILURE';

    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: finalStatus,
        paymentId: paymentId || transaction.paymentId,
        vendor: vendor || transaction.vendor,
      },
    });

    if (finalStatus === 'SUCCESS') {
      if (transaction.type === 'CONTENT_PURCHASE' && transaction.userId && transaction.contentId && transaction.contentType) {
        await this.prisma.userPurchasedContent.upsert({
          where: {
            userId_contentId_contentType: {
              userId: transaction.userId,
              contentId: transaction.contentId,
              contentType: transaction.contentType,
            },
          },
          update: {
            paymentId: paymentId || transaction.paymentId,
          },
          create: {
            userId: transaction.userId,
            contentId: transaction.contentId,
            contentType: transaction.contentType,
            pricePaid: transaction.amount,
            paymentId: paymentId || transaction.paymentId,
            title: (transaction.metadata as any)?.contentTitle || '',
          },
        });
      } else if (transaction.type === 'ACADEMIC_SUBSCRIPTION' && transaction.userId) {
        const plan = await this.prisma.subscriptionPlan.findUnique({
          where: { code: 'ACADEMIC_MONTHLY' },
        });
        if (plan) {
          const startDate = new Date();
          const endDate = new Date();
          endDate.setDate(endDate.getDate() + plan.durationDays);

          await this.prisma.userSubscription.create({
            data: {
              userId: transaction.userId,
              planId: plan.id,
              status: 'ACTIVE',
              startDate,
              endDate,
              paymentId: paymentId || transaction.paymentId,
            },
          });

          const user = await this.prisma.user.findUnique({ where: { id: transaction.userId } });
          if (user) {
            const currentRoles = user.systemRoles || [];
            if (!currentRoles.includes('ACADEMIC')) {
              await this.prisma.user.update({
                where: { id: user.id },
                data: {
                  systemRoles: [...currentRoles, 'ACADEMIC'],
                },
              });
            }
          }
        }
      }
    }
  }

  async handleTaraWebhook(body: any) {
    this.logger.log('Webhook Tara reçu: ' + JSON.stringify(body));
    const { productId, paymentId, status, vendor } = body;

    if (productId) {
      await this.completeTransaction(productId, status, paymentId ? String(paymentId) : undefined, vendor);
    }
    return { received: true };
  }

  async getCreatorMonetizationSummary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { artistProfile: true },
    });
    if (!user || !user.artistProfile) {
      throw new ForbiddenException('Compte créateur ou profil artiste non trouvé.');
    }

    const artistId = user.artistProfile.id;
    const config = await this.getConfig();

    const successfulTx = await this.prisma.transaction.findMany({
      where: {
        beneficiaryArtistId: artistId,
        status: 'SUCCESS',
      },
    });

    const totalEarnedGross = successfulTx.reduce((sum, tx) => sum + tx.amount, 0);
    const totalCreatorShare = successfulTx.reduce((sum, tx) => sum + tx.creatorShare, 0);

    const withdrawals = await this.prisma.withdrawalRequest.findMany({
      where: { artistId },
      orderBy: { requestedAt: 'desc' },
    });

    const totalWithdrawnOrPending = withdrawals
      .filter((w) => ['PAID', 'APPROVED', 'PROCESSING', 'PENDING'].includes(w.status))
      .reduce((sum, w) => sum + w.amountRequested, 0);

    const availableBalance = Math.max(0, totalCreatorShare - totalWithdrawnOrPending);

    return {
      artistId,
      artistName: user.artistProfile.name,
      totalEarnedGross,
      totalCreatorShare,
      availableBalance,
      minWithdrawalAmount: config.minWithdrawalAmount,
      operatorOmFeePercent: config.operatorOmFeePercent,
      operatorMomoFeePercent: config.operatorMomoFeePercent,
      withdrawals,
      isAcademic: user.systemRoles?.includes('ACADEMIC') || false,
    };
  }

  async requestWithdrawal(userId: string, dto: CreateWithdrawalRequestDto) {
    const summary = await this.getCreatorMonetizationSummary(userId);
    if (dto.amountRequested > summary.availableBalance) {
      throw new BadRequestException('Solde disponible insuffisant pour ce montant.');
    }

    if (dto.amountRequested < summary.minWithdrawalAmount) {
      throw new BadRequestException('Le montant minimum de retrait est de ' + summary.minWithdrawalAmount + ' XAF.');
    }

    const config = await this.getConfig();
    const feePercent = dto.paymentMethod === 'ORANGE_MONEY' ? config.operatorOmFeePercent : config.operatorMomoFeePercent;
    const operatorFees = Math.round((dto.amountRequested * feePercent) / 100);
    const netAmount = dto.amountRequested - operatorFees;

    return this.prisma.withdrawalRequest.create({
      data: {
        userId,
        artistId: summary.artistId,
        amountRequested: Math.round(dto.amountRequested),
        operatorFees,
        netAmount,
        paymentMethod: dto.paymentMethod,
        phoneNumber: this.taraService.normalizePhoneNumber(dto.phoneNumber),
        status: 'PENDING',
      },
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

  async reviewWithdrawal(id: string, adminUserId: string, dto: ReviewWithdrawalDto) {
    const request = await this.prisma.withdrawalRequest.findUnique({
      where: { id },
      include: { artist: true },
    });
    if (!request) throw new NotFoundException('Demande de retrait introuvable.');

    if (dto.action === 'REJECT') {
      return this.prisma.withdrawalRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectionReason: dto.rejectionReason || "Refusé par l'administration.",
          processedById: adminUserId,
          processedAt: new Date(),
        },
      });
    }

    if (dto.action === 'APPROVE') {
      return this.prisma.withdrawalRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          processedById: adminUserId,
          processedAt: new Date(),
        },
      });
    }

    if (dto.action === 'PAY_NOW') {
      const taraPayout = await this.taraService.initiatePayout({
        receiverName: request.artist.name,
        paymentMethod: request.paymentMethod,
        receiverPhoneNumber: request.phoneNumber,
        receiverId: request.phoneNumber,
        amount: request.netAmount,
      });

      return this.prisma.withdrawalRequest.update({
        where: { id },
        data: {
          status: 'PAID',
          payoutId: taraPayout.payoutId || ('SIM-PO-' + Date.now()),
          processedById: adminUserId,
          processedAt: new Date(),
        },
      });
    }

    throw new BadRequestException('Action invalide.');
  }

  async getAdminStats() {
    const transactions = await this.prisma.transaction.findMany({
      where: { status: 'SUCCESS' },
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });

    const totalVolume = transactions.reduce((acc, t) => acc + t.amount, 0);
    const totalPlatformRevenue = transactions.reduce((acc, t) => acc + t.platformFee, 0);
    const totalCreatorPayouts = transactions.reduce((acc, t) => acc + t.creatorShare, 0);

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
        byArtistMap[t.beneficiaryArtistId] = (byArtistMap[t.beneficiaryArtistId] || 0) + t.creatorShare;
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
        }
        return {
          ...p,
          details,
        };
      }),
    );

    return enriched;
  }

  async getTransactionStatus(id: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: {
        OR: [{ id }, { productId: id }],
      },
    });
    if (!tx) throw new NotFoundException('Transaction introuvable.');
    return {
      id: tx.id,
      productId: tx.productId,
      status: tx.status,
      amount: tx.amount,
      type: tx.type,
    };
  }
}
