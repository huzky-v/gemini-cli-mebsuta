#!/bin/bash

# 1. Call the switch API and capture the output
SWITCH_RESPONSE=$(curl -s -X PUT http://127.0.0.1:3000/api/try-switch)

# Check for a valid response format
if [[ ! "$SWITCH_RESPONSE" == *"|"* ]]; then
    echo "Error or no switch needed: $SWITCH_RESPONSE"
    # Even on error, try to run gemini
    echo "Running: gemini $@"
    gemini "$@"
    exit $?
fi

# 2. Parse the response
SWITCH_STATUS=$(echo "$SWITCH_RESPONSE" | cut -d'|' -f1)
PROJECT_ID=$(echo "$SWITCH_RESPONSE" | cut -d'|' -f2)

# 3. Export the project ID in all cases
export GOOGLE_CLOUD_PROJECT=$PROJECT_ID

# 4. Show message based on switch status
if [[ "$SWITCH_STATUS" == "1" ]]; then
  echo "Switched to preferred project: $PROJECT_ID"
else # status is 0
  echo "Using current project: $PROJECT_ID"
fi
echo "Exported GOOGLE_CLOUD_PROJECT=$PROJECT_ID"


# 5. Run the 'gemini' command, passing all script arguments to it
echo "Running: gemini $@"
gemini "$@"