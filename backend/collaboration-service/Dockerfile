FROM node:18-alpine

WORKDIR /app

# 1. Copy dependency files first
COPY package*.json ./

# 2. Install dependencies (this runs DURING the build)
RUN npm install

# 3. Copy the rest of the application code
COPY . .

# Default port for local Docker development.
# ECS overrides this via the PORT environment variable (set to 3001 in ecs.tf).
ENV PORT=4000
EXPOSE 4000

CMD ["node", "server.js"]