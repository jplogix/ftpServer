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

# Expose FTP ports (command and passive)
EXPOSE 21 1024-30000

# Command to run the application
CMD ["node", "index.js"]
