# First-load harness: fetches the page's 13 resources, PARALLEL at a time, ITER rounds.
# Usage: python3 tools/firstload.py HOST ITER PARALLEL   (e.g. 192.168.0.38 10 12)
import sys,time,urllib.request,concurrent.futures as cf
host,iters,par=sys.argv[1],int(sys.argv[2]),int(sys.argv[3])
paths=["/","/style.css"]+["/"+f for f in "app.js buffering.js dazzle.js library.js player-box.js player-browser.js player.js wavconvert.js wavstream.js".split()]+["/api/status","/api/sd"]
def get(p):
    t=time.time()
    try:
        r=urllib.request.urlopen(f"http://{host}{p}",timeout=8);n=len(r.read());return (p,True,time.time()-t)
    except Exception as e: return (p,False,time.time()-t)
fail=slow=0;tot=0
for i in range(iters):
    with cf.ThreadPoolExecutor(par) as ex: res=list(ex.map(get,paths))
    for p,ok,dt in res:
        tot+=1; fail+=not ok; slow+=(ok and dt>3)
    time.sleep(0.5)
print(f"par={par} total={tot} fail={fail} slow>3s={slow}")
