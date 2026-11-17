import type { FastifyBaseLogger } from "fastify";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Development transport: writes the message to the log instead of sending it. */
export function consoleMailer(log: FastifyBaseLogger): Mailer {
  return {
    async send(message) {
      log.info({ mail: message }, `mail to ${message.to}: ${message.subject}`);
    },
  };
}

/** Collects messages in memory (tests). */
export function memoryMailer(): Mailer & { outbox: MailMessage[] } {
  const outbox: MailMessage[] = [];
  return {
    outbox,
    async send(message) {
      outbox.push(message);
    },
  };
}
