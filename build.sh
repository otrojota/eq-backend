VERSION=0.07
DESTINATION=docker.homejota.net/eq/backend
docker buildx build --push --platform linux/amd64,linux/arm64 -t $DESTINATION:latest -t $DESTINATION:$VERSION .
