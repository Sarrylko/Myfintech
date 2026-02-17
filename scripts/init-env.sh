#!/usr/bin/env bash
set -eu

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

# Portable in-place sed (works on both Linux and macOS)
replace_in_file() {
    if sed --version >/dev/null 2>&1; then
        sed -i "s|$1|$2|g" "$3"
    else
        sed -i '' "s|$1|$2|g" "$3"
    fi
}

replace_in_file "CHANGE_ME_random_secret_key_64_chars" "${SECRET_KEY}" "$ENV_FILE"
replace_in_file "CHANGE_ME_postgres" "${PG_PASSWORD}" "$ENV_FILE"
replace_in_file "CHANGE_ME_fernet_key" "${FERNET_KEY}" "$ENV_FILE"

echo "Created $ENV_FILE with generated secrets."
echo "Review and update Plaid + property API keys before starting."
