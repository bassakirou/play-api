"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const swagger_1 = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const path_1 = require("path");
async function bootstrap() {
    if (!process.env.SMTP_HOST)
        process.env.SMTP_HOST = 'localhost';
    if (!process.env.SMTP_PORT)
        process.env.SMTP_PORT = '1025';
    if (!process.env.SMTP_FROM)
        process.env.SMTP_FROM = '"PyramidPlay Support" <support@pyramidplay.com>';
    if (!process.env.APP_WEB_URL)
        process.env.APP_WEB_URL = 'http://localhost:5173';
    if (!process.env.SMTP_SECURE)
        process.env.SMTP_SECURE = 'false';
    if (!process.env.SMTP_IGNORE_TLS)
        process.env.SMTP_IGNORE_TLS = 'true';
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.useGlobalPipes(new common_1.ValidationPipe({ transform: true, whitelist: true }));
    app.enableCors({
        origin: [
            'http://localhost:5173',
            'http://localhost:5174',
            'http://localhost:5175',
        ],
        credentials: true,
    });
    const config = new swagger_1.DocumentBuilder()
        .setTitle('PyramidPlay API')
        .setDescription('The PyramidPlay API description')
        .setVersion('1.0')
        .addBearerAuth()
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, config);
    swagger_1.SwaggerModule.setup('api', app, document);
    app.useStaticAssets((0, path_1.join)(process.cwd(), 'uploads'), {
        prefix: '/uploads',
    });
    const port = process.env.PORT ? Number(process.env.PORT) : 3000;
    await app.listen(port);
}
bootstrap();
//# sourceMappingURL=main.js.map