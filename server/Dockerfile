FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=4000
ENV DB_PATH=/app/data/data.sqlite

RUN mkdir -p /app/data /app/uploads

EXPOSE 4000
CMD ["node", "index.js"]
