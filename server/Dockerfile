FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=4000
ENV DB_PATH=/app/data/data.sqlite

RUN mkdir -p /app/data /app/uploads

EXPOSE 4000
# TEMP DIAGNOSTIC: run the real index.js, bracketed by shell echoes so we
# see something no matter what -- including the exit code if it dies.
CMD ["sh", "-c", "echo BEFORE_INDEX_JS; ls -la /app; cat /app/package.json; node index.js; echo AFTER_INDEX_JS_EXIT_CODE_$?; sleep 60"]
