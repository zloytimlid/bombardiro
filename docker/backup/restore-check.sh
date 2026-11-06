#!/usr/bin/env sh
# Ежемесячная проверка восстановления (раздел 13): последний дамп из S3 → временная БД → проверочные запросы.
set -eu
latest=$(aws s3 ls "s3://${BACKUP_BUCKET}/db/" ${AWS_ENDPOINT_URL:+--endpoint-url "$AWS_ENDPOINT_URL"} | sort | tail -n 1 | awk '{print $4}')
[ -n "$latest" ] || { echo "no backups found" >&2; exit 1; }
aws s3 cp "s3://${BACKUP_BUCKET}/db/${latest}" /tmp/restore.sql.gz ${AWS_ENDPOINT_URL:+--endpoint-url "$AWS_ENDPOINT_URL"}
psql "$RESTORE_ADMIN_URL" -c 'DROP DATABASE IF EXISTS b25j_restore_check' -c 'CREATE DATABASE b25j_restore_check'
gunzip -c /tmp/restore.sql.gz | psql --quiet --set ON_ERROR_STOP=1 "${RESTORE_ADMIN_URL%/*}/b25j_restore_check"
users=$(psql -tA "${RESTORE_ADMIN_URL%/*}/b25j_restore_check" -c 'select count(*) from users')
missions=$(psql -tA "${RESTORE_ADMIN_URL%/*}/b25j_restore_check" -c 'select count(*) from missions where is_published')
psql "$RESTORE_ADMIN_URL" -c 'DROP DATABASE b25j_restore_check'
[ "$users" -gt 0 ] && [ "$missions" -ge 3 ] || { echo "restore check FAILED: users=${users} missions=${missions}" >&2; exit 1; }
echo "restore check ok: ${latest} users=${users} missions=${missions}"
