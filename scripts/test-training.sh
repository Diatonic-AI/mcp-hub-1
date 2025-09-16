#!/bin/bash
# Test script for ML training orchestration

echo "🧪 Testing ML Training Orchestration"
echo "===================================="
echo ""

# Start the orchestrator in background
echo "🚀 Starting training orchestrator..."
node src/training/cli.js start &
ORCHESTRATOR_PID=$!

# Wait for orchestrator to initialize
sleep 3

echo ""
echo "📋 Submitting test training job..."
node src/training/cli.js train \
  --tenant test \
  --name test-model \
  --version 1.0.0 \
  --framework sklearn \
  --epochs 5 \
  --batch-size 32 \
  --learning-rate 0.01 \
  --task-type classification

echo ""
echo "⏳ Waiting for job to process..."
sleep 5

echo ""
echo "📊 Checking queue status..."
node src/training/cli.js status

echo ""
echo "📦 Listing trained models..."
node src/training/cli.js list-models --tenant test

echo ""
echo "🛑 Stopping orchestrator..."
kill $ORCHESTRATOR_PID 2>/dev/null

echo ""
echo "✅ Test complete!"
