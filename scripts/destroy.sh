#!/usr/bin/env bash
# =============================================================================
# Deletes everything CloudPulse created in AWS (the whole CloudFormation stack and its data).
# Usage:  npm run destroy
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

STACK_NAME="${STACK_NAME:-cloudpulse}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"

read -rp "This deletes the '$STACK_NAME' stack and ALL its data in $REGION. Type 'delete' to continue: " answer
[ "$answer" = "delete" ] || { echo "Cancelled."; exit 1; }

BUCKET="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='WebsiteBucketName'].OutputValue" --output text 2>/dev/null || true)"

# CloudFormation can only delete an S3 bucket once it is empty.
if [ -n "$BUCKET" ] && [ "$BUCKET" != "None" ]; then
  echo "==> Emptying s3://$BUCKET"
  aws s3 rm "s3://$BUCKET" --recursive --region "$REGION"
fi

echo "==> Deleting the stack (CloudFront takes a few minutes to disable)"
sam delete --stack-name "$STACK_NAME" --region "$REGION" --no-prompts

echo ""
echo "Stack deleted. The admin password parameter is kept (standard parameters are free). To remove it too:"
echo "  aws ssm delete-parameter --name /cloudpulse/admin-password --region $REGION"
