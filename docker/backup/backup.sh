#!/usr/bin/env sh
# Ежедневная резервная копия БД (раздел 13: хранение 14 дней). Сжатый дамп в S3; срок хранения —
# правилом жизненного цикла бакета (docs/ops.md), локальная копия — последние 2 дня.
set -eu
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="/backups/b25j-${stamp}.sql.gz"
pg_dump --no-owner --format=plain "$DATABASE_URL" | gzip -9 > "$file"
aws s3 cp "$file" "s3://${BACKUP_BUCKET}/db/b25j-${stamp}.sql.gz" ${AWS_ENDPOINT_URL:+--endpoint-url "$AWS_ENDPOINT_URL"}
find /backups -name 'b25j-*.sql.gz' -mtime +2 -delete
echo "backup ok: ${file}"
