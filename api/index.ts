import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import * as express from 'express';
import { Express } from 'express';

const server: Express = express();

export const createNestServer = async (expressInstance: any) => {
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressInstance),
  );
  
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  
  // Robust CORS configuration
  app.enableCors({
    origin: (origin, callback) => {
      // Allow all origins in production, or specify your frontend domains
      callback(null, true);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type, Accept, Authorization',
  });

  await app.init();
  return app;
};

// Vercel expects the handler to be exported
const handler = async (req: any, res: any) => {
  await createNestServer(server);
  return server(req, res);
};

export default handler;
