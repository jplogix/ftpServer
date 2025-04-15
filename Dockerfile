# Use Node.js as the base image
FROM node:23-slim

# Set working directory
WORKDIR /app

# Install PostgreSQL client (needed for connection testing)
RUN apt-get update && apt-get install -y postgresql-client && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application files
COPY . .

# Create uploads directory if it doesn't exist
RUN mkdir -p /app/uploads

# Set default environment variables (can be overridden at runtime)
ENV FTP_PORT=21 \
    PASV_URL=ftp.unifywebservices.com \
    PASV_MIN=1024 \
    PASV_MAX=30000 \
    FTP_USER=finale \
    FTP_PASS=Inventory2025

# Expose FTP ports (command and passive)
EXPOSE 21 1024-30000

# Command to run the application
CMD ["node", "index.js"]
