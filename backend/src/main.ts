import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true }
    })
  );

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  Logger.log(`Artifact Harvester backend running on http://localhost:${port}`);
}

bootstrap();
