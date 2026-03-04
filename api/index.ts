import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

let cachedServer: any;

export const createNestServer = async () => {
  if (cachedServer) return cachedServer;

  console.log('--- Vercel Initialization Start (Optimized) ---');

  try {
    const app = await NestFactory.create(AppModule);

    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );

    const allowedOrigins = [
      'https://pyramidplay.cm',
      'https://www.pyramidplay.cm',
      'https://admin.pyramidplay.cm',
      'http://localhost:5173',
      'http://localhost:5174',
    ];

    app.enableCors({
      origin: (origin, callback) => {
        // Autoriser les requêtes sans origin (comme Postman ou les outils serveurs)
        if (!origin) return callback(null, true);

        // Vérifier si l'origine est dans la liste ou est un sous-domaine Vercel
        const isAllowed =
          allowedOrigins.includes(origin) ||
          origin.endsWith('.vercel.app') ||
          origin.endsWith('.pyramidplay.cm');

        if (isAllowed) {
          callback(null, true);
        } else {
          console.error(`CORS Blocked for origin: ${origin}`);
          callback(new Error('Not allowed by CORS'));
        }
      },
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
      allowedHeaders: 'Content-Type, Accept, Authorization, X-Requested-With',
      exposedHeaders: ['Content-Range', 'X-Content-Range'],
    });

    // Configuration Swagger pour Vercel
    const config = new DocumentBuilder()
      .setTitle('PyramidPlay API')
      .setDescription('The PyramidPlay API description (Production)')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);

    await app.init();

    cachedServer = app.getHttpAdapter().getInstance();
    return cachedServer;
  } catch (error) {
    console.error('CRITICAL: NestJS bootstrap failed!', error);
    throw error;
  }
};

export default async (req: any, res: any) => {
  try {
    const server = await createNestServer();
    server(req, res);
  } catch (error) {
    console.error('Final Handler Error:', error);
    res.status(500).json({
      statusCode: 500,
      message: 'Internal Server Error during NestJS initialization',
      error: error.message,
    });
  }
};
