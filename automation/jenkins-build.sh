#!/bin/bash
set -e

VERSION=$(git rev-parse --short HEAD)
ESCAPED_BRANCH_NAME=$(echo $sourceBranch | sed 's/[^a-z0-9A-Z_.-]/-/g')

docker build --tag resin/${JOB_NAME}:${VERSION} .
IMAGE_NAME=resin/${JOB_NAME}:${VERSION} $(dirname $0)/test.sh

# Try pulling the old build first for caching purposes.
docker pull resin/${JOB_NAME}:${ESCAPED_BRANCH_NAME} || docker pull resin/${JOB_NAME}:master || true

docker tag -f resin/${JOB_NAME}:${VERSION} resin/${JOB_NAME}:${ESCAPED_BRANCH_NAME}

# Push the images
docker push resin/${JOB_NAME}:${VERSION}
docker push resin/${JOB_NAME}:${ESCAPED_BRANCH_NAME}
