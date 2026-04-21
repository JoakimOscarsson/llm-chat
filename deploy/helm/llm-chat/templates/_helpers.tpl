{{- define "llm-chat.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "llm-chat.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "llm-chat.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "llm-chat.labels" -}}
app.kubernetes.io/name: {{ include "llm-chat.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{- define "llm-chat.serviceName" -}}
{{- printf "%s-%s" (include "llm-chat.fullname" .root) .name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "llm-chat.configMapName" -}}
{{- printf "%s-config" (include "llm-chat.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "llm-chat.secretName" -}}
{{- if .Values.appSecrets.existingSecretName -}}
{{- .Values.appSecrets.existingSecretName -}}
{{- else -}}
{{- printf "%s-secrets" (include "llm-chat.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "llm-chat.cloudflareSecretName" -}}
{{- if .Values.cloudflareTunnel.existingSecretName -}}
{{- .Values.cloudflareTunnel.existingSecretName -}}
{{- else -}}
{{- printf "%s-cloudflare-tunnel" (include "llm-chat.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "llm-chat.postgresqlServiceName" -}}
{{- printf "%s-postgresql" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "llm-chat.redisServiceName" -}}
{{- printf "%s-redis" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "llm-chat.sessionStoreUrl" -}}
{{- if .Values.sessionStore.externalUrl -}}
{{- .Values.sessionStore.externalUrl -}}
{{- else -}}
{{- printf "postgresql://%s:%s@%s:5432/%s?sslmode=disable" .Values.postgresql.auth.username .Values.postgresql.auth.password (include "llm-chat.postgresqlServiceName" .) .Values.postgresql.auth.database -}}
{{- end -}}
{{- end -}}

{{- define "llm-chat.redisUrl" -}}
{{- if .Values.redis.externalUrl -}}
{{- .Values.redis.externalUrl -}}
{{- else -}}
{{- printf "redis://:%s@%s:6379/0" .Values.redis.auth.password (include "llm-chat.redisServiceName" .) -}}
{{- end -}}
{{- end -}}
