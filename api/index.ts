import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '@nestjs/common';

let cachedServer: any;

export const createNestServer = async () => {
  if (cachedServer) return cachedServer;

  console.log('--- Vercel Initialization Start (Optimized) ---');

  try {
    const app = await NestFactory.create(AppModule);

    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );

    app.enableCors({
      origin: true,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
      allowedHeaders: 'Content-Type, Accept, Authorization',
    });

    await app.init();

    // On récupère l'instance Express interne de NestJS
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
