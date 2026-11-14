# Backend Dockerfile
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (ignore postinstall script that tries to install client deps)
RUN npm ci --ignore-scripts

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Expose port (can be overridden by environment variable)
ARG PORT=3001
ENV PORT=${PORT}
EXPOSE ${PORT}

# Keep persisted credentials and contact data writable by an unprivileged process
RUN mkdir -p /app/auth_info_baileys /app/data && chown -R node:node /app/auth_info_baileys /app/data
USER node

CMD ["node", "dist/main.js"]
