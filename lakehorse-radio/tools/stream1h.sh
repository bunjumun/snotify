#!/bin/bash
# 1-hour stream test: two 256 KB Range loops on Currency.wav, status each minute.
# Usage: tools/stream1h.sh OUT.csv   (host hardcoded below; failures -> OUT.csv.fail)
H=192.168.0.38; OUT=$1; END=$(( $(date +%s) + 3600 ))
: > $OUT.fail
loop(){ off=$1; while [ $(date +%s) -lt $END ]; do
  code=$(curl -s -m 20 -r $off-$((off+262143)) -o /dev/null -w "%{http_code}" "http://$H/sd/Currency.wav")
  [ "$code" = 206 ] || echo "$(date +%T) off=$off code=$code" >> $OUT.fail
  off=$(( (off+524288) % 80000000 )); done; }
loop 1048576 & loop 1310720 &
echo "time,free,largest,min,rssi" > $OUT
while [ $(date +%s) -lt $END ]; do
  j=$(curl -s -m 8 http://$H/api/status)
  f=$(echo "$j"|grep -o '"freeHeap":[0-9]*'|cut -d: -f2); l=$(echo "$j"|grep -o '"largestFreeBlock":[0-9]*'|cut -d: -f2)
  m=$(echo "$j"|grep -o '"minFreeHeap":[0-9]*'|cut -d: -f2); r=$(echo "$j"|grep -o '"rssi":-*[0-9]*'|cut -d: -f2)
  echo "$(date +%T),$f,$l,$m,$r" >> $OUT; sleep 60; done
wait; echo done >> $OUT
