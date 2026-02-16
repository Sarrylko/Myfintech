#!/usr/bin/env bash
set -euo pipefail

# Generate a .env file from .env.example with random secrets
ENV_FILE=".env"
EXAMPLE=".env.example"

if [ -f "$ENV_FILE" ]; then
    echo ".env already exists. Remove it first if you want to regenerate."
    exit 1
fi

cp "$EXAMPLE" "$ENV_FILE"

# Generate random values
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))" 2>/dev/null || openssl rand -base64 48)
PG_PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))" 2>/dev/null || openssl rand -base64 24)
FERNET_KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" 2>/dev/null || echo "CHANGE_ME_fernet_key")

# Replace placeholders
sed -i "s|CHANGE_ME_random_secret_key_64_chars|${SECRET_KEY}|g" "$ENV_FILE"
sed -i "s|CHANGE_ME_postgres|${PG_PASSWORD}|g" "$ENV_FILE"
sed -i "s|CHANGE_ME_fernet_key|${FERNET_KEY}|g" "$ENV_FILE"

echo "Created $ENV_FILE with generated secrets."
echo "Review and update Plaid + property API keys before starting."
