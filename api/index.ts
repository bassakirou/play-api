import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { Express } from 'express';

const server: Express = express();
let cachedApp: INestApplication;

export const createNestServer = async (expressInstance: Express) => {
  if (cachedApp) return cachedApp;

  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressInstance),
  );

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type, Accept, Authorization',
  });

  await app.init();
  cachedApp = app;
  return app;
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
