import { injectable } from 'tsyringe';
import nodemailer from 'nodemailer';
import { env } from '@config/env';
import { logger } from '@shared/logger';

export type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

@injectable()
export class MailService {
  async send(input: SendMailInput): Promise<{ delivered: boolean; previewLogged: boolean }> {
    if (env.SMTP_HOST) {
      const transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth:
          env.SMTP_USER && env.SMTP_PASS
            ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
            : undefined,
      });

      await transporter.sendMail({
        from: env.SMTP_FROM,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html ?? input.text,
      });

      return { delivered: true, previewLogged: false };
    }

    logger.info(
      {
        to: input.to,
        subject: input.subject,
        text: input.text,
      },
      '[mail] SMTP não configurado — e-mail registrado no log',
    );

    return { delivered: false, previewLogged: true };
  }
}
