#!/bin/bash

VERSION=$(git describe --always --abbrev=6)
ESCAPED_BRANCH_NAME=$(echo $sourceBranch | sed 's/[^a-z0-9A-Z_.-]/-/g')

docker build --tag resin/${JOB_NAME}:${VERSION} .

docker tag -f resin/${JOB_NAME}:${VERSION} resin/${JOB_NAME}:${ESCAPED_BRANCH_NAME}

# Push the images
docker push resin/${JOB_NAME}:${VERSION}
docker push resin/${JOB_NAME}:${ESCAPED_BRANCH_NAME}
