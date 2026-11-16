#!/usr/bin/env bash
set -euo pipefail
image="$1"
base='evoapicloud/evolution-api@sha256:456b4104b0ddffbb092d6b3c0560a4ae86fc3e014e885b882aca4b1b371dfc81'
cleanup(){ docker rm -f ack-evolution ack-postgres ack-redis >/dev/null 2>&1 || true; docker network rm ack-isolated >/dev/null 2>&1 || true; }
trap cleanup EXIT
node ci/verify-image.mjs "$base" "$image"
docker run --rm --network none --entrypoint /usr/bin/env -v "$PWD/tests:/opt/status-ack-tests:ro" "$base" -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp LAB_STATUS_ACK_ISOLATED=true LAB_EXPECT_STATUS=absent node --test --test-force-exit /opt/status-ack-tests/real-socket.test.mjs
docker run --rm --network none --entrypoint /usr/bin/env -v "$PWD/tests:/opt/status-ack-tests:ro" "$image" -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp LAB_STATUS_ACK_ISOLATED=true node --test --test-force-exit /opt/status-ack-tests/real-socket.test.mjs
docker network create --internal ack-isolated >/dev/null
docker run -d --name ack-postgres --network ack-isolated --memory 512m --cpus .5 -e POSTGRES_PASSWORD=FICTITIOUS_LOCAL_TEST_ONLY -e POSTGRES_DB=ack postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 >/dev/null
docker run -d --name ack-redis --network ack-isolated --memory 128m --cpus .25 redis:7.4-alpine@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499 redis-server --save '' --appendonly no >/dev/null
for i in {1..30}; do if docker exec ack-postgres pg_isready -U postgres -d ack >/dev/null;then break;fi;sleep 1;done
args=(run -d --name ack-evolution --network ack-isolated --memory 1536m --cpus 1
 -e AUTHENTICATION_API_KEY=FICTITIOUS_IMAGE_TEST_KEY_00000000000000000
 -e DATABASE_PROVIDER=postgresql
 -e 'DATABASE_CONNECTION_URI=postgresql://postgres:FICTITIOUS_LOCAL_TEST_ONLY@ack-postgres:5432/ack?schema=public'
 -e CACHE_REDIS_ENABLED=true -e CACHE_REDIS_URI=redis://ack-redis:6379/0 -e CACHE_REDIS_PREFIX_KEY=isolated-ack -e CACHE_REDIS_SAVE_INSTANCES=false
 -e DATABASE_SAVE_DATA_INSTANCE=true -e SERVER_PORT=8080 -e SERVER_URL=http://ack-evolution:8080 -e LOG_BAILEYS=error
 -e LOG_LEVEL=ERROR -e LOG_COLOR=false -e SENTRY_DSN=)
for key in WEBHOOK_GLOBAL_ENABLED WEBSOCKET_ENABLED TYPEBOT_ENABLED CHATWOOT_ENABLED OPENAI_ENABLED DIFY_ENABLED EVOAI_ENABLED N8N_ENABLED TELEMETRY_ENABLED RABBITMQ_ENABLED SQS_ENABLED S3_ENABLED KAFKA_ENABLED PUSHER_ENABLED;do args+=(-e "$key=false");done
docker "${args[@]}" "$image" >/dev/null
check='fetch("http://127.0.0.1:8080/instance/fetchInstances",{headers:{apikey:process.env.AUTHENTICATION_API_KEY}}).then(async r=>{const v=await r.json();if(r.status!==200||!Array.isArray(v)||v.length!==0)process.exit(2);console.log("FINAL_STARTUP_PROOF "+JSON.stringify({version:require("./package.json").version,instances:v.length,isolated:true,realMessagesSent:0,realPhonesConnected:0}));}).catch(()=>process.exit(1));'
ready=0
for i in {1..90};do if docker exec ack-evolution node -e "$check";then ready=1;break;fi;sleep 2;done
if [[ "$ready" != 1 ]];then echo 'OFFICIAL_STARTUP_FAILED';exit 1;fi
echo 'FINAL_IMAGE_VALIDATED_NO_REAL_TRANSPORT'
