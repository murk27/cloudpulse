/**
 * Sends alert emails through Amazon SNS (Simple Notification Service).
 * The checker publishes ONE message to the topic; SNS delivers it to every subscriber
 * (your email address, set when you deploy). Locally there is no topic, so we just log.
 */
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { config } from "./config.ts";

let sns: SNSClient | undefined;

export async function sendAlert(subject: string, message: string): Promise<void> {
  const topicArn = config.topicArn();
  if (!topicArn) {
    console.log(`[alert] ${subject}\n${message}`);
    return;
  }
  sns ??= new SNSClient({ region: config.region() });
  // SNS email subjects must be plain ASCII and at most 100 characters.
  const safeSubject = subject.replace(/[^\x20-\x7E]/g, "").slice(0, 100);
  await sns.send(new PublishCommand({ TopicArn: topicArn, Subject: safeSubject, Message: message }));
}
