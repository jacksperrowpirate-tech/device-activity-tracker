# Client Dockerfile
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code and config
COPY public ./public
COPY src ./src
COPY index.html vite.config.ts ./
COPY tsconfig.json ./
COPY tailwind.config.js ./
COPY postcss.config.js ./

# Build argument for API URL
ARG VITE_API_URL=http://localhost:3001
ENV VITE_API_URL=${VITE_API_URL}

# Build the app
RUN npm run build

# Production stage with nginx
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built app
COPY --from=build /app/build /usr/share/nginx/html

# Expose port
ARG PORT=3000
ENV PORT=${PORT}
EXPOSE ${PORT}

# Start nginx with the specified port
CMD sed -i "s/listen 80;/listen ${PORT};/g" /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'
