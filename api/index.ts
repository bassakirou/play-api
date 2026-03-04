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

    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

    app.enableCors({
      origin: true,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
      allowedHeaders: 'Content-Type, Accept, Authorization',
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
