#!/bin/sh

# Download the oauth2.ts file
OAUTH_TS_URL="https://raw.githubusercontent.com/google-gemini/gemini-cli/refs/heads/main/packages/core/src/code_assist/oauth2.ts"
OAUTH_TS_CONTENT=$(wget -q -O - $OAUTH_TS_URL)

# Extract CLIENT_ID and CLIENT_SECRET from the downloaded file
# The lines in the source file now look like:
# const OAUTH_CLIENT_ID =
#   '...';
# const OAUTH_CLIENT_SECRET = '...';
CLIENT_ID=$(echo "$OAUTH_TS_CONTENT" | grep -A 1 "^const OAUTH_CLIENT_ID =" | tail -1 | cut -d"'" -f2)
CLIENT_SECRET=$(echo "$OAUTH_TS_CONTENT" | grep "^const OAUTH_CLIENT_SECRET =" | cut -d"'" -f2)

# Export the extracted values as environment variables for server.js to use
if [ -n "$CLIENT_ID" ]; then
    export GEMINI_OAUTH_CLIENT_ID="$CLIENT_ID"
    echo "Found and exported GEMINI_OAUTH_CLIENT_ID as $CLIENT_ID"
fi

if [ -n "$CLIENT_SECRET" ]; then
    export GEMINI_OAUTH_CLIENT_SECRET="$CLIENT_SECRET"
    echo "Found and exported GEMINI_OAUTH_CLIENT_SECRET as $CLIENT_SECRET"
fi

# Execute the command passed as arguments to this script
exec "$@"
