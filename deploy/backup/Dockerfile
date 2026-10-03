# Backup runner: pg_dump/pg_restore of the same major version as the database, plus an S3 client.
FROM postgres:16-alpine

RUN apk add --no-cache aws-cli tzdata

COPY backup.sh restore.sh verify.sh run.sh /usr/local/bin/
RUN sed -i 's/\r$//' /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/verify.sh /usr/local/bin/run.sh \
  && chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/verify.sh /usr/local/bin/run.sh

ENTRYPOINT ["/usr/local/bin/run.sh"]
