import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const DEFAULT_PORT = 8080;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env['PORT'] || DEFAULT_PORT;
  await app.listen(port);
}

bootstrap();
