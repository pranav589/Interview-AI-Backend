# --- STEP 1: Builder Stage ---
# Use an official Node.js image to build the TypeScript code
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files and install ALL dependencies (including dev deps like typescript)
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copy source code and tsconfig
COPY . .

# Build the project (runs 'tsc')
RUN npm run build

# --- STEP 2: Runner Stage ---
# Use a slim image for the final production environment
FROM node:20-slim AS runner

# Set production environment
ENV NODE_ENV=production
WORKDIR /app

# Copy ONLY the built files and production dependencies from the builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Install ONLY production dependencies to keep the image tiny
RUN npm install --production --legacy-peer-deps

# Create the uploads folder (used by multer) and set permissions
RUN mkdir -p uploads && chmod 777 uploads

# Render injects PORT at runtime (default 10000)
# Fallback to 10000 if not set
ENV PORT=10000
EXPOSE 10000

# Start the server using the compiled JS
CMD ["node", "dist/server.js"]
