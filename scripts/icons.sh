#!/bin/sh
# Regenerate all app/website icons directly from the full-body 3D mascot, using the shared brand pipeline.
set -e
cd "$(dirname "$0")/.."
npm run brand
