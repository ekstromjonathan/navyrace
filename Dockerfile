FROM node:22-bookworm-slim
# Not /app: Vite treats the filesystem path /app/index.html as the URL
# /app/index.html → app/index.html (the trainer), so dist/index.html never emits.
WORKDIR /srv

COPY package.json package-lock.json ./
RUN npm ci

COPY pt/package.json pt/package-lock.json ./pt/
RUN npm ci --prefix pt

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# Fail early if the landing MPA sources did not make it into the image.
RUN test -f index.html \
  && test -f app/index.html \
  && test -f vilkar/index.html \
  && test -f src/lodd.js \
  && test -f vite.config.js

RUN npm run build \
  && ls -la dist \
  && test -f dist/index.html \
  && rm -rf pt/dist \
  && cp -a dist pt/dist \
  && test -f pt/dist/index.html

# Serve from cwd (/srv/pt); avoid "../dist" which some static helpers reject.
ENV PT_STATIC_DIR=dist
ENV PT_REQUIRE_SPA=1
ENV NODE_ENV=production
WORKDIR /srv/pt
EXPOSE 8080
CMD ["npx", "tsx", "src/index.ts"]
