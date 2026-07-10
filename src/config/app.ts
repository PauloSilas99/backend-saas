import swaggerJsdoc from 'swagger-jsdoc';
import { env } from './env';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Backend SaaS API',
      version: '1.0.0',
      description:
        'API modular com autenticação JWT, RBAC, importação de planilhas, analytics e billing.',
    },
    servers: [{ url: env.API_PREFIX }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/modules/**/*.routes.ts', './src/docs/**/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
