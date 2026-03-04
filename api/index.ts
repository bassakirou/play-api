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
        if (
          !origin ||
          allowedOrigins.includes(origin) ||
          origin.endsWith('.vercel.app')
        ) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
      allowedHeaders: 'Content-Type, Accept, Authorization, X-Requested-With',
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
