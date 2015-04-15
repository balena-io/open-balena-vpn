#!/bin/bash
set -e
cleanup() {
	exit_code=$?
	if [ -n "$test_id" ]; then
		docker rm -f $test_id
	fi
	exit $exit_code
}
trap "cleanup" EXIT

VERSION=$(git describe --always --abbrev=6)
ESCAPED_BRANCH_NAME=$(echo $sourceBranch | sed 's/[^a-z0-9A-Z_.-]/-/g')

docker build --tag resin/${JOB_NAME}:${VERSION} .
test_id=$(docker run --privileged -d resin/${JOB_NAME}:${VERSION})
docker exec $test_id /bin/sh -c 'npm install && systemctl stop resin-vpn.service && npm test'

docker tag -f resin/${JOB_NAME}:${VERSION} resin/${JOB_NAME}:${ESCAPED_BRANCH_NAME}

# Push the images
docker push resin/${JOB_NAME}:${VERSION}
docker push resin/${JOB_NAME}:${ESCAPED_BRANCH_NAME}
