#!/usr/bin/env bash
set -euo pipefail

# Reconcile Node dependencies without touching the database.
npm install --ignore-scripts --no-audit --no-fund