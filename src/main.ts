/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Charger .env.local prioritairement s'il existe, sinon .env
const envLocalPath = path.resolve(process.cwd(), '.env.local');
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
} else if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
}

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  if (!process.env.SMTP_HOST) process.env.SMTP_HOST = 'localhost';
  if (!process.env.SMTP_PORT) process.env.SMTP_PORT = '1025';
  if (!process.env.SMTP_FROM)
    process.env.SMTP_FROM = '"PyramidPlay Support" <support@pyramidplay.com>';
  if (!process.env.APP_WEB_URL)
    process.env.APP_WEB_URL = 'http://localhost:5173';
  if (!process.env.SMTP_SECURE) process.env.SMTP_SECURE = 'false';
  if (!process.env.SMTP_IGNORE_TLS) process.env.SMTP_IGNORE_TLS = 'false';

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const express = require('express');
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean | string) => void) => {
      callback(null, origin || true);
    },
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'Accept', 'X-Requested-With'],
    exposedHeaders: ['Accept-Ranges', 'Content-Range', 'Content-Length'],
  });

  const config = new DocumentBuilder()
    .setTitle('PyramidPlay API')
    .setDescription('The PyramidPlay API description')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  // Cast app to any to avoid type mismatch due to dependency duplication
  const document = SwaggerModule.createDocument(app as any, config);
  SwaggerModule.setup('api', app as any, document);

  (app as any).useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
  });

  const preferredPort = process.env.PORT ? Number(process.env.PORT) : 3000;
  const fallbackPorts = [preferredPort, 3002, 3001, 3003].filter(
    (p, i, arr) => arr.indexOf(p) === i,
  );

  let lastError: unknown = null;
  for (const port of fallbackPorts) {
    try {
      await app.listen(port);
      return;
    } catch (err) {
      lastError = err;
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: unknown }).code === 'EADDRINUSE'
      ) {
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
bootstrap();
