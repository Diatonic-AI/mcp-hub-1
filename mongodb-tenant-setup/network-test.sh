#!/bin/bash
# Network connectivity test for MongoDB from container environment

echo "🌐 Testing network connectivity to MongoDB..."

# Test from host
echo "📍 Testing from host machine:"
ping -c 3 10.10.10.13 && echo "✅ Host can ping MongoDB server" || echo "❌ Host cannot ping MongoDB server"

# Test MongoDB port
echo "🔌 Testing MongoDB port 27017:"
nc -zv 10.10.10.13 27017 2>&1 | grep -q "succeeded" && echo "✅ MongoDB port accessible from host" || echo "❌ MongoDB port not accessible from host"

# Test from a minimal container
echo "🐳 Testing from container environment:"
docker run --rm --network bridge alpine:latest sh -c "
  apk add --no-cache netcat-openbsd >/dev/null 2>&1
  echo '📡 Container network test:'
  ping -c 2 10.10.10.13 >/dev/null 2>&1 && echo '✅ Container can ping MongoDB server' || echo '❌ Container cannot ping MongoDB server'
  nc -zv 10.10.10.13 27017 2>&1 | grep -q 'succeeded' && echo '✅ Container can reach MongoDB port' || echo '❌ Container cannot reach MongoDB port'
"

echo "🎯 Network test complete!"
