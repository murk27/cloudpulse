/**
 * Sends alerts to a Discord channel through an incoming webhook: a secret URL that accepts
 * a JSON message with a plain HTTP POST. No SDK or bot needed.
 * When DISCORD_WEBHOOK_URL isn't set (e.g. local development), alerts are only logged.
 */
import { config } from "./config.js";

export async function sendAlert(subject: string, message: string): Promise<void> {
  const webhookUrl = config.discordWebhookUrl();
  if (!webhookUrl) {
    console.log(`[alert] ${subject}\n${message}`);
    return;
  }
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Discord messages are limited to 2,000 characters.
    body: JSON.stringify({ username: "CloudPulse", content: `**${subject}**\n${message}`.slice(0, 2000) }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}`);
}
