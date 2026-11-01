FROM node:20

RUN apt-get update && apt-get install -y \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG BASE_PATH=""
ARG PUBLIC_PATH="/amano"

ENV BASE_PATH=${BASE_PATH}
ENV PUBLIC_PATH=${PUBLIC_PATH}

COPY package*.json ./

RUN npm ci

COPY . .

# 本番用Next.jsをビルド
RUN npm run build

EXPOSE 3000

# 本番モードで起動
CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
