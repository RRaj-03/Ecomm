#!/bin/bash

# Update system
sudo yum update -y

# Install Docker
sudo amazon-linux-extras install docker -y
sudo service docker start
sudo usermod -a -G docker ec2-user

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Create app directory
mkdir -p /home/ec2-user/app
cd /home/ec2-user/app

# Login to GHCR (You need to provide your PAT)
# echo $CR_PAT | docker login ghcr.io -u $USERNAME --password-stdin
# For now, we assume the user will handle login manually or use public images/repo if possible, 
# but for private repos, login is needed. Ideally, this script is run once or part of CI.

# Pull latest images
docker-compose pull

# Start services
docker-compose up -d
