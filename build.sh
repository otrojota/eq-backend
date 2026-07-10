VERSION=0.01
DESTINATION=docker.zonar.cl/test-zd/backend
docker buildx build --push --platform linux/amd64,linux/arm64 -t $DESTINATION:latest -t $DESTINATION:$VERSION .
