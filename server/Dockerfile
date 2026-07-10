FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=4000
ENV DB_PATH=/app/data/data.sqlite

RUN mkdir -p /app/data /app/uploads

EXPOSE 4000
# TEMP DIAGNOSTIC: shell works (proven). Now bracket each Node invocation
# with shell echoes to find exactly where Node itself stops producing
# output -- this narrows it down to node --version vs. node -e vs. our file.
CMD ["sh", "-c", "echo STEP_A_before_node_version; node --version; echo STEP_B_after_node_version; node -e 'console.log(\"STEP_C_node_e_console_log_works\")'; echo STEP_D_after_node_e; node -e 'require(\"fs\").writeSync(1,\"STEP_E_writeSync_works\\n\")'; echo STEP_F_after_writesync; sleep 60"]
