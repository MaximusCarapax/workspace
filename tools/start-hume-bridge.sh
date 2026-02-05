#!/bin/bash
# Quick start script for Hume-Twilio Bridge

set -e

echo "🚀 Starting Hume-Twilio Bridge Server"

# Check if ngrok is available
if command -v ngrok &> /dev/null; then
    echo "📡 ngrok found - you can expose the server with:"
    echo "   ngrok http 3000"
    echo ""
fi

# Check credentials
echo "🔍 Checking setup..."
node tools/test-hume-bridge.js --quiet 2>/dev/null || {
    echo "❌ Setup check failed. Run: node tools/test-hume-bridge.js"
    exit 1
}

echo "✅ Setup verified"
echo ""

# Start the bridge
echo "🎯 Starting bridge server on port ${1:-3000}..."
echo "📞 Twilio Number: +61 468 089 420"
echo "🔗 Configure Twilio webhook to: https://your-ngrok-url.com/voice/incoming"
echo ""

exec node tools/hume-twilio-bridge.js "${1:-3000}" "${2:-cc7579f9-a0a1-4dd0-bacc-62971d333de4}"