/**
 * Configuration, read from environment variables.
 *
 * In AWS the SAM template (template.yaml) sets these on each Lambda function.
 * Locally, scripts/local-server.ts sets them before it loads the handlers.
 * Values are read lazily (inside functions) so importing this file never crashes.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const config = {
  /** DynamoDB table that holds monitors, checks, daily rollups and incidents. */
  tableName: () => required("TABLE_NAME"),
  /** SNS topic for alert emails. Optional: when missing, alerts are only logged. */
  topicArn: () => process.env.TOPIC_ARN || undefined,
  /** SSM Parameter Store name of the admin password (a SecureString). */
  adminPasswordParam: () => process.env.ADMIN_PASSWORD_PARAM || "/cloudpulse/admin-password",
  /** Local development only: plain admin password, used instead of SSM. */
  localAdminPassword: () => process.env.ADMIN_PASSWORD || undefined,
  /** Local development only: points the DynamoDB client at the in-memory dynalite server. */
  dynamoEndpoint: () => process.env.DYNAMODB_ENDPOINT || undefined,
  region: () => process.env.AWS_REGION || "us-east-1",
};

/** Cost guardrails: keep usage far below the AWS Always Free limits. */
export const limits = {
  /** Max monitors. 10 monitors x 1 check every 5 min stays tiny for DynamoDB and Lambda. */
  maxMonitors: 10,
  /** HTTP timeout for one check. */
  checkTimeoutMs: 10_000,
  /** DynamoDB TTL deletes raw checks after this many days (free, automatic cleanup). */
  checkRetentionDays: 90,
  /** Daily rollups are kept a bit longer than the 90 days the status page shows. */
  rollupRetentionDays: 100,
  /** Admin sessions expire after this long. */
  sessionTtlMs: 12 * 60 * 60 * 1000,
};
