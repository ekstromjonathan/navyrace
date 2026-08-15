FROM node:22-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY pt/package.json pt/package-lock.json ./pt/
RUN npm ci --prefix pt

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build

ENV NODE_ENV=production
ENV PT_STATIC_DIR=../dist
WORKDIR /app/pt
EXPOSE 8080
CMD ["npx", "tsx", "src/index.ts"]
