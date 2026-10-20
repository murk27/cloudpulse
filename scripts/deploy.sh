#!/usr/bin/env bash
# =============================================================================
# Deploys CloudPulse to AWS.
#   1. Checks your AWS login and that the admin password exists in SSM
#   2. Builds the website and the Lambda bundles
#   3. `sam deploy` creates or updates the CloudFormation stack (asks questions the first time)
#   4. Uploads the website to S3 and clears the CloudFront cache
#
# Usage:  npm run deploy        (safe to run again after every code change)
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

STACK_NAME="${STACK_NAME:-cloudpulse}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
PASSWORD_PARAM="/cloudpulse/admin-password"

for tool in aws sam node npm; do
  command -v "$tool" >/dev/null || { echo "Missing '$tool'. See README -> Deploy to AWS -> step 3."; exit 1; }
done

echo "==> Checking AWS credentials"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" || {
  echo "You are not logged in to AWS. Run:  aws login --region $REGION"
  exit 1
}
echo "    account $ACCOUNT, region $REGION"

echo "==> Checking the admin password exists in SSM Parameter Store"
if ! aws ssm get-parameter --name "$PASSWORD_PARAM" --region "$REGION" >/dev/null 2>&1; then
  echo "Missing $PASSWORD_PARAM. Create it first (README -> Deploy to AWS -> step 5):"
  echo "  read -rsp 'Admin password: ' PW && echo && aws ssm put-parameter --name $PASSWORD_PARAM --type SecureString --value \"\$PW\" --region $REGION"
  exit 1
fi

echo "==> Building website + Lambda bundles"
npm run build

echo "==> Deploying CloudFormation stack '$STACK_NAME'"
if [ -f samconfig.toml ]; then
  sam deploy --no-fail-on-empty-changeset
else
  # First deploy: SAM asks a few questions (your alert email etc.) and saves the answers in samconfig.toml.
  sam deploy --guided --stack-name "$STACK_NAME" --region "$REGION" --capabilities CAPABILITY_IAM
fi

output() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
BUCKET="$(output WebsiteBucketName)"
DISTRIBUTION="$(output DistributionId)"
SITE_URL="$(output SiteUrl)"

echo "==> Uploading website to s3://$BUCKET"
# Vite gives built files unique names (index-abc123.js), so browsers may cache them for a year...
aws s3 sync dist/web "s3://$BUCKET" --delete --region "$REGION" \
  --exclude index.html --cache-control "public,max-age=31536000,immutable"
# ...but index.html must be re-checked on every visit so a new deploy shows up immediately.
aws s3 cp dist/web/index.html "s3://$BUCKET/index.html" --region "$REGION" --cache-control "no-cache"

echo "==> Clearing the CloudFront edge cache"
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" --paths "/*" \
  --query Invalidation.Id --output text >/dev/null

echo ""
echo "Done! CloudPulse is live at: $SITE_URL"
echo "First deploy? Load demo data with: npm run seed"
echo "(A brand-new CloudFront distribution can take a few minutes before it answers.)"
