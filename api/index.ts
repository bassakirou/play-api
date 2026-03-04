import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { Express } from 'express';

const server: Express = express();
let cachedApp: INestApplication;

export const createNestServer = async (expressInstance: Express) => {
  if (cachedApp) return cachedApp;

  console.log('--- Vercel Initialization Start ---');
  console.log('Environment:', process.env.NODE_ENV);
  console.log('DATABASE_URL present:', !!process.env.DATABASE_URL);
  if (process.env.DATABASE_URL) {
    console.log(
      'DATABASE_URL protocol:',
      process.env.DATABASE_URL.split(':')[0],
    );
  }

  try {
    const app = await NestFactory.create(
      AppModule,
      new ExpressAdapter(expressInstance),
      {
        logger: ['error', 'warn', 'log', 'debug', 'verbose'],
      },
    );

    console.log('NestFactory.create successful');

    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );

    app.enableCors({
      origin: true,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
      allowedHeaders: 'Content-Type, Accept, Authorization',
    });

    console.log('App init starting...');
    await app.init();
    console.log('App init successful');

    cachedApp = app;
    return app;
  } catch (error) {
    console.error('CRITICAL: NestFactory.create failed!', error);
    throw error;
  }
};

export default async (req: any, res: any) => {
  try {
    const app = await createNestServer(server);
    server(req, res);
  } catch (error) {
    console.error('NestJS Initialization Error:', error);
    res.status(500).json({
      statusCode: 500,
      message: 'Internal Server Error during NestJS initialization',
      error: error.message,
      stack: error.stack,
    });
  }
};
