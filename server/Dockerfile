FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=4000
ENV DB_PATH=/app/data/data.sqlite

RUN mkdir -p /app/data /app/uploads

EXPOSE 4000
# TEMP DIAGNOSTIC: bypass Node entirely -- pure shell, to test whether ANY
# process in this container can produce visible output at all.
CMD ["sh", "-c", "echo HELLO_FROM_SHELL_DIAGNOSTIC; i=0; while [ $i -lt 60 ]; do i=$((i+1)); echo SHELL_TICK_$i; sleep 1; done"]
